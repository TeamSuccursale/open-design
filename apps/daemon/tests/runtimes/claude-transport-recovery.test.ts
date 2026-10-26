import { describe, expect, it } from 'vitest';
import { claudeFileInputArgs, isClaudeSessionResult, shouldUseClaudeFileInput } from '../../src/runtimes/claude-transport-recovery.js';

const silentStart = { agentId: 'claude', terminalTrigger: 'first_output_deadline', retryAttemptCount: 0, parsedEventSeen: false };

describe('Claude startup transport recovery', () => {
  it('recovers only the first silent startup', () => {
    expect(shouldUseClaudeFileInput(silentStart)).toBe(true);
    for (const patch of [
      { agentId: 'codex' }, { terminalTrigger: 'inactivity_watchdog' },
      { retryAttemptCount: 1 }, { parsedEventSeen: true },
      { userVisibleOutputSeen: true }, { toolCallSeen: true },
      { artifactWriteSeen: true }, { liveArtifactSeen: true }, { cancelRequested: true },
    ]) expect(shouldUseClaudeFileInput({ ...silentStart, ...patch })).toBe(false);
  });

  it('changes only the input transport, preserving model, effort, session and permissions', () => {
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--resume', 'session', '--model', 'claude-opus-5-5', '--effort', 'medium', '--permission-mode', 'bypassPermissions'];
    expect(claudeFileInputArgs(args)).toEqual(args.map((value, index) => index === 2 ? 'text' : value));
    expect(args[2]).toBe('stream-json');
    expect(() => claudeFileInputArgs(['-p'])).toThrow();
  });

  it('waits for the native session result before bounding process shutdown', () => {
    expect(isClaudeSessionResult({ type: 'usage', durationMs: null })).toBe(true);
    expect(isClaudeSessionResult({ type: 'usage', durationMs: 5, isError: true })).toBe(true);
    expect(isClaudeSessionResult({ type: 'usage', durationMs: 5, stopReason: 'tool_use' })).toBe(false);
    expect(isClaudeSessionResult({ type: 'turn_end', stopReason: 'end_turn' })).toBe(false);
    expect(isClaudeSessionResult({ type: 'usage', inputTokens: 12 })).toBe(false);
  });
});
