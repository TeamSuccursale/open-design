import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

type StartedServer = { url: string; server: Server; shutdown?: () => Promise<void> | void };
type RunStatus = { id: string; status: string; error: string | null; errorCode: string | null; terminalTrigger: string | null; eventsLogPath: string; artifactCount?: number };
type RunEvent = { event: string; data: Record<string, unknown> };

describe('Claude useful-progress watchdog over the real HTTP run boundary', () => {
  const envKeys = [
    'OD_NEXT_STRATEGY_ROLLOUT', 'OD_CHAT_RUN_INACTIVITY_TIMEOUT_MS',
    'OD_CHAT_RUN_FIRST_OUTPUT_TIMEOUT_MS', 'OD_CHAT_RUN_INACTIVITY_KILL_GRACE_MS',
    'POSTHOG_KEY', 'POSTHOG_HOST', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY',
    'LANGFUSE_BASE_URL', 'OPEN_DESIGN_TELEMETRY_RELAY_URL',
  ];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  let started: StartedServer | null = null;
  let binDir: string | null = null;

  beforeEach(() => {
    for (const key of envKeys) delete process.env[key];
    process.env.OD_NEXT_STRATEGY_ROLLOUT = 'off';
    // Well above Node cold-start, short enough to prove that continuous bytes
    // cannot keep an otherwise stuck turn alive indefinitely.
    process.env.OD_CHAT_RUN_INACTIVITY_TIMEOUT_MS = '3000';
    process.env.OD_CHAT_RUN_FIRST_OUTPUT_TIMEOUT_MS = '10000';
    process.env.OD_CHAT_RUN_INACTIVITY_KILL_GRACE_MS = '200';
  });

  afterEach(async () => {
    await Promise.resolve(started?.shutdown?.());
    if (started?.server) await new Promise<void>((resolve) => started!.server.close(() => resolve()));
    started = null;
    if (binDir) await rm(binDir, { recursive: true, force: true });
    binDir = null;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('ends a thinking-only run despite repeated thinking, whitespace, raw stdout, and stderr', async () => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'od-claude-progress-'));
    const fixture = await writeNativeFixture(binDir, 'thinking');
    started = await startServer({ port: 0, returnServer: true }) as StartedServer;
    await configure(started.url, fixture);

    const run = await createAndWaitForRun(started.url);
    expect(run.status).toBe('failed');
    expect(run.errorCode).toBe('AGENT_EXECUTION_FAILED');
    expect(run.terminalTrigger).toBe('inactivity_watchdog');
    expect(run.error).toMatch(/stalled|progress/i);
    const events = await readRunEvents(run.eventsLogPath);
    expect(events.some((event) => event.event === 'agent' && event.data.type === 'thinking_delta')).toBe(true);
    expect(events.filter((event) => event.event === 'start').length).toBeLessThanOrEqual(2);
    expect(events.filter((event) => event.event === 'run_retry_attempted').length).toBeLessThanOrEqual(1);
    expect(events.filter((event) => event.event === 'end')).toHaveLength(1);
  }, 25_000);

  it('allows a normal text-only answer without producing project files', async () => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'od-claude-progress-'));
    const fixture = await writeNativeFixture(binDir, 'text');
    started = await startServer({ port: 0, returnServer: true }) as StartedServer;
    await configure(started.url, fixture);

    const run = await createAndWaitForRun(started.url);
    expect(run.status).toBe('succeeded');
    expect(run.error).toBeNull();
    expect(run.artifactCount ?? 0).toBe(0);
    const events = await readRunEvents(run.eventsLogPath);
    expect(events.some((event) => event.event === 'agent' && event.data.type === 'text_delta' && event.data.delta === 'Conversation only.')).toBe(true);
    expect(events.filter((event) => event.event === 'start')).toHaveLength(1);
    expect(events.filter((event) => event.event === 'end')).toHaveLength(1);
  });
});

async function writeNativeFixture(dir: string, mode: 'thinking' | 'text'): Promise<string> {
  const source = path.join(dir, 'claude-progress-fixture.cjs');
  await writeFile(source, `
const fs = require('node:fs');
const args = process.argv.slice(2);
const emit = (frame) => fs.writeSync(1, JSON.stringify(frame) + '\\n');
if (args.includes('--version')) { console.log('Claude Code 2.1.296-progress-test'); process.exit(0); }
if (args.includes('--help')) { console.log('Usage: claude -p --include-partial-messages --add-dir --effort'); process.exit(0); }
if (args.includes('auth')) { console.log(JSON.stringify({ loggedIn: true, authMethod: 'test' })); process.exit(0); }
const thinkingDisplay = args.indexOf('--thinking-display');
if (thinkingDisplay >= 0 && args[thinkingDisplay + 1] !== 'summarized') { console.error('Invalid --thinking-display; expected summarized or omitted'); process.exit(1); }
const start = () => {
  // A failing watchdog assertion must not leave the generated fixture alive.
  setTimeout(() => process.exit(9), 20000).unref();
  emit({ type: 'system', subtype: 'init', model: 'claude-opus-5-5', session_id: 'progress-test-session' });
  if (${JSON.stringify(mode)} === 'text') {
    emit({ type: 'assistant', parent_tool_use_id: null, message: { id: 'answer', role: 'assistant', content: [{ type: 'text', text: 'Conversation only.' }], stop_reason: 'end_turn' } });
    emit({ type: 'result', is_error: false, result: 'Conversation only.', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 } });
    setTimeout(() => process.exit(0), 30);
    return;
  }
  emit({ type: 'stream_event', event: { type: 'message_start', message: { id: 'endless-thinking' } } });
  setInterval(() => {
    emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Still reasoning. ' } } });
    emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '  ' } } });
    fs.writeSync(1, 'diagnostic keepalive\\n');
    fs.writeSync(2, 'provider keepalive\\n');
  }, 150);
};
process.stdin.once('data', start);
process.stdin.resume();
`, 'utf8');

  // Generated test launchers use the platform's native process carrier. The
  // Windows case must execute the fixture rather than skip the regression.
  if (process.platform === 'win32') {
    const bin = path.join(dir, 'claude-progress.cmd');
    await writeFile(bin, `@echo off\r\n"${process.execPath}" "${source}" %*\r\n`, 'utf8');
    return bin;
  }
  const bin = path.join(dir, 'claude-progress');
  await writeFile(bin, `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${source.replace(/'/g, "'\\''")}' "$@"\n`, 'utf8');
  await chmod(bin, 0o755);
  return bin;
}

async function configure(url: string, fixture: string): Promise<void> {
  const response = await fetch(`${url}/api/app-config`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId: 'claude', agentCliEnv: { claude: { CLAUDE_BIN: fixture } }, telemetry: { metrics: false, content: false, artifactManifest: false }, privacyDecisionAt: Date.now() }),
  });
  expect(response.status).toBe(200);
}

async function createAndWaitForRun(url: string): Promise<RunStatus> {
  const projectId = `claude_progress_${randomUUID()}`;
  const projectResponse = await fetch(`${url}/api/projects`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: projectId, name: 'Claude progress regression', metadata: { kind: 'prototype' }, skipDiscoveryBrief: true }),
  });
  expect(projectResponse.status).toBe(200);
  const project = await projectResponse.json() as { conversationId: string };
  const response = await fetch(`${url}/api/runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, conversationId: project.conversationId, assistantMessageId: randomUUID(), clientRequestId: randomUUID(), agentId: 'claude', reasoning: 'default', message: 'Answer a short conversational question.', currentPrompt: 'Answer a short conversational question.' }),
  });
  expect(response.status).toBe(202);
  const { runId } = await response.json() as { runId: string };
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const statusResponse = await fetch(`${url}/api/runs/${encodeURIComponent(runId)}`);
    expect(statusResponse.status).toBe(200);
    const run = await statusResponse.json() as RunStatus;
    if (['succeeded', 'failed', 'canceled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Run ${runId} remained active after its useful-progress deadline.`);
}

async function readRunEvents(file: string): Promise<RunEvent[]> {
  return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as RunEvent);
}
