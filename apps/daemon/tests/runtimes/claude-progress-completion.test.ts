import { describe, expect, it } from 'vitest';

import {
  claudeEventCountsAsActionableProgress,
  claudeProductionEndedWithoutArtifact,
} from '../../src/runtimes/chat-run-lifecycle.js';
import { createClaudeStreamHandler } from '../../src/runtimes/claude-stream.js';

describe('Claude actionable progress', () => {
  it('does not let streamed thinking, init, and accounting keep the action clock alive', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createClaudeStreamHandler((event) => events.push(event));
    const frames = [
      { type: 'system', subtype: 'init', model: 'claude-opus-5-5', session_id: 'session' },
      { type: 'system', subtype: 'status', status: 'working' },
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'thinking-only' } } },
      ...Array.from({ length: 25 }, (_, index) => ({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: `Reasoning ${index}. ` } },
      })),
    ];
    for (const frame of frames) handler.feed(`${JSON.stringify(frame)}\n`);
    handler.flush();

    expect(events.some((event) => event.type === 'thinking_delta')).toBe(true);
    expect(events.filter(claudeEventCountsAsActionableProgress)).toEqual([]);
  });

  it('recognizes real tool activity and terminal results from the native parser', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createClaudeStreamHandler((event) => events.push(event));
    for (const frame of [
      {
        type: 'assistant', parent_tool_use_id: null,
        message: {
          id: 'msg-tool', role: 'assistant', stop_reason: 'tool_use',
          usage: { input_tokens: 20, output_tokens: 10 },
          content: [{ type: 'tool_use', id: 'write-1', name: 'Write', input: { file_path: 'index.html', content: '<h1>Ready</h1>' } }],
        },
      },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'write-1', content: 'Written' }] } },
      { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg-final', role: 'assistant', content: [{ type: 'text', text: 'Ready.' }], stop_reason: 'end_turn' } },
      { type: 'result', is_error: false, usage: { input_tokens: 20, output_tokens: 10 }, result: 'Ready.', stop_reason: 'end_turn' },
    ]) handler.feed(`${JSON.stringify(frame)}\n`);
    handler.flush();

    const actionableTypes = events.filter(claudeEventCountsAsActionableProgress).map((event) => event.type);
    expect(actionableTypes).toEqual(expect.arrayContaining(['tool_use', 'tool_result', 'text_delta', 'turn_end', 'usage']));
    expect(events.some((event) => event.type === 'request_usage')).toBe(true);
    expect(actionableTypes).not.toContain('request_usage');
  });

  it.each([undefined, null, 'stdout', {}, { type: 'raw', text: 'heartbeat' }, { type: 'thinking_delta', delta: 'thinking' }, { type: 'request_usage' }, { type: 'text_delta', delta: ' \n ' }])('does not accept empty or non-actionable evidence %j', (event) => {
    expect(claudeEventCountsAsActionableProgress(event)).toBe(false);
  });

  it('does accept either text representation emitted by adapters', () => {
    expect(claudeEventCountsAsActionableProgress({ type: 'text_delta', delta: 'Answer' })).toBe(true);
    expect(claudeEventCountsAsActionableProgress({ type: 'text_delta', text: 'Answer' })).toBe(true);
  });
});

describe('Claude production delivery requirement', () => {
  const completedProduction = {
    agentId: 'claude', exitCode: 0, cancelRequested: false,
    expectsArtifact: true, artifactProducedThisRun: false, awaitingUserInput: false,
  };

  it('rejects acknowledgement-only success in an explicitly requested production stage', () => {
    expect(claudeProductionEndedWithoutArtifact(completedProduction)).toBe(true);
  });

  it.each([
    { expectsArtifact: false },
    { artifactProducedThisRun: true },
    { awaitingUserInput: true },
    { cancelRequested: true },
    { exitCode: 1 },
    { exitCode: null },
    { agentId: 'codex' },
  ])('preserves conversational turns, forms, delivery, and existing error/cancel handling %j', (override) => {
    expect(claudeProductionEndedWithoutArtifact({ ...completedProduction, ...override })).toBe(false);
  });
});
