import express, { type Response } from 'express';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { blockoutWorkspacePath, createBlockoutDocument, createDocumentPresentation, documentSetupPath } from '@open-design/contracts';
import { closeDatabase, getProject, insertProject, openDatabase } from '../src/db.js';
import { registerDocumentSetupRoutes, type RegisterDocumentSetupRoutesDeps } from '../src/routes/document-setup.js';
import { registerBlockoutWorkspaceRoutes, type RegisterBlockoutWorkspaceRoutesDeps } from '../src/routes/blockout-workspaces.js';
import { ProjectDocumentsRuntime } from '../src/services/project-documents-runtime.js';
import { readDocumentSetup, saveDocumentSetupIntent } from '../src/services/document-setup.js';
import { readBlockoutWorkspace, saveBlockoutWorkspace } from '../src/services/blockout-workspaces.js';
import { loadBlockoutContext } from '../src/services/blockout-context.js';
import type { BlockoutDesignRun, BlockoutDesignRunLookup, BlockoutDesignRunTarget } from '../src/services/blockout-design.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(getDesignRun?: BlockoutDesignRunLookup) {
  const root = await mkdtemp(path.join(tmpdir(), 'melillo-document-scope-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, 'data'), parentRoot = path.join(root, 'project'), projectsRoot = path.join(dataRoot, 'projects');
  await mkdir(parentRoot); await mkdir(projectsRoot, { recursive: true });
  const db = openDatabase(root, { dataDir: dataRoot }); cleanup.push(async () => closeDatabase());
  insertProject(db, { id: 'parent', name: 'Collection', metadata: { kind: 'other', baseDir: parentRoot }, createdAt: 1, updatedAt: 1 });
  await saveDocumentSetupIntent(parentRoot, { kind: 'report', subtype: 'Collection brief', purpose: 'PARENT UNCHANGED', contextRoots: [], imageIntakeConsent: false }, undefined, 'parent');
  const runtime = new ProjectDocumentsRuntime({ db, dataRoot, projectsRoot }), store = await runtime.store('parent', parentRoot);
  const child = (await store.create({ name: 'Child report', kind: 'document' }, runtime.bootstrapWorkspace)).document;
  const app = express(); app.use(express.json());
  const dependencies = { db, paths: { PROJECTS_DIR: projectsRoot }, projectStore: { getProject },
    http: { sendApiError: (res: Response, status: number, code: string, message: string, init?: { details?: unknown }) => res.status(status).json({ error: { code, message, ...init } }) },
    authorizeProjectRequest: async () => true, documentRegistry: runtime, beforeSetupWrite: runtime.beforeSetupWrite, beforeBlockoutWrite: runtime.beforeBlockoutWrite,
    ...(getDesignRun ? { getDesignRun } : {}),
  } as unknown as RegisterDocumentSetupRoutesDeps & RegisterBlockoutWorkspaceRoutesDeps;
  registerDocumentSetupRoutes(app, dependencies); registerBlockoutWorkspaceRoutes(app, dependencies);
  const server: Server = await new Promise((resolve) => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test address');
  return { root, parentRoot, dataRoot, projectsRoot, db, runtime, child, store, url: `http://127.0.0.1:${address.port}` };
}
const headers = { 'content-type': 'application/json' };

describe('Registered document workspace scope before writes', () => {
  it('registers and applies a parent-chat design only in its explicitly attached child workspace', async () => {
    let run: BlockoutDesignRun = { projectId: 'parent', status: 'running' };
    const f = await fixture((id) => id === 'parent-run' ? run : null);
    const document = createBlockoutDocument(); document.documentId = f.child.id; document.title = f.child.name;
    document.approval = { variantId: 'brief', acceptedAt: '2026-10-26T10:00:00Z' };
    const base = `${f.url}/api/projects/${f.child.workspaceProjectId}/blockout-documents/${f.child.id}`;
    const savedResponse = await fetch(base, { method: 'PUT', headers, body: JSON.stringify({ document, baseRaw: null }) });
    expect(savedResponse.status).toBe(200);
    const saved = await savedResponse.json() as { document: typeof document; raw: string };
    const briefResponse = await fetch(`${base}/starting-point`, { method: 'POST', headers,
      body: JSON.stringify({ document: saved.document, baseRaw: saved.raw, requestId: 'child-design', action: 'develop-design' }) });
    expect(briefResponse.status).toBe(200);
    const brief = await briefResponse.json() as { path: string };
    const targets: BlockoutDesignRunTarget[] = [];
    await loadBlockoutContext(f.parentRoot, [`documents/${f.child.id}/${brief.path}`], undefined,
      { projectId: 'parent', dataRoot: f.dataRoot, projectsRoot: f.projectsRoot, getProject: (id) => getProject(f.db, id),
        authorize: async () => true, onDesignHandoff: (target) => { targets.push(target); } });
    expect(targets).toHaveLength(1);
    await writeFile(path.join(f.child.workingDirectory, 'report.html'), `<article data-blockout-document-id="${f.child.id}" data-blockout-page-id="page-1">Child design</article>`);
    const input = { handoffId: 'child-design', runId: 'parent-run', entryFile: 'report.html',
      pages: [{ pageId: 'page-1', filePath: 'report.html', widthPx: 794, heightPx: 1123, blocks: [] }] };
    const register = () => fetch(`${base}/design`, { method: 'POST', headers: { ...headers, 'x-od-run-id': 'parent-run' }, body: JSON.stringify(input) });
    expect((await register()).status).toBe(400); // Parent ownership alone is insufficient.
    run = { ...run, blockoutDesignTargets: targets };
    const registered = await register(); expect(registered.status).toBe(200);
    expect(await registered.json()).toMatchObject({ pending: [{ runProjectId: 'parent', runId: 'parent-run', status: 'pending' }] });
    // Reconciliation after a daemon restart uses the verified persisted run
    // owner, rather than requiring transient prompt state or a child chat.
    run = { projectId: 'parent', status: 'succeeded', deliverableValid: true };
    const state = await fetch(`${base}/design`); expect(state.status).toBe(200);
    expect(await state.json()).toMatchObject({ applied: { runId: 'parent-run', entryFile: 'report.html', status: 'applied' } });
    const page = await fetch(`${base}/design/pages/page-1`); expect(page.status).toBe(200);
    expect(await page.json()).toMatchObject({ html: expect.stringContaining('Child design') });
    expect((await f.store.get(f.child.id)).entryFile).toBe('report.html');
    await expect(stat(path.join(f.parentRoot, blockoutWorkspacePath(f.child.id)))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects parent setup set/confirm for a child before changing either saved brief', async () => {
    const f = await fixture(), parentPath = path.join(f.parentRoot, documentSetupPath('parent')), childPath = path.join(f.child.workingDirectory, documentSetupPath(f.child.workspaceProjectId));
    const beforeParent = await readFile(parentPath, 'utf8'), beforeChild = await readFile(childPath, 'utf8');
    const presentation = { ...createDocumentPresentation('Child report'), status: 'confirmed', header: false, footer: false, cover: false, pageNumbers: false };
    const input = { purpose: 'WRONG SCOPE', editorialSettings: [{ documentId: f.child.id, presentation }] };
    for (const confirm of [false, true]) {
      const response = await fetch(`${f.url}/api/projects/parent/document-setup${confirm ? '/confirm' : ''}`, { method: confirm ? 'POST' : 'PUT', headers, body: JSON.stringify(confirm ? { ...input, constraints: [], blockoutApproach: 'manual' } : input) });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: 'DOCUMENT_WORKSPACE_REQUIRED', details: { documentId: f.child.id, workspaceProjectId: f.child.workspaceProjectId } } });
      expect(await readFile(parentPath, 'utf8')).toBe(beforeParent); expect(await readFile(childPath, 'utf8')).toBe(beforeChild);
    }
    const correct = await fetch(`${f.url}/api/projects/${f.child.workspaceProjectId}/document-setup`, { method: 'PUT', headers, body: JSON.stringify({ ...input, purpose: 'CORRECT CHILD SCOPE' }) });
    expect(correct.status).toBe(200); expect((await readDocumentSetup(f.child.workingDirectory, undefined, f.child.workspaceProjectId))?.intent.purpose).toBe('CORRECT CHILD SCOPE');
    expect(await readFile(parentPath, 'utf8')).toBe(beforeParent);
  });

  it('rejects child Blockout saves and catalogs sent to the parent before any layout is written', async () => {
    const f = await fixture(), document = createBlockoutDocument(); document.documentId = f.child.id; document.title = f.child.name;
    const endpoint = `${f.url}/api/projects/parent/blockout-documents`;
    const parentBefore = await readFile(path.join(f.parentRoot, documentSetupPath('parent')), 'utf8');
    const saved = await fetch(`${endpoint}/${f.child.id}`, { method: 'PUT', headers, body: JSON.stringify({ document, baseRaw: null }) });
    expect(saved.status).toBe(409); const rejected = await saved.json() as { error: { message: string } }; expect(rejected.error.message).toContain(`--project ${f.child.workspaceProjectId}`);
    await expect(stat(path.join(f.parentRoot, blockoutWorkspacePath(f.child.id)))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readBlockoutWorkspace(f.child.workingDirectory, f.child.id)).document).toBe(null);
    const catalog = await fetch(endpoint, { method: 'PUT', headers, body: JSON.stringify({ version: 1, documents: [{ id: f.child.id, title: f.child.name }] }) });
    expect(catalog.status).toBe(409); expect(await readFile(path.join(f.parentRoot, documentSetupPath('parent')), 'utf8')).toBe(parentBefore);
    const correct = await fetch(`${f.url}/api/projects/${f.child.workspaceProjectId}/blockout-documents/${f.child.id}`, { method: 'PUT', headers, body: JSON.stringify({ document, baseRaw: null }) });
    expect(correct.status).toBe(200); expect((await readBlockoutWorkspace(f.child.workingDirectory, f.child.id)).document?.documentId).toBe(f.child.id);
  });

  it('allows legacy parent-owned documents and unregistered initial outputs', async () => {
    const f = await fixture(), legacy = createBlockoutDocument(); legacy.documentId = 'legacy-parent'; legacy.title = 'Legacy';
    await saveBlockoutWorkspace(f.parentRoot, legacy.documentId, { document: legacy, baseRaw: null }); await f.store.list();
    await expect(f.runtime.beforeSetupWrite('parent', { editorialSettings: [{ documentId: legacy.documentId }] })).resolves.toBeUndefined();
    await expect(f.runtime.beforeBlockoutWrite('parent', [legacy.documentId])).resolves.toBeUndefined();
    await expect(f.runtime.beforeSetupWrite('parent', { editorialSettings: [{ documentId: 'new-report' }, { documentId: 'new-graphics' }] })).resolves.toBeUndefined();
    await expect(f.runtime.beforeSetupWrite(f.child.workspaceProjectId, { editorialSettings: [{ documentId: legacy.documentId }] })).rejects.toMatchObject({ statusCode: 409, workspaceProjectId: 'parent' });
  });
});
