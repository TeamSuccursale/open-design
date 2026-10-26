import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  compactClaudeNativeSession,
  planClaudeContextRecovery,
  type ClaudeContextRecoveryInput,
  type CompactClaudeNativeSessionInput,
} from '../src/claude-context-recovery.js';
import { spawnAgentProcess, type SpawnAgentProcessRequest, type SpawnedAgentProcess } from '../src/runtimes/agent-process.js';

const SESSION = '12345678-1234-4567-9876-123456789abc';
const base: ClaudeContextRecoveryInput = {
  agentId: 'claude',
  error: { code: 'AGENT_PROMPT_TOO_LARGE', terminal: true },
  nativeResumeValidated: true,
  sessionId: SESSION,
  retryAttemptCount: 0,
  compactionAttemptCount: 0,
  latestTurnPrompt: 'Update only the requested page.',
  sideEffects: {},
};

describe('native Claude context recovery admission', () => {
  it('preserves the exact latest turn and consumes the shared one-retry budget', () => {
    expect(planClaudeContextRecovery(base)).toEqual({
      sessionId: SESSION,
      latestTurnPrompt: base.latestTurnPrompt,
      retryAttemptIndex: 1,
      compactionAttemptIndex: 1,
    });
    expect(planClaudeContextRecovery({ ...base, retryAttemptCount: 1 })).toBeNull();
    expect(planClaudeContextRecovery({ ...base, compactionAttemptCount: 1 })).toBeNull();
  });

  it.each([
    { agentId: 'codex' },
    { error: { code: 'AGENT_PROMPT_TOO_LARGE' } },
    { error: { code: 'AGENT_AUTH_REQUIRED', terminal: true } },
    { error: { code: 'RATE_LIMITED', terminal: true } },
    { error: { code: 'refusal', terminal: true } },
    { error: { code: 'result_error', terminal: true } },
    { nativeResumeValidated: false },
    { sessionId: null },
    { sessionId: '--continue' },
    { latestTurnPrompt: '  ' },
    { retryAttemptCount: Number.NaN },
  ])('rejects non-native, unvalidated or non-context failure: %j', (override) => {
    expect(planClaudeContextRecovery({ ...base, ...override })).toBeNull();
  });

  it.each(['cancelRequested', 'toolCallSeen', 'artifactWriteSeen', 'liveArtifactSeen', 'userVisibleOutputSeen'] as const)(
    'never replays a turn after %s', (key) => {
      expect(planClaudeContextRecovery({ ...base, sideEffects: { [key]: true } })).toBeNull();
    },
  );
});

function fakeChild(): SpawnedAgentProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough() });
  return { child, processGroupId: null, promptDeliveredAtSpawn: true };
}

function input(overrides: Partial<CompactClaudeNativeSessionInput> = {}): CompactClaudeNativeSessionInput {
  return {
    command: process.execPath,
    env: process.env,
    cwd: process.cwd(),
    runDir: path.join(tmpdir(), 'unused-mocked-compact'),
    runId: 'context-test',
    sessionId: SESSION,
    model: 'claude-opus-5-5',
    reasoning: 'medium',
    terminate: vi.fn(async () => ({ quiescent: true })),
    ...overrides,
  };
}

const boundary = {
  type: 'system', subtype: 'compact_boundary', session_id: SESSION,
  compact_metadata: { trigger: 'manual', pre_tokens: 150_000, post_tokens: 5_000 },
};
const result = { type: 'result', subtype: 'success', is_error: false, session_id: SESSION };

function emitFrames(spawned: SpawnedAgentProcess, frames: unknown[], code: number | null = 0): void {
  for (const frame of frames) spawned.child.stdout?.emit('data', `${JSON.stringify(frame)}\n`);
  spawned.child.emit('close', code);
}

afterEach(() => { vi.useRealTimers(); });

describe('bounded native compact execution', () => {
  it('resumes the exact model/effort with all tools and external MCP disabled and an EOF prompt', async () => {
    const spawned = fakeChild();
    const spawn = vi.fn((_request: SpawnAgentProcessRequest) => spawned);
    const request = input();
    const promise = compactClaudeNativeSession(request, { spawn });
    const invocation = spawn.mock.calls[0]![0];
    expect(invocation.stdin).toEqual({ prompt: '/compact\n' });
    expect(invocation.args).toEqual(expect.arrayContaining([
      '--resume', SESSION, '--model', 'claude-opus-5-5', '--effort', 'medium',
      '--tools=', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--permission-mode', 'dontAsk', '--max-turns', '1',
    ]));
    // Preserve PreCompact hooks: a user/admin rejection must not be bypassed.
    expect(invocation.args).not.toContain('--safe-mode');
    expect(invocation.args).not.toContain('--settings');
    emitFrames(spawned, [boundary, result]);
    expect(await promise).toEqual({ ok: true, preTokens: 150_000, postTokens: 5_000 });
    expect(request.terminate).toHaveBeenCalledOnce();
  });

  it('does not treat exit 0 or a success no-op as actual compaction', async () => {
    const spawned = fakeChild();
    const promise = compactClaudeNativeSession(input(), { spawn: () => spawned });
    emitFrames(spawned, [{ ...result, result: 'Not enough messages to compact.' }]);
    expect(await promise).toEqual({ ok: false, reason: 'no_compaction' });
  });

  it.each([
    [{ ...boundary, session_id: '87654321-1234-4567-9876-123456789abc' }, 'invalid_session'],
    [{ ...boundary, compact_metadata: { trigger: 'auto', pre_tokens: 20 } }, 'protocol_error'],
    [{ ...boundary, compact_metadata: { trigger: 'manual' } }, 'protocol_error'],
    [{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write' }] } }, 'tool_requested'],
  ])('rejects an unexpected compact stream: %j', async (frame, reason) => {
    const spawned = fakeChild();
    const promise = compactClaudeNativeSession(input(), { spawn: () => spawned });
    emitFrames(spawned, [frame, result]);
    expect(await promise).toEqual({ ok: false, reason });
  });

  it('does not retry when a PreCompact hook or service rejects compaction', async () => {
    const spawned = fakeChild();
    const promise = compactClaudeNativeSession(input(), { spawn: () => spawned });
    emitFrames(spawned, [boundary, { ...result, is_error: true, subtype: 'error_during_execution' }], 1);
    expect(await promise).toEqual({ ok: false, reason: 'process_failed' });
  });

  it('terminates the compact process once when a silent or thinking-only stream times out', async () => {
    vi.useFakeTimers();
    const spawned = fakeChild();
    const request = input({ timeoutMs: 500 });
    const promise = compactClaudeNativeSession(request, { spawn: () => spawned });
    emitFramesOnly(spawned, [{ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'still thinking' }] } }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(await promise).toEqual({ ok: false, reason: 'timeout' });
    expect(request.terminate).toHaveBeenCalledOnce();
  });

  it('cancels before spawning, and terminates an in-flight compact on Stop', async () => {
    const controller = new AbortController();
    const spawned = fakeChild();
    const request = input({ signal: controller.signal });
    const spawn = vi.fn(() => spawned);
    const promise = compactClaudeNativeSession(request, { spawn });
    controller.abort();
    expect(await promise).toEqual({ ok: false, reason: 'canceled' });
    expect(request.terminate).toHaveBeenCalledOnce();
    spawn.mockClear();
    expect(await compactClaudeNativeSession(request, { spawn })).toEqual({ ok: false, reason: 'canceled' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('contains malformed output and excessive diagnostic output', async () => {
    const malformed = fakeChild();
    const p1 = compactClaudeNativeSession(input(), { spawn: () => malformed });
    malformed.child.stdout?.emit('data', 'not-json\n');
    expect(await p1).toEqual({ ok: false, reason: 'protocol_error' });
    const flooded = fakeChild();
    const p2 = compactClaudeNativeSession(input(), { spawn: () => flooded });
    flooded.child.stderr?.emit('data', 'x'.repeat(1_048_577));
    expect(await p2).toEqual({ ok: false, reason: 'output_limit' });
  });

  it('never starts the next model request without a quiescent previous process tree', async () => {
    const spawned = fakeChild();
    const promise = compactClaudeNativeSession(input({ terminate: async () => ({ quiescent: false }) }), { spawn: () => spawned });
    emitFrames(spawned, [boundary, result]);
    expect(await promise).toEqual({ ok: false, reason: 'termination_failed' });
  });

  it('bounds even a faulty termination implementation', async () => {
    vi.useFakeTimers();
    const spawned = fakeChild();
    const promise = compactClaudeNativeSession(input({ terminate: async () => await new Promise(() => {}) }), { spawn: () => spawned });
    emitFrames(spawned, [boundary, result]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await promise).toEqual({ ok: false, reason: 'termination_failed' });
  });

  it('uses complete file-backed stdin with a real Node child on Windows and POSIX', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'od-claude-compact-'));
    try {
      const script = `let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c=>input+=c); process.stdin.on('end',()=>{ if(input!=='/compact\\n')process.exit(3); console.log(${JSON.stringify(JSON.stringify(boundary))}); console.log(${JSON.stringify(JSON.stringify(result))}); });`;
      const outcome = await compactClaudeNativeSession(input({ runDir }), {
        spawn: (request) => spawnAgentProcess({ ...request, command: process.execPath, args: ['-e', script] }),
      });
      expect(outcome).toEqual({ ok: true, preTokens: 150_000, postTokens: 5_000 });
    } finally { rmSync(runDir, { recursive: true, force: true }); }
  });
});

function emitFramesOnly(spawned: SpawnedAgentProcess, frames: unknown[]): void {
  for (const frame of frames) spawned.child.stdout?.emit('data', `${JSON.stringify(frame)}\n`);
}
