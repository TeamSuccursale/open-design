import express from 'express';
import type { Response } from 'express';
import type { Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentOverviewReadingResponse } from '@open-design/contracts';
import { registerDocumentOverviewReadingRoutes, type RegisterDocumentOverviewReadingRoutesDeps } from '../src/routes/document-overview-reading.js';
import { runDocumentOverviewReadingCli } from '../src/services/document-overview-reading-cli.js';
import { DocumentOverviewReadingService } from '../src/services/document-overview-reading.js';
import { saveDocumentSetupIntent, scanDocumentSetupContext } from '../src/services/document-setup.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'overview-reading-api-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'disciplinare.txt'), 'Offerta: massimo 4 pagine A4.');
  await saveDocumentSetupIntent(root, { kind: 'tender-offer', subtype: 'Offerta tecnica' }, undefined, 'project');
  await scanDocumentSetupContext(root, undefined, undefined, 'project');
  const runner = vi.fn(async (request) => ({ summary: 'Proposed layout notes', notes: [{ text: 'A4', certainty: 'documented', sourceIds: [request.sources[0].id] }], questions: [] }));
  const service = new DocumentOverviewReadingService({ dataDir: root, runner });
  let authorized = true;
  const authorize = vi.fn(async (_req, res, _id, _options) => { if (!authorized) { res.status(403).json({ error: 'Denied' }); return false; } return true; });
  const app = express(); app.use(express.json());
  registerDocumentOverviewReadingRoutes(app, {
    db: {}, paths: { PROJECTS_DIR: path.dirname(root), RUNTIME_DATA_DIR: root }, overviewReading: service,
    authorizeProjectRequest: authorize,
    http: { sendApiError: (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
    projectStore: { getProject: (_db: unknown, id: string) => id === 'project' ? { id, metadata: { kind: 'other', baseDir: root } } : null },
  } as unknown as RegisterDocumentOverviewReadingRoutesDeps);
  const server: Server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Server did not bind');
  return { root, service, runner, authorize, url: `http://127.0.0.1:${address.port}`, deny: () => { authorized = false; } };
}

describe('document overview reading HTTP and CLI', () => {
  it('starts the same persisted readonly background job through HTTP and enforces project authorization', async () => {
    const test = await fixture(), endpoint = `${test.url}/api/projects/project/document-overview-reading`;
    expect((await (await fetch(endpoint)).json() as DocumentOverviewReadingResponse).reading).toBeNull();
    const started = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(started.status).toBe(202);
    await test.service.waitForIdle(test.root, 'project');
    const finished = await (await fetch(endpoint)).json() as DocumentOverviewReadingResponse;
    expect(finished.reading?.status).toBe('complete');
    expect(finished.reading?.projectId).toBe('project');
    expect(test.runner).toHaveBeenCalledTimes(1);
    expect((await fetch(`${test.url}/api/projects/missing/document-overview-reading`)).status).toBe(404);
    expect(test.authorize.mock.calls.some((call) => call[3].mode === 'write' && call[3].capability === 'writeFiles')).toBe(true);
    test.deny(); expect((await fetch(endpoint)).status).toBe(403);
  });

  it('uses --prompt-file and --json against the same start/status/retry endpoints', async () => {
    const test = await fixture(), log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const flags = ['--project', 'project', '--daemon-url', test.url, '--json'];
    const input = path.join(test.root, 'start-reading.json'); await writeFile(input, '{}');
    await runDocumentOverviewReadingCli(['start', ...flags, '--prompt-file', input]);
    const first = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as DocumentOverviewReadingResponse;
    await test.service.waitForIdle(test.root, 'project');
    await runDocumentOverviewReadingCli(['show', ...flags]);
    expect((JSON.parse(String(log.mock.calls.at(-1)?.[0])) as DocumentOverviewReadingResponse).reading?.status).toBe('complete');
    vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(async function* () { yield '{}'; });
    await runDocumentOverviewReadingCli(['retry', ...flags, '--prompt-file', '-']);
    expect((JSON.parse(String(log.mock.calls.at(-1)?.[0])) as DocumentOverviewReadingResponse).reading?.id).not.toBe(first.reading?.id);
    await test.service.waitForIdle(test.root, 'project');
    expect(test.runner).toHaveBeenCalledTimes(2);
  });
});
