import express from 'express';
import type { Request, Response } from 'express';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlockoutDocument, type BlockoutDocument, type BlockoutMaterialInventory } from '@open-design/contracts';
import { registerBlockoutWorkspaceRoutes, type RegisterBlockoutWorkspaceRoutesDeps } from '../../src/routes/blockout-workspaces.js';
import { readBlockoutWorkspace, saveBlockoutWorkspace } from '../../src/services/blockout-workspaces.js';
import { assessBlockoutFit } from '../../src/services/blockout-fit.js';

vi.mock('../../src/services/blockout-fit.js', () => ({ assessBlockoutFit: vi.fn(async (document: BlockoutDocument, inventory: BlockoutMaterialInventory) => ({
  version: 1, documentId: document.documentId, documentRevision: JSON.stringify(document),
  status: inventory.status === 'ready' ? 'warning' : 'waiting', inventoryRevision: inventory.revision,
  variants: [], issues: [],
})) }));

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.clearAllMocks(); for (const close of cleanups.splice(0).reverse()) await close(); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'blockout-assessment-route-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const document = createBlockoutDocument(); document.title = 'Report'; document.planningStage = 'composition';
  await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: null });
  let allowed = true;
  const inventory = { version: 1, projectId: 'project', revision: 'a'.repeat(64), status: 'ready',
    sources: { processed: 1, total: 1, entries: [] }, items: [], gaps: [], createdAt: '', updatedAt: '' } as BlockoutMaterialInventory;
  const get = vi.fn(async () => inventory);
  const app = express(); app.use(express.json());
  registerBlockoutWorkspaceRoutes(app, {
    db: {}, paths: { PROJECTS_DIR: path.dirname(root) },
    authorizeProjectRequest: async (_req: Request, res: Response) => { if (!allowed) res.status(403).json({ error: { code: 'FORBIDDEN' } }); return allowed; },
    http: { sendApiError: (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
    projectStore: { getProject: (_db: unknown, id: string) => id === 'project' ? { id, metadata: { baseDir: root } } : null },
    blockoutMaterials: { get },
  } as unknown as RegisterBlockoutWorkspaceRoutesDeps);
  const server: Server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  cleanups.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test listener');
  const base = `http://127.0.0.1:${address.port}/api/projects/project/blockout-documents`;
  return { root, document, inventory, get, base, deny: () => { allowed = false; } };
}

describe('Blockout assessment HTTP boundary', () => {
  it('reconciles current materials and saved geometry for both GET and empty POST', async () => {
    const test = await fixture();
    const response = await fetch(`${test.base}/document-1/assessment`);
    expect(response.status).toBe(200);
    expect((await response.json() as { assessment: { status: string } }).assessment.status).toBe('warning');
    expect(test.get).toHaveBeenCalledWith(test.root, expect.objectContaining({ baseDir: test.root }), 'project');
    const current = await readBlockoutWorkspace(test.root, 'document-1');
    const changed = { ...test.document, title: 'Edited saved geometry' };
    await saveBlockoutWorkspace(test.root, 'document-1', { document: changed, baseRaw: current.raw });
    const post = await fetch(`${test.base}/document-1/assessment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(post.status).toBe(200);
    expect(vi.mocked(assessBlockoutFit).mock.calls.at(-1)?.[0].title).toBe('Edited saved geometry');
    expect(test.get).toHaveBeenCalledTimes(2);
  });

  it('assesses an unsaved proposal without persisting it or trusting a claimed result', async () => {
    const test = await fixture(), before = await readBlockoutWorkspace(test.root, 'document-1');
    const proposal: BlockoutDocument = { ...test.document, title: 'Unsaved alternative' };
    const post = await fetch(`${test.base}/document-1/assessment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document: proposal, assessment: { status: 'ready' } }) });
    expect(post.status).toBe(200);
    expect((await post.json() as { assessment: { status: string } }).assessment.status).toBe('warning');
    expect(vi.mocked(assessBlockoutFit).mock.calls.at(-1)?.[0].title).toBe('Unsaved alternative');
    expect((await readBlockoutWorkspace(test.root, 'document-1')).raw).toBe(before.raw);
  });

  it('returns waiting for incomplete material and rejects a cross-document payload', async () => {
    const test = await fixture(); test.inventory.status = 'waiting';
    const get = await fetch(`${test.base}/document-1/assessment`);
    expect((await get.json() as { assessment: { status: string } }).assessment.status).toBe('waiting');
    const post = await fetch(`${test.base}/document-1/assessment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document: { ...test.document, documentId: 'document-2' } }) });
    expect(post.status).toBe(400);
    expect((await post.json() as { error: { code: string } }).error.code).toBe('BLOCKOUT_ASSESSMENT_FAILED');
  });

  it('checks authorization and document existence before reading inventory', async () => {
    const test = await fixture();
    const missing = await fetch(`${test.base}/document-2/assessment`);
    expect(missing.status).toBe(404); expect(test.get).not.toHaveBeenCalled();
    test.deny();
    const denied = await fetch(`${test.base}/document-1/assessment`);
    expect(denied.status).toBe(403); expect(test.get).not.toHaveBeenCalled();
    expect(assessBlockoutFit).not.toHaveBeenCalled();
  });
});
