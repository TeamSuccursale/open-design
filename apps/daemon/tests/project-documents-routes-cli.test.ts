import express, { type Response } from 'express';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocumentMutationResponse, ProjectDocumentsResponse, ProjectDocumentWorkspaceBootstrap } from '@open-design/contracts';
import { registerProjectDocumentsRoutes, type RegisterProjectDocumentsRoutesDeps } from '../src/routes/project-documents.js';
import { ProjectDocumentsStore } from '../src/services/project-documents.js';
import { runProjectDocumentsCli } from '../src/services/project-documents-cli.js';
import { ProjectDocumentsRuntime } from '../src/services/project-documents-runtime.js';
import { closeDatabase, getProject, insertProject, openDatabase } from '../src/db.js';
import { createBlockoutDocument } from '@open-design/contracts';
import { readBlockoutWorkspace, saveBlockoutWorkspace } from '../src/services/blockout-workspaces.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(realRuntime = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'melillo-document-api-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, 'project'), otherRoot = path.join(root, 'other'), dataRoot = path.join(root, 'data');
  await Promise.all([mkdir(projectRoot), mkdir(otherRoot), mkdir(dataRoot)]);
  const stores = { project: new ProjectDocumentsStore({ projectRoot, dataRoot, projectId: 'project' }), other: new ProjectDocumentsStore({ projectRoot: otherRoot, dataRoot, projectId: 'other' }) };
  const db = realRuntime ? openDatabase(root, { dataDir: dataRoot }) : null;
  if (db) {
    cleanup.push(async () => closeDatabase());
    for (const [id, directory] of [['project', projectRoot], ['other', otherRoot]]) insertProject(db, { id: id!, name: 'Fast project', metadata: { kind: 'other', projectMode: 'fast', baseDir: directory }, createdAt: 1, updatedAt: 1 });
  }
  const runtime = db ? new ProjectDocumentsRuntime({ db, dataRoot, projectsRoot: path.join(dataRoot, 'projects') }) : null;
  let denied = false, writesDenied = false; const deniedProjects = new Set<string>();
  const authorize = vi.fn(async (_req, res: Response, _id: string, options) => { if (!denied && !deniedProjects.has(_id) && !(writesDenied && options.mode === 'write')) return true; res.status(403).json({ error: { message: 'Denied' } }); return false; });
  const openDocument = vi.fn(async (id: keyof typeof stores, root: string, documentId: string) => runtime ? runtime.openDocument(id, root, documentId) : stores[id].update(documentId, { select: true }));
  const updates = vi.fn(async (...args: Parameters<ProjectDocumentsRuntime['onDocumentUpdated']>) => runtime?.onDocumentUpdated(...args)), app = express(); app.use(express.json());
  registerProjectDocumentsRoutes(app, { db: db ?? {}, paths: { PROJECTS_DIR: root }, authorizeProjectRequest: authorize,
    http: { sendApiError: (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
    projectStore: { getProject: (_db: unknown, id: string) => db ? getProject(db, id) : id === 'project' || id === 'other' ? { id, metadata: { baseDir: id === 'project' ? projectRoot : otherRoot } } : null },
    documents: { store: (id: keyof typeof stores, root: string) => runtime ? runtime.store(id, root) : stores[id], openDocument, bootstrapWorkspace: runtime?.bootstrapWorkspace ?? (async (input: ProjectDocumentWorkspaceBootstrap) => ({ workspaceProjectId: input.workspaceProjectId ?? `workspace-${input.documentId}`, conversationId: `chat-${input.documentId}` })), onDocumentUpdated: updates, authorizeConversation: (id: string, projects: string[]) => id === 'owned-chat' && projects.includes('project') },
  } as unknown as RegisterProjectDocumentsRoutesDeps);
  const server: Server = await new Promise((resolve) => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test address');
  return { root, stores, runtime, updates, authorize, openDocument, url: `http://127.0.0.1:${address.port}`, deny: () => { denied = true; }, denyProject: (id: string) => deniedProjects.add(id), denyWrites: () => { writesDenied = true; } };
}
const jsonHeaders = { 'content-type': 'application/json' };

describe('Project documents HTTP and CLI', () => {
  it('publishes a completed design entry without changing an open editor revision', async () => {
    const f = await fixture(true);
    const created = await (await fetch(`${f.url}/api/projects/project/documents`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'Report', kind: 'document' }) })).json() as ProjectDocumentMutationResponse;
    const document = createBlockoutDocument(); document.documentId = created.document.id; document.title = 'Report';
    const saved = await saveBlockoutWorkspace(created.document.workingDirectory, document.documentId, { document, baseRaw: null });
    await writeFile(path.join(created.document.workingDirectory, 'design.html'), '<html>Designed document</html>');
    const normalize = vi.spyOn(f.runtime!, 'onDocumentUpdated');
    await f.runtime!.blockoutUpdated(created.document.workspaceProjectId, document, 'design.html', { entryOnly: true });
    expect(normalize).not.toHaveBeenCalled();
    expect((await readBlockoutWorkspace(created.document.workingDirectory, document.documentId)).raw).toBe(saved.raw);
    expect((await f.stores.project.get(created.document.id)).entryFile).toBe('design.html');
  });
  it('replays a timed-out create through the same UI/CLI request identity', async () => {
    const f = await fixture(), outputs: string[] = [], requestId = 'ef4de02e-b769-4d46-a3c4-b1b0dd5940e3';
    const flags = ['create', '--project', 'project', '--name', 'Original document', '--request-id', requestId, '--daemon-url', f.url, '--json'];
    await runProjectDocumentsCli(flags, { write: (value) => outputs.push(value) });
    await runProjectDocumentsCli(flags, { write: (value) => outputs.push(value) });
    expect(JSON.parse(outputs[0]!).document.id).toBe(JSON.parse(outputs[1]!).document.id);
    expect((await f.stores.project.list()).documents).toHaveLength(1);
  });
  it('resolves a child workspace to its one parent library only when both scopes are authorized', async () => {
    const f = await fixture(true), endpoint = `${f.url}/api/projects/project/documents`;
    const created = await (await fetch(endpoint, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'Child document', kind: 'document' }) })).json() as ProjectDocumentMutationResponse;
    const childEndpoint = `${f.url}/api/projects/${created.document.workspaceProjectId}/documents`;
    const response = await fetch(childEndpoint); expect(response.status).toBe(200);
    const list = await response.json() as ProjectDocumentsResponse;
    expect(list.documents.map((item) => item.id)).toEqual([created.document.id]);
    expect(list.documents[0]?.projectId).toBe('project');
    expect(f.authorize.mock.calls.slice(-2).map((call) => call[2])).toEqual([created.document.workspaceProjectId, 'project']);
    f.denyProject('project'); expect((await fetch(childEndpoint)).status).toBe(403);
  });
  it('creates the real CLI report without a subtype once, and rejects invalid setup before leaving a document behind', async () => {
    const f = await fixture(true), endpoint = `${f.url}/api/projects/project/documents`;
    const invalid = await fetch(endpoint, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'Relazione tecnica veloce', kind: 'document', documentType: { kind: 'report', subtype: '' }, presentation: { version: 1, status: 'confirmed', name: 'Relazione tecnica veloce' } }) });
    expect(invalid.status).toBe(400);
    expect(((await (await fetch(endpoint)).json()) as ProjectDocumentsResponse).documents).toEqual([]);
    const outputs: string[] = [];
    await runProjectDocumentsCli(['create', '--project', 'project', '--name', 'Relazione tecnica veloce', '--kind', 'document', '--type', 'report', '--daemon-url', f.url, '--json'], { write: (value) => outputs.push(value) });
    const result = JSON.parse(outputs[0]!) as ProjectDocumentMutationResponse;
    expect(result.document.documentType).toEqual({ kind: 'report', subtype: 'Relazione tecnica veloce' });
    expect(((await (await fetch(endpoint)).json()) as ProjectDocumentsResponse).documents.map((document) => document.id)).toEqual([result.document.id]);
    expect(f.updates).toHaveBeenCalledOnce();
  });

  it('opens an editing chat only through the authorized mutation endpoint mirrored by the CLI', async () => {
    const f = await fixture(), endpoint = `${f.url}/api/projects/project/documents`;
    const created = await (await fetch(endpoint, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'Report', kind: 'document' }) })).json() as ProjectDocumentMutationResponse;
    expect((await fetch(endpoint)).status).toBe(200);
    expect((await fetch(`${endpoint}/${created.document.id}`)).status).toBe(200);
    expect(f.openDocument).not.toHaveBeenCalled();
    const outputs: string[] = [];
    await runProjectDocumentsCli(['open', '--project', 'project', '--document', created.document.id, '--daemon-url', f.url, '--json'], { write: (value) => outputs.push(value) });
    expect(JSON.parse(outputs[0]!).document.conversationIds).toEqual(created.document.conversationIds);
    expect(f.openDocument).toHaveBeenCalledTimes(1);
    expect(f.authorize.mock.calls.at(-1)?.[3]).toMatchObject({ mode: 'write', capability: 'writeFiles' });
    f.denyWrites(); expect((await fetch(endpoint)).status).toBe(200);
    expect((await fetch(`${endpoint}/${created.document.id}/open`, { method: 'POST', headers: jsonHeaders, body: '{}' })).status).toBe(403);
    expect(f.openDocument).toHaveBeenCalledTimes(1);
    await expect(runProjectDocumentsCli(['open', '--project', 'project', '--document', created.document.id, '--daemon-url', f.url, '--json'])).rejects.toThrow('Denied');
    expect(f.openDocument).toHaveBeenCalledTimes(1);
  });

  it('shares create, context, rename, selection and recoverable archive through HTTP and od documents', async () => {
    const f = await fixture(), outputs: string[] = [], write = (value: string) => outputs.push(value), flags = ['--project', 'project', '--daemon-url', f.url, '--json'];
    await runProjectDocumentsCli(['create', ...flags, '--prompt-file', '-'], { write, readInput: async () => JSON.stringify({ name: 'Relazione lunga da CLI', kind: 'document', documentType: { kind: 'report', subtype: 'Relazione tecnica' }, conversationId: 'owned-chat' }) });
    const created = JSON.parse(outputs.at(-1)!) as ProjectDocumentMutationResponse;
    await writeFile(path.join(created.document.workingDirectory, 'brief.txt'), 'Engineer-owned text');
    await runProjectDocumentsCli(['context', ...flags, '--document', created.document.id, '--path', 'brief.txt'], { write });
    expect(JSON.parse(outputs.at(-1)!).file.text).toBe('Engineer-owned text');
    await runProjectDocumentsCli(['rename', ...flags, '--document', created.document.id, '--name', 'Renamed output'], { write });
    expect(JSON.parse(outputs.at(-1)!).document.name).toBe('Renamed output');
    await runProjectDocumentsCli(['archive', ...flags, '--document', created.document.id], { write });
    const hidden = await (await fetch(`${f.url}/api/projects/project/documents`)).json() as ProjectDocumentsResponse;
    expect(hidden.documents).toEqual([]);
    await runProjectDocumentsCli(['list', ...flags, '--include-archived'], { write }); expect(JSON.parse(outputs.at(-1)!).documents).toHaveLength(1);
    await runProjectDocumentsCli(['unarchive', ...flags, '--document', created.document.id], { write });
    await runProjectDocumentsCli(['select', ...flags, '--document', created.document.id], { write });
    expect(JSON.parse(outputs.at(-1)!).selectedDocumentId).toBe(created.document.id);
    expect(await readFile(path.join(created.document.workingDirectory, 'brief.txt'), 'utf8')).toBe('Engineer-owned text');
    expect(f.updates).toHaveBeenCalled(); expect(f.authorize.mock.calls.some((call) => call[3].mode === 'write' && call[3].capability === 'writeFiles')).toBe(true);
  });

  it('fails closed for foreign chats, foreign IDs, forged roots and denied project access', async () => {
    const f = await fixture(), endpoint = `${f.url}/api/projects/project/documents`;
    expect((await fetch(endpoint, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'Bad', kind: 'document', conversationId: 'foreign-chat' }) })).status).toBe(403);
    expect((await fetch(endpoint, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'Bad', kind: 'document', workingDirectory: f.root }) })).status).toBe(400);
    const created = await (await fetch(endpoint, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'Own', kind: 'document' }) })).json() as ProjectDocumentMutationResponse;
    expect((await fetch(`${f.url}/api/projects/other/documents/${created.document.id}/context`)).status).toBe(404);
    expect((await fetch(`${endpoint}/${created.document.id}/context?path=${encodeURIComponent('../private')}`)).status).toBe(400);
    expect((await fetch(`${endpoint}?workingDirectory=${encodeURIComponent(f.root)}`)).status).toBe(400);
    f.deny(); expect((await fetch(endpoint)).status).toBe(403);
    await expect(runProjectDocumentsCli(['list', '--project', 'project', '--daemon-url', f.url, '--json'])).rejects.toThrow('Denied');
  });

  it('requires complete run workspace identity and links only through the explicit folder field', async () => {
    const f = await fixture(), outputs: string[] = [], flags = ['--project', 'project', '--daemon-url', f.url, '--json'];
    vi.stubEnv('OD_WORKSPACE_ID', 'workspace'); vi.stubEnv('OD_WORKSPACE_MEMBER_ID', '');
    await expect(runProjectDocumentsCli(['list', ...flags])).rejects.toThrow('incomplete');
    vi.stubEnv('OD_WORKSPACE_MEMBER_ID', 'member');
    const folder = path.join(f.root, 'external'); await mkdir(folder); await writeFile(path.join(folder, 'index.html'), 'Linked original');
    await runProjectDocumentsCli(['link', ...flags, '--name', 'Existing design', '--kind', 'design', '--folder', folder], { write: (value) => outputs.push(value) });
    const result = JSON.parse(outputs.at(-1)!) as ProjectDocumentMutationResponse;
    expect(result.document.folderMode).toBe('linked'); expect(result.document.workingDirectory).toBe(folder);
    expect(await readFile(path.join(folder, 'index.html'), 'utf8')).toBe('Linked original');
    const request = f.authorize.mock.calls.at(-1)![0] as { get(name: string): string | undefined };
    expect(request.get('x-od-workspace-id')).toBe('workspace'); expect(request.get('x-od-workspace-member-id')).toBe('member');
  });
});
