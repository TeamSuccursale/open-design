import { createCommandInvocation } from '@open-design/platform';
import {
  spawnAgentProcess,
  type SpawnAgentProcessRequest,
  type SpawnedAgentProcess,
} from './runtimes/agent-process.js';
import type { RunRetrySideEffectState } from './run-retry-policy.js';

const NATIVE_CLAUDE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CLAUDE_CONTEXT_COMPACTION_TIMEOUT_MS = 90_000;
const MAX_COMPACTION_OUTPUT_BYTES = 1_048_576;

export interface ClaudeContextRecoveryInput {
  agentId: string;
  error: { code?: unknown; terminal?: unknown };
  /** True only after the usual conversation/model/cwd native-resume guards. */
  nativeResumeValidated: boolean;
  sessionId: string | null | undefined;
  /** The shared automatic retry budget, including other recovery strategies. */
  retryAttemptCount: number;
  compactionAttemptCount: number;
  latestTurnPrompt: string;
  sideEffects: RunRetrySideEffectState;
}

export interface ClaudeContextRecoveryPlan {
  sessionId: string;
  latestTurnPrompt: string;
  retryAttemptIndex: 1;
  compactionAttemptIndex: 1;
}

/**
 * Only a native, resumed session can benefit from compaction. The structured
 * terminal result is mandatory: quoted text, provider errors and preflight
 * prompt-budget failures must not trigger another model request. Current-turn
 * tools/edits prevent replay, even when they appear read-only to the host.
 * Claim both attempt counters synchronously before awaiting compaction.
 */
export function planClaudeContextRecovery(input: ClaudeContextRecoveryInput): ClaudeContextRecoveryPlan | null {
  if (
    input.agentId !== 'claude'
    || input.error.code !== 'AGENT_PROMPT_TOO_LARGE'
    || input.error.terminal !== true
    || !input.nativeResumeValidated
    || !input.sessionId
    || !NATIVE_CLAUDE_SESSION_ID.test(input.sessionId)
    || input.retryAttemptCount !== 0
    || input.compactionAttemptCount !== 0
    || !input.latestTurnPrompt.trim()
    || input.sideEffects.cancelRequested
    || input.sideEffects.toolCallSeen
    || input.sideEffects.artifactWriteSeen
    || input.sideEffects.liveArtifactSeen
    || input.sideEffects.userVisibleOutputSeen
  ) return null;
  return {
    sessionId: input.sessionId,
    latestTurnPrompt: input.latestTurnPrompt,
    retryAttemptIndex: 1,
    compactionAttemptIndex: 1,
  };
}

export type ClaudeCompactionResult =
  | { ok: true; preTokens: number; postTokens?: number }
  | {
      ok: false;
      reason: 'canceled' | 'timeout' | 'spawn_failed' | 'process_failed'
        | 'invalid_session' | 'protocol_error' | 'tool_requested'
        | 'output_limit' | 'no_compaction' | 'termination_failed';
    };

export interface CompactClaudeNativeSessionInput {
  command: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  runDir: string;
  runId: string;
  sessionId: string;
  model?: string | null;
  reasoning?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Attach this child to the logical run so its normal Stop action owns it. */
  onSpawn?: (spawned: SpawnedAgentProcess) => void;
  /** Uses the host's generation-scoped process-tree termination, never a new PID scan. */
  terminate: (spawned: SpawnedAgentProcess) => Promise<{ quiescent: boolean }>;
}

export type ClaudeCompactionDependencies = {
  spawn?: (request: SpawnAgentProcessRequest) => SpawnedAgentProcess;
};

/**
 * Ask Claude Code itself to compact its existing transcript. No transcript is
 * read, truncated, rewritten or replayed by the daemon. A success exit without
 * a matching manual compact_boundary is a no-op, not permission to retry.
 * See https://code.claude.com/docs/en/agent-sdk/skills#compact-history-with-compact.
 */
export async function compactClaudeNativeSession(
  input: CompactClaudeNativeSessionInput,
  dependencies: ClaudeCompactionDependencies = {},
): Promise<ClaudeCompactionResult> {
  if (input.signal?.aborted) return { ok: false, reason: 'canceled' };
  if (!NATIVE_CLAUDE_SESSION_ID.test(input.sessionId)) return { ok: false, reason: 'invalid_session' };
  const args = [
    '-p', '--input-format', 'text', '--output-format', 'stream-json', '--verbose',
    '--resume', input.sessionId,
    // Keep the empty value in the same argv entry: a Windows .cmd carrier's
    // `%*` forwarding can discard a standalone empty string.
    '--tools=', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--permission-mode', 'dontAsk',
    '--max-turns', '1',
  ];
  if (input.model && input.model !== 'default') args.push('--model', input.model);
  if (input.reasoning && input.reasoning !== 'default') args.push('--effort', input.reasoning);
  const invocation = createCommandInvocation({ command: input.command, args, env: input.env });
  let spawned: SpawnedAgentProcess;
  try {
    spawned = (dependencies.spawn ?? spawnAgentProcess)({
      ...invocation,
      env: input.env,
      cwd: input.cwd,
      // EOF is available at spawn, eliminating JSONL backpressure and ensuring
      // a compact-only invocation can never wait for more user input.
      stdin: { prompt: '/compact\n' },
      runDir: input.runDir,
      runId: input.runId,
    });
  } catch {
    return { ok: false, reason: 'spawn_failed' };
  }
  return await new Promise<ClaudeCompactionResult>((resolve) => {
    const child = spawned.child;
    let buffer = '';
    let byteCount = 0;
    let settled = false;
    let settling = false;
    let boundary: { preTokens: number; postTokens?: number } | null = null;
    let successResult = false;
    let streamFailed = false;
    const timeoutMs = Number.isFinite(input.timeoutMs) && (input.timeoutMs ?? 0) > 0
      ? Math.min(input.timeoutMs!, CLAUDE_CONTEXT_COMPACTION_TIMEOUT_MS)
      : CLAUDE_CONTEXT_COMPACTION_TIMEOUT_MS;
    const cleanup = () => {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
      child.stdout?.removeListener('data', onData);
      child.stderr?.removeListener('data', onStderr);
      child.removeListener('close', onClose);
      child.removeListener('error', onError);
    };
    const finish = (result: ClaudeCompactionResult) => {
      if (settled || settling) return;
      settling = true;
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
      // Even a closed direct child may have left descendants. The host's
      // process-tree guard proves quiescence before a retry can launch.
      let terminationTimer: ReturnType<typeof setTimeout> | undefined;
      const terminationDeadline = new Promise<{ quiescent: boolean }>((resolveTermination) => {
        terminationTimer = setTimeout(() => resolveTermination({ quiescent: false }), 10_000);
      });
      void Promise.race([
        Promise.resolve().then(() => input.terminate(spawned)),
        terminationDeadline,
      ]).then((termination) => {
        clearTimeout(terminationTimer);
        settled = true;
        cleanup();
        resolve(termination.quiescent ? result : { ok: false, reason: 'termination_failed' });
      }, () => {
        clearTimeout(terminationTimer);
        settled = true;
        cleanup();
        resolve({ ok: false, reason: 'termination_failed' });
      });
    };
    const consume = (line: string) => {
      if (!line.trim() || settled || settling) return;
      let frame: Record<string, unknown>;
      try { frame = JSON.parse(line) as Record<string, unknown>; }
      catch { finish({ ok: false, reason: 'protocol_error' }); return; }
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
        finish({ ok: false, reason: 'protocol_error' }); return;
      }
      if (typeof frame.session_id === 'string' && frame.session_id !== input.sessionId) {
        finish({ ok: false, reason: 'invalid_session' }); return;
      }
      if (frame.type === 'assistant') {
        const message = frame.message as { content?: unknown } | undefined;
        if (Array.isArray(message?.content) && message.content.some((block) =>
          block && typeof block === 'object' && block.type === 'tool_use')) {
          finish({ ok: false, reason: 'tool_requested' }); return;
        }
      }
      if (frame.type === 'system' && frame.subtype === 'compact_boundary') {
        const metadata = frame.compact_metadata as Record<string, unknown> | undefined;
        if (
          frame.session_id !== input.sessionId
          || metadata?.trigger !== 'manual'
          || typeof metadata.pre_tokens !== 'number'
          || !Number.isFinite(metadata.pre_tokens)
          || metadata.pre_tokens < 0
        ) { finish({ ok: false, reason: 'protocol_error' }); return; }
        boundary = {
          preTokens: metadata.pre_tokens,
          ...(typeof metadata.post_tokens === 'number' && Number.isFinite(metadata.post_tokens)
            && metadata.post_tokens >= 0 ? { postTokens: metadata.post_tokens } : {}),
        };
      }
      if (frame.type === 'result') {
        successResult = frame.is_error === false && frame.subtype === 'success';
        if (!successResult) streamFailed = true;
      }
    };
    const countBytes = (chunk: Buffer | string) => {
      byteCount += Buffer.byteLength(chunk);
      if (byteCount > MAX_COMPACTION_OUTPUT_BYTES) {
        finish({ ok: false, reason: 'output_limit' }); return false;
      }
      return true;
    };
    const onData = (chunk: Buffer | string) => {
      if (!countBytes(chunk) || settled || settling) return;
      buffer += String(chunk);
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1 && !settling) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        consume(line);
      }
    };
    const onStderr = (chunk: Buffer | string) => { countBytes(chunk); };
    const onClose = (code: number | null) => {
      if (buffer.trim()) consume(buffer);
      if (settling) return;
      if (input.signal?.aborted) { finish({ ok: false, reason: 'canceled' }); return; }
      if (code !== 0 || streamFailed || !successResult) { finish({ ok: false, reason: 'process_failed' }); return; }
      finish(boundary ? { ok: true, ...boundary } : { ok: false, reason: 'no_compaction' });
    };
    const onError = () => { finish({ ok: false, reason: 'spawn_failed' }); };
    const onAbort = () => { finish({ ok: false, reason: 'canceled' }); };
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onStderr);
    child.once('close', onClose);
    child.once('error', onError);
    input.signal?.addEventListener('abort', onAbort, { once: true });
    // The caller may synchronously cancel while attaching the child.
    try { input.onSpawn?.(spawned); }
    catch { finish({ ok: false, reason: 'spawn_failed' }); }
    if (input.signal?.aborted) onAbort();
  });
}
