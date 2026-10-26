import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runHeaderFooterLogoWorker, type HeaderFooterLogoWorkerRequest } from '../../src/services/header-footer-search.js';

const native = vi.hoisted(() => ({ args: [] as string[], request: null as unknown, fail: false, calls: 0 }));
vi.mock('../../src/codex-cli.js', () => ({ createCodexCliInvocation: (args: string[]) => { native.args = args; return { command: 'authenticated-codex', args }; } }));
vi.mock('../../src/runtimes/agent-process.js', () => ({
  reapLeftoverAgentProcesses: vi.fn(),
  spawnAgentProcess: (request: { runDir: string }) => {
    native.request = request; native.calls++;
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(), exitCode: null });
    void (async () => {
      if (native.fail) { await Promise.resolve(); child.stderr.emit('data', Buffer.from('The model gpt-6.1-sol is unavailable for this account')); child.emit('close', 1); return; }
      await writeFile(path.join(request.runDir, 'result.json'), JSON.stringify({ status: 'ready', candidates: [{ label: 'Official identity', sourceUrl: 'https://official.example/logo.svg', filename: 'logo.svg' }], error: null, browserUsed: false }));
      child.stdout.emit('data', Buffer.from('{"type":"thread.started","thread_id":"actual-native-session"}\n'));
      child.emit('close', 0);
    })();
    return { child, processGroupId: null };
  },
}));
const temporary: string[] = [];
afterEach(async () => { native.fail = false; native.calls = 0; await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function request(): Promise<HeaderFooterLogoWorkerRequest> {
  const runDirectory = await mkdtemp(path.join(tmpdir(), 'melillo-native-logo-')); temporary.push(runDirectory);
  return { target: { id: 'target', target: 'Official identity', status: 'queued', model: 'gpt-6.1-sol', effort: 'low', attempt: 0, assetIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, workerId: 'logo-worker', runDirectory, outputDirectory: path.join(runDirectory, 'output'), signal: new AbortController().signal, onSession: vi.fn(async () => {}) };
}

describe('native logo worker policy', () => {
  it('launches exactly one authenticated Sol/low session with live web search and records its observed session id', async () => {
    const input = await request(), result = await runHeaderFooterLogoWorker(input);
    expect(native.calls).toBe(1);
    expect(native.args).toContain('gpt-6.1-sol'); expect(native.args).toContain('model_reasoning_effort="low"'); expect(native.args).toContain('web_search="live"');
    expect(native.args).toContain('approval_policy="never"'); expect(native.args).toContain('approvals_reviewer="user"');
    expect(native.args).toContain('skip_host_skill_discovery'); expect(native.args).toContain('skill_search'); expect(native.args).toContain('multi_agent');
    expect(native.args).not.toContain('--ignore-user-config');
    expect(input.onSession).toHaveBeenCalledWith('actual-native-session'); expect(result.sessionId).toBe('actual-native-session');
    expect(native.request).toMatchObject({ cwd: input.outputDirectory, runDir: input.runDirectory, runId: input.workerId });
  });
  it('reports model unavailability and never silently starts a fallback model', async () => {
    native.fail = true;
    await expect(runHeaderFooterLogoWorker(await request())).rejects.toThrow('gpt-6.1-sol is unavailable');
    expect(native.calls).toBe(1); expect(native.args.filter((arg) => arg === '--model')).toHaveLength(1);
  });
  it('fails recoverably when a native session cannot be persisted', async () => {
    const input = await request(); input.onSession = async () => { throw new Error('ENOSPC'); };
    await expect(runHeaderFooterLogoWorker(input)).rejects.toThrow('Impossibile registrare la sessione');
    expect(native.calls).toBe(1);
  });
});
