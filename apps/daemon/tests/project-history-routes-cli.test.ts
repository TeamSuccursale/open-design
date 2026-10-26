import express, { type Response } from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { registerProjectHistoryRoutes, type RegisterProjectHistoryRoutesDeps } from '../src/routes/project-history.js';
import { handleProjectHistoryCli } from '../src/services/project-history-cli.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function fixture() {
  const store = { list: vi.fn(async () => ({ entries: [] })), version: vi.fn(async () => ({})), compare: vi.fn(async () => ({ changes: [] })), restore: vi.fn(async () => ({ restoredPaths: ['a.txt'] })), checkpoint: vi.fn(async () => null) };
  let denied = false, running = false;
  const authorize = vi.fn(async (_req, res, _id, _options) => { if (denied) { res.status(403).json({ error: { message: 'Denied' } }); return false; } return true; });
  const app = express(); app.use(express.json());
  registerProjectHistoryRoutes(app, { db: {}, paths: { PROJECTS_DIR: process.cwd() }, projectStore: { getProject: (_db: unknown, id: string) => ({ id, metadata: {} }) }, authorizeProjectRequest: authorize, history: { store: async () => store, isAgentRunning: () => running }, http: { sendApiError: (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) } } as unknown as RegisterProjectHistoryRoutesDeps);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  cleanups.push(() => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address');
  const url = `http://127.0.0.1:${address.port}`;
  const post = (action: string, body: unknown, origin?: string) => fetch(`${url}/api/projects/p/history/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
  return { store, authorize, url, post, deny: () => { denied = true; }, run: () => { running = true; } };
}
it('enforces project authority and local mutation checks', async () => {
  const f = await fixture(); expect((await fetch(`${f.url}/api/projects/p/history`)).status).toBe(200);
  expect((await f.post('checkpoint', {}, 'https://example.com')).status).toBe(403); expect(f.store.checkpoint).not.toHaveBeenCalled();
  await f.post('checkpoint', {}); expect(f.authorize.mock.calls.at(-1)?.[3]).toEqual({ mode: 'write', capability: 'writeFiles' });
  f.deny(); expect((await fetch(`${f.url}/api/projects/p/history`)).status).toBe(403); expect((await f.post('restore', { entryId: 'old', baseRevision: 'current' })).status).toBe(403);
});
it('rejects malformed requests, active agents and conflicts with safe errors', async () => {
  const f = await fixture(); expect((await f.post('restore', { entryId: 'old' })).status).toBe(400);
  expect((await f.post('restore', { entryId: 'old', baseRevision: 'current', force: true })).status).toBe(400);
  f.store.restore.mockRejectedValueOnce(Object.assign(new Error('secret path'), { statusCode: 409 }));
  const response = await f.post('restore', { entryId: 'old', baseRevision: 'current' }); expect(response.status).toBe(409); expect(await response.text()).not.toContain('secret path');
  f.run(); expect((await f.post('restore', { entryId: 'old', baseRevision: 'current' })).status).toBe(409); expect(f.store.restore).toHaveBeenCalledTimes(1);
});
it('validates list limits and comparison requests and maps missing entries to 404', async () => {
  const f = await fixture();
  expect((await fetch(`${f.url}/api/projects/p/history?limit=201`)).status).toBe(400);
  expect((await fetch(`${f.url}/api/projects/p/history?limit=2&before=old`)).status).toBe(200);
  expect(f.store.list).toHaveBeenCalledWith(2, 'old');
  expect((await fetch(`${f.url}/api/projects/p/history?before=../outside`)).status).toBe(400);
  expect((await f.post('compare', {})).status).toBe(400);
  expect((await f.post('compare', { fromId: 'old', toId: 'new', path: 'a.txt' })).status).toBe(200);
  expect(f.store.compare).toHaveBeenCalledWith('old', 'new', 'a.txt');
  expect(f.authorize.mock.calls.at(-1)?.[3]).toEqual({ mode: 'read' });
  f.store.version.mockRejectedValueOnce(Object.assign(new Error('private path'), { statusCode: 404 }));
  expect((await fetch(`${f.url}/api/projects/p/history/entries/missing`)).status).toBe(404);
});
it('roundtrips CLI JSON input through HTTP with exact paths and long summaries', async () => {
  const f = await fixture(), output: string[] = [], flags = ['--project', 'p', '--daemon-url', f.url, '--json', '--prompt-file', '-'];
  await handleProjectHistoryCli(['restore', ...flags], { readInput: async () => JSON.stringify({ entryId: 'old', baseRevision: 'current', paths: ['a,b.txt'] }), write: value => output.push(value) });
  expect(f.store.restore).toHaveBeenCalledWith({ entryId: 'old', baseRevision: 'current', paths: ['a,b.txt'] }); expect(JSON.parse(output[0]!)).toEqual({ restoredPaths: ['a.txt'] });
  await handleProjectHistoryCli(['checkpoint', ...flags], { readInput: async () => JSON.stringify({ title: 'Title', summary: 'One\nTwo' }), write: value => output.push(value) });
  expect(f.store.checkpoint).toHaveBeenCalledWith('manual', 'Title', 'One\nTwo');
  await handleProjectHistoryCli(['list', '--project', 'p', '--daemon-url', f.url, '--limit', '2', '--before', 'old', '--json'], { write: value => output.push(value) });
  expect(f.store.list).toHaveBeenCalledWith(2, 'old');
  await expect(handleProjectHistoryCli(['restore', '--project', 'p', '--force'])).rejects.toThrow('Invalid history option');
});
