/** Recovery for Claude's live-stdin startup stall; never replay observed work. */
export const CLAUDE_FIRST_OUTPUT_TIMEOUT_MS = 120_000;
export const CLAUDE_RESULT_EXIT_GRACE_MS = 15_000;

export function shouldUseClaudeFileInput(input: {
  agentId: string;
  terminalTrigger?: string | null;
  retryAttemptCount: number;
  parsedEventSeen: boolean;
  userVisibleOutputSeen?: boolean;
  toolCallSeen?: boolean;
  artifactWriteSeen?: boolean;
  liveArtifactSeen?: boolean;
  cancelRequested?: boolean;
}): boolean {
  return input.agentId === 'claude'
    && input.terminalTrigger === 'first_output_deadline'
    && input.retryAttemptCount === 0
    && !input.parsedEventSeen
    && !input.userVisibleOutputSeen
    && !input.toolCallSeen
    && !input.artifactWriteSeen
    && !input.liveArtifactSeen
    && !input.cancelRequested;
}

/** File-backed text stdin has no argv size limit and does not need a live pipe. */
export function claudeFileInputArgs(args: readonly string[]): string[] {
  const result = [...args];
  const index = result.indexOf('--input-format');
  if (index < 0 || result[index + 1] !== 'stream-json') {
    throw new Error('Claude file-input recovery requires the stream-json input flag.');
  }
  result[index + 1] = 'text';
  return result;
}

/** Only a session result is conclusive: message-level end_turn can precede work. */
export function isClaudeSessionResult(event: Record<string, unknown>): boolean {
  return event.type === 'usage' && Object.hasOwn(event, 'durationMs')
    && event.stopReason !== 'tool_use';
}
