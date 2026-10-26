import express from 'express';
import type { Response } from 'express';
import type { Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentResearchResponse, DocumentResearchRun, StartDocumentResearch } from '@open-design/contracts';
import { registerDocumentResearchRoutes, type RegisterDocumentResearchRoutesDeps } from '../src/routes/document-research.js';
import { runDocumentResearchCli } from '../src/services/document-research-cli.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });

function reading(status: DocumentResearchRun['status'] = 'queued'): DocumentResearchRun {
  return {
    version: 1, id: 'run-1', projectId: 'project', fingerprint: 'a'.repeat(64), model: 'gpt-6.1-sol', scope: 'selected-project-documents',
    status, stage: status === 'queued' ? 'quick' : 'full', sources: [], overview: [], findings: [], workers: [],
    coverage: { sourcesTotal: 0, sourcesAnalyzed: 0, pagesTotal: 0, pagesExtracted: 0, pagesAnalyzed: 0, pagesUnreadable: 0, pendingPages: 0, sources: [], visual: 'not-performed' },
    warnings: [], createdAt: '2026-10-23T12:00:00Z', updatedAt: '2026-10-23T12:00:00Z',
  };
}

async function fixture(fast = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'document-research-api-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  let state: DocumentResearchRun | null = null;
  const service = {
    read: vi.fn(async () => state),
    start: vi.fn(async (_root: string, _input: StartDocumentResearch, _metadata?: unknown, _projectId?: string) => { state = reading(); return state; }),
  };
  let authorized = true;
  const authorize = vi.fn(async (_req, res, _id, _options) => { if (!authorized) { res.status(403).json({ error: { message: 'Denied' } }); return false; } return true; });
  const app = express(); app.use(express.json());
  registerDocumentResearchRoutes(app, {
    db: {}, paths: { PROJECTS_DIR: path.dirname(root), RUNTIME_DATA_DIR: root }, documentResearch: service,
    authorizeProjectRequest: authorize,
    http: { sendApiError: (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
    projectStore: { getProject: (_db: unknown, id: string) => id === 'project' ? { id, metadata: { kind: 'other', baseDir: root, ...(fast ? { projectMode: 'fast' } : {}) } } : null },
  } as unknown as RegisterDocumentResearchRoutesDeps);
  const server: Server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Server did not bind');
  return { root, service, authorize, url: `http://127.0.0.1:${address.port}`, deny: () => { authorized = false; }, complete: () => { state = reading('complete'); } };
}

describe('document research HTTP and CLI', () => {
  it('authorizes project reads and writes and exposes the persisted overview/full state', async () => {
    const test = await fixture(), endpoint = `${test.url}/api/projects/project/document-research`;
    expect((await (await fetch(endpoint)).json() as DocumentResearchResponse).research).toBeNull();
    const started = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourcePaths: ['source.pdf'], question: 'Find facts' }) });
    expect(started.status).toBe(202);
    expect(test.service.start).toHaveBeenCalledWith(test.root, { retry: false, sourcePaths: ['source.pdf'], question: 'Find facts' }, { kind: 'other', baseDir: test.root }, 'project');
    test.complete();
    expect((await (await fetch(endpoint)).json() as DocumentResearchResponse).research?.status).toBe('complete');
    expect((await fetch(`${test.url}/api/projects/missing/document-research`)).status).toBe(404);
    expect(test.authorize.mock.calls.some((call) => call[3].mode === 'write' && call[3].capability === 'writeFiles')).toBe(true);
    test.deny();
    expect((await fetch(endpoint)).status).toBe(403);
    expect((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect(test.service.start).toHaveBeenCalledTimes(1);
  });

  it('rejects unexpected options and nonlocal origins before starting model work', async () => {
    const test = await fixture(), endpoint = `${test.url}/api/projects/project/document-research`;
    expect((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"imageConsent":true}' })).status).toBe(400);
    expect((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' }, body: '{}' })).status).toBe(403);
    expect(test.service.start).not.toHaveBeenCalled();
  });

  it('uses prompt-file and stdin with the same start, retry and show HTTP endpoints', async () => {
    const test = await fixture(), log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const flags = ['--project', 'project', '--daemon-url', test.url, '--json'];
    const input = path.join(test.root, 'research.json');
    await writeFile(input, JSON.stringify({ sourcePaths: ['source.pdf'], question: 'Find facts' }));
    await runDocumentResearchCli(['start', ...flags, '--prompt-file', input]);
    expect(test.service.start.mock.calls.at(-1)?.[1]).toEqual({ retry: false, sourcePaths: ['source.pdf'], question: 'Find facts' });
    expect((JSON.parse(String(log.mock.calls.at(-1)?.[0])) as DocumentResearchResponse).research?.status).toBe('queued');
    test.complete();
    await runDocumentResearchCli(['show', ...flags]);
    expect((JSON.parse(String(log.mock.calls.at(-1)?.[0])) as DocumentResearchResponse).research?.status).toBe('complete');
    vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(async function* () { yield '{"question":"Research again"}'; });
    await runDocumentResearchCli(['retry', ...flags, '--prompt-file', '-']);
    expect(test.service.start.mock.calls.at(-1)?.[1]).toEqual({ retry: true, question: 'Research again' });
  });

  it('reports HTTP errors and validates CLI arguments before network calls', async () => {
    const test = await fixture();
    await expect(runDocumentResearchCli(['show'])).rejects.toThrow('--project is required');
    await expect(runDocumentResearchCli(['show', '--project', 'project', '--prompt-file', '-'])).rejects.toThrow('--prompt-file applies');
    await expect(runDocumentResearchCli(['start', '--project', 'project', '--bad-option'])).rejects.toThrow('Invalid document-research option');
    test.deny();
    await expect(runDocumentResearchCli(['show', '--project', 'project', '--daemon-url', test.url])).rejects.toThrow('Denied');
  });
  it('does not start document research or read its state for a fast project', async () => {
    const test = await fixture(true), endpoint = `${test.url}/api/projects/project/document-research`;
    expect((await fetch(endpoint)).status).toBe(503);
    expect((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(503);
    expect(test.service.start).not.toHaveBeenCalled(); expect(test.service.read).not.toHaveBeenCalled();
  });

});
