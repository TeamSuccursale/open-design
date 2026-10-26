import express, { type Response } from 'express';
import type { Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskProjectCustodian } from '@open-design/contracts';
import { registerProjectCustodianRoutes, type RegisterProjectCustodianRoutesDeps } from '../src/routes/project-custodians.js';
import { runProjectCustodiansCli } from '../src/services/project-custodians-cli.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(fast = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'custodian-api-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const custodians = { ledger: vi.fn(async () => ({ version: 1, snapshotRevision: 'revision', sources: [], textStatus: 'not-started', imagesStatus: 'not-started', imageConsent: false, gaps: [] })),
    ask: vi.fn(async (_root: string, _input: AskProjectCustodian, _metadata?: unknown, _projectId?: string) => ({ answer: 'Evidence answer', citations: [], assetIds: [], gaps: [], domain: 'text', receiptId: 'receipt', snapshotRevision: 'revision' })) };
  const journal = { read: vi.fn(async () => ({ events: [], revision: null, verified: true })) };
  const watch = { activate: vi.fn(async () => {}), deactivate: vi.fn(() => {}), status: vi.fn(() => ({ indexing: false, phase: 'idle', queuedChanges: [], pendingDomains: [], message: 'Ready' })) };
  let authorized = true;
  const authorize = vi.fn(async (_req, res, _id, _options) => { if (!authorized) { res.status(403).json({ error: { message: 'Denied' } }); return false; } return true; });
  const app = express(); app.use(express.json());
  registerProjectCustodianRoutes(app, {
    db: {}, paths: { PROJECTS_DIR: path.dirname(root), RUNTIME_DATA_DIR: root }, custodians, custodianJournal: journal, custodianWatch: watch,
    authorizeProjectRequest: authorize,
    http: { sendApiError: (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
    projectStore: { getProject: (_db: unknown, id: string) => id === 'project' ? { id, metadata: { kind: 'other', baseDir: root, ...(fast ? { projectMode: 'fast' } : {}) } } : null },
  } as unknown as RegisterProjectCustodianRoutesDeps);
  const server: Server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No listener');
  return { root, custodians, journal, watch, authorize, url: `http://127.0.0.1:${address.port}`, deny: () => { authorized = false; } };
}

describe('custodian HTTP/CLI boundary', () => {
  it('uses project authorization for every ledger, query, history and activity operation', async () => {
    const test = await fixture(), endpoint = `${test.url}/api/projects/project/custodians`;
    expect((await fetch(endpoint)).status).toBe(200);
    expect((await fetch(`${endpoint}/history`)).status).toBe(200);
    for (const [suffix, body] of [['ask', { domain: 'text', question: 'What is known?' }], ['activity', { active: true }], ['activity', { active: false }]] as const) {
      expect((await fetch(`${endpoint}/${suffix}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(200);
    }
    expect(test.watch.activate).toHaveBeenCalledTimes(1); expect(test.watch.deactivate).toHaveBeenCalledWith('project');
    expect(test.authorize.mock.calls.some((entry) => entry[3].mode === 'write')).toBe(true);
    test.deny();
    expect((await fetch(endpoint)).status).toBe(403);
    expect((await fetch(`${endpoint}/history`)).status).toBe(403);
    expect((await fetch(`${endpoint}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"domain":"text","question":"x"}' })).status).toBe(403);
    expect(test.custodians.ask).toHaveBeenCalledTimes(1);
  });
  it('rejects remote origins, unknown request fields and excessive limits before invoking a custodian', async () => {
    const test = await fixture(), endpoint = `${test.url}/api/projects/project/custodians`;
    expect((await fetch(`${endpoint}/ask`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' }, body: '{"domain":"text","question":"x"}' })).status).toBe(403);
    expect((await fetch(`${endpoint}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"domain":"text","question":"x","limit":99}' })).status).toBe(400);
    expect((await fetch(`${endpoint}/activity`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"active":true,"paths":["C:/"]}' })).status).toBe(400);
    expect((await fetch(`${endpoint}/history?limit=999`)).status).toBe(400);
    expect(test.custodians.ask).not.toHaveBeenCalled(); expect(test.watch.activate).not.toHaveBeenCalled();
  });
  it('CLI uses the same endpoints with plain text prompt files, stdin and JSON output', async () => {
    const test = await fixture(), log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const flags = ['--project', 'project', '--daemon-url', test.url, '--json'];
    const question = path.join(test.root, 'question.txt'); await writeFile(question, 'Find the area table.\nPreserve units.');
    await runProjectCustodiansCli(['ask', ...flags, '--domain', 'images', '--prompt-file', question, '--limit', '6']);
    expect(test.custodians.ask).toHaveBeenCalledWith(test.root, { domain: 'images', question: 'Find the area table.\nPreserve units.', limit: 6 }, { kind: 'other', baseDir: test.root }, 'project');
    expect(JSON.parse(String(log.mock.calls.at(-1)![0])).result.answer).toBe('Evidence answer');
    vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(async function* () { yield 'Explain source revisions'; });
    await runProjectCustodiansCli(['ask', ...flags, '--domain', 'text', '--prompt-file', '-']);
    await runProjectCustodiansCli(['show', ...flags]);
    await runProjectCustodiansCli(['history', ...flags, '--limit', '3']);
    await runProjectCustodiansCli(['activity', ...flags, '--active', 'true']);
    expect(test.journal.read).toHaveBeenCalledWith('project', { limit: 3 });
    expect(test.watch.activate).toHaveBeenCalledTimes(1);
    await expect(runProjectCustodiansCli(['ask', ...flags, '--domain', 'text'])).rejects.toThrow('--prompt-file');
    test.deny(); await expect(runProjectCustodiansCli(['show', ...flags])).rejects.toThrow('Denied');
  });
  it('does not activate custodians or source indexing for a fast project', async () => {
    const test = await fixture(true), endpoint = `${test.url}/api/projects/project/custodians`;
    expect((await fetch(endpoint)).status).toBe(503);
    expect((await fetch(`${endpoint}/activity`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"active":true}' })).status).toBe(503);
    expect(test.watch.activate).not.toHaveBeenCalled(); expect(test.custodians.ledger).not.toHaveBeenCalled();
  });

});
