import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockoutComparisonFilePath, createBlockoutDocument, createDocumentPresentation, documentPresentationMissingChoices, isFastProject, projectDocumentForConversation, type ProjectDocumentWorkspaceBootstrap } from '@open-design/contracts';
import { closeDatabase, getConversation, getProject, insertConversation, insertProject, listConversations, openDatabase, updateProject } from '../../src/db.js';
import { resolveProjectDir } from '../../src/projects.js';
import { ProjectDocumentsStore } from '../../src/services/project-documents.js';
import { ProjectDocumentsRuntime } from '../../src/services/project-documents-runtime.js';
import { readBlockoutWorkspace, saveBlockoutWorkspace } from '../../src/services/blockout-workspaces.js';
import { confirmDocumentSetup, readDocumentSetup, saveDocumentSetupIntent, scanDocumentSetupContext } from '../../src/services/document-setup.js';

const fixtures: string[] = [];
afterEach(async () => { closeDatabase(); for (const root of fixtures.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'melillo-documents-')); fixtures.push(root);
  const projectRoot = path.join(root, 'project'), dataRoot = path.join(root, 'private'), linked = path.join(root, 'external');
  await Promise.all([mkdir(projectRoot), mkdir(dataRoot), mkdir(linked)]);
  const store = new ProjectDocumentsStore({ dataRoot, projectId: 'parent', projectRoot });
  const calls: ProjectDocumentWorkspaceBootstrap[] = [];
  const bootstrap = async (input: ProjectDocumentWorkspaceBootstrap) => { calls.push(input); return { workspaceProjectId: input.workspaceProjectId ?? `workspace-${input.documentId}`, conversationId: `chat-${input.documentId}` }; };
  return { root, projectRoot, dataRoot, linked, store, calls, bootstrap };
}

describe('Project document registry', () => {
  it('keeps named outputs in independent folders, with stable identities and draft presentation', async () => {
    const f = await fixture();
    const first = (await f.store.create({ name: 'Relazione B', kind: 'document', documentType: { kind: 'tender-offer', subtype: 'Relazione tecnica' } }, f.bootstrap)).document;
    const second = (await f.store.create({ name: 'Tavole B', kind: 'design', location: { mode: 'link-existing', path: f.linked, authorized: true } }, f.bootstrap)).document;
    expect(first.workingDirectory).toBe(path.join(await realpath(f.projectRoot), 'documents', first.id));
    expect(first.presentation?.status).toBe('draft'); expect(first.presentation?.name).toBe('Relazione B');
    expect(first.workspaceProjectId).not.toBe(second.workspaceProjectId); expect(second.workingDirectory).toBe(await realpath(f.linked));
    await writeFile(path.join(first.workingDirectory, 'index.html'), 'REPORT'); await writeFile(path.join(f.linked, 'index.html'), 'DRAWINGS');
    expect((await f.store.context(first.id, 'index.html')).file?.text).toBe('REPORT');
    expect((await f.store.context(second.id, 'index.html')).file?.text).toBe('DRAWINGS');
    const renamed = (await f.store.update(first.id, { name: 'Relazione descrittiva B' }, f.bootstrap)).document;
    expect(renamed.id).toBe(first.id); expect(renamed.workingDirectory).toBe(first.workingDirectory); expect(renamed.presentation?.name).toBe(renamed.name);
    expect(f.calls.at(-1)?.workspaceProjectId).toBe(first.workspaceProjectId);
  });

  it('repairs app-owned aliases, surfaces a missing folder, and relinks without moving originals', async () => {
    const f = await fixture(); await writeFile(path.join(f.linked, 'original.txt'), 'UNCHANGED');
    const original = (await f.store.create({ name: 'Existing', kind: 'document', location: { mode: 'link-existing', path: f.linked, authorized: true } }, f.bootstrap)).document;
    expect(original.availability).toBe('available'); expect(await realpath(original.aliasPath!)).toBe(await realpath(f.linked));
    await unlink(original.aliasPath!); expect((await f.store.get(original.id)).availability).toBe('available');
    const moved = path.join(f.root, 'moved'); await rename(f.linked, moved);
    expect((await f.store.get(original.id)).availability).toBe('unavailable');
    await expect(f.store.context(original.id)).rejects.toMatchObject({ statusCode: 503 });
    const repaired = (await f.store.update(original.id, { location: { mode: 'link-existing', path: moved, authorized: true } }, f.bootstrap)).document;
    expect(repaired.id).toBe(original.id); expect(repaired.workspaceProjectId).toBe(original.workspaceProjectId);
    expect(repaired.availability).toBe('available'); expect(await realpath(repaired.aliasPath!)).toBe(await realpath(moved));
    expect(await readFile(path.join(moved, 'original.txt'), 'utf8')).toBe('UNCHANGED');
  });

  it('archives associations recoverably and allows explicit deselection across reloads', async () => {
    const f = await fixture(), first = (await f.store.create({ name: 'Draft', kind: 'document' }, f.bootstrap)).document;
    await writeFile(path.join(first.workingDirectory, 'draft.txt'), 'Keep me');
    await f.store.update(first.id, { select: false }); expect((await f.store.list()).selectedDocumentId).toBe(null);
    await f.store.update(first.id, { archived: true }); expect((await f.store.list()).documents).toEqual([]);
    expect((await f.store.list({ includeArchived: true })).documents[0]?.archivedAt).toBeTruthy();
    await expect(f.store.context(first.id)).rejects.toMatchObject({ statusCode: 409 });
    await f.store.update(first.id, { archived: false, select: true }); expect((await f.store.list()).selectedDocumentId).toBe(first.id);
    expect(await readFile(path.join(first.workingDirectory, 'draft.txt'), 'utf8')).toBe('Keep me');
  });

  it('rejects unapproved paths, traversal, private storage and nested links', async () => {
    const f = await fixture();
    await expect(f.store.create({ name: 'Private', kind: 'document', location: { mode: 'link-existing', path: f.dataRoot, authorized: true } }, f.bootstrap)).rejects.toThrow();
    await expect(f.store.create({ name: 'Relative', kind: 'document', location: { mode: 'link-existing', path: '../outside', authorized: true } }, f.bootstrap)).rejects.toThrow();
    const first = (await f.store.create({ name: 'Safe', kind: 'document' }, f.bootstrap)).document;
    await writeFile(path.join(f.linked, 'secret.txt'), 'OUTSIDE');
    await symlink(f.linked, path.join(first.workingDirectory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await f.store.context(first.id)).files).toEqual([]);
    await expect(f.store.context(first.id, 'linked/secret.txt')).rejects.toThrow();
    await expect(f.store.context(first.id, '../secret.txt')).rejects.toThrow();
    await expect(f.store.context(first.id, 'C:\\secret.txt')).rejects.toThrow();
    await expect(f.store.context(first.id, '.git/config')).rejects.toThrow();
  });

  it('does not leak duplicate filenames or a foreign document ID across projects', async () => {
    const f = await fixture(), otherRoot = path.join(f.root, 'other-project'); await mkdir(otherRoot);
    const other = new ProjectDocumentsStore({ dataRoot: f.dataRoot, projectId: 'other', projectRoot: otherRoot });
    const a = (await f.store.create({ name: 'Same', kind: 'document' }, f.bootstrap)).document;
    const b = (await other.create({ name: 'Same', kind: 'document' }, f.bootstrap)).document;
    await writeFile(path.join(a.workingDirectory, 'brief.txt'), 'A'); await writeFile(path.join(b.workingDirectory, 'brief.txt'), 'B');
    expect((await f.store.context(a.id, 'brief.txt')).file?.text).toBe('A'); expect((await other.context(b.id, 'brief.txt')).file?.text).toBe('B');
    await expect(other.context(a.id, 'brief.txt')).rejects.toMatchObject({ statusCode: 404 });
    expect((await f.store.list()).documents).toHaveLength(1); expect((await other.list()).documents).toHaveLength(1);
  });

  it('keeps app runtime files out of document inventories and direct reads', async () => {
    const f = await fixture(), document = (await f.store.create({ name: 'Working text', kind: 'document' }, f.bootstrap)).document;
    for (const directory of ['.melillodesign', '.od-frames', '.opendesign', '.od', 'nested/.melillodesign']) {
      const target = path.join(document.workingDirectory, directory); await mkdir(target, { recursive: true });
      await writeFile(path.join(target, 'runtime.json'), '{"internal":true}');
    }
    await mkdir(path.join(document.workingDirectory, 'blockouts/example'), { recursive: true });
    await writeFile(path.join(document.workingDirectory, 'blockouts/example/.workspace.json'), '{"internal":"layout metadata"}');
    await writeFile(path.join(document.workingDirectory, 'blockouts/example/page-1.blockout.json'), '{"type":"blockout-page"}');
    await mkdir(path.join(document.workingDirectory, 'blockout')); await writeFile(path.join(document.workingDirectory, 'blockout/layout.json'), '{"internal":"legacy layout"}');
    await writeFile(path.join(document.workingDirectory, 'testo.txt'), 'The engineer’s actual text');
    const context = await f.store.context(document.id);
    expect(context.files.map((file) => file.path)).toEqual(['testo.txt']);
    expect((await f.store.context(document.id, 'testo.txt')).file?.text).toBe('The engineer’s actual text');
    for (const relative of ['.melillodesign/runtime.json', '.od-frames/runtime.json', '.opendesign/runtime.json', '.od/runtime.json', 'nested/.melillodesign/runtime.json']) await expect(f.store.context(document.id, relative)).rejects.toMatchObject({ statusCode: 400 });
    // Blockout metadata stays available through an explicit request; it is
    // never injected automatically ahead of the user's working materials.
    expect((await f.store.context(document.id, 'blockouts/example/.workspace.json')).file?.text).toContain('layout metadata');
  });

  it('adopts existing Blockout identity without recreating source folders or copying layouts', async () => {
    const f = await fixture(), blockout = createBlockoutDocument(); blockout.documentId = 'existing'; blockout.title = 'Existing output';
    await saveBlockoutWorkspace(f.projectRoot, blockout.documentId, { document: blockout, baseRaw: null });
    const before = await readBlockoutWorkspace(f.projectRoot, blockout.documentId), folders = await readdir(f.projectRoot);
    const listed = await f.store.list(); expect(listed.documents).toHaveLength(1);
    expect(listed.documents[0]).toMatchObject({ id: 'existing', blockoutDocumentId: 'existing', workspaceProjectId: 'parent' });
    expect(await readdir(f.projectRoot)).toEqual(folders); expect((await readBlockoutWorkspace(f.projectRoot, blockout.documentId)).raw).toBe(before.raw);
    await expect(f.store.context('existing', 'other-document.txt')).rejects.toMatchObject({ statusCode: 403 });
    expect((await f.store.context('existing')).files.every((file) => file.path.startsWith('blockouts/existing/'))).toBe(true);
    expect((await f.store.list()).documents).toHaveLength(1);
  });

  it('preserves the actual preview file after a document rename', async () => {
    const f = await fixture(), blockout = createBlockoutDocument(); blockout.documentId = 'stable-file'; blockout.title = 'Original report';
    await saveBlockoutWorkspace(f.projectRoot, blockout.documentId, { document: blockout, baseRaw: null });
    const entryFile = blockoutComparisonFilePath(blockout); await mkdir(path.dirname(path.join(f.projectRoot, entryFile)), { recursive: true }); await writeFile(path.join(f.projectRoot, entryFile), '<html>Saved preview</html>');
    expect((await f.store.get(blockout.documentId)).entryFile).toBe(entryFile);
    const renamed = (await f.store.update(blockout.documentId, { name: 'Different display name' })).document;
    expect(renamed.entryFile).toBe(entryFile); expect((await f.store.context(renamed.id)).blockout).toMatchObject({ projectId: 'parent', comparisonPath: entryFile });
    expect((await f.store.context(renamed.id, entryFile)).file?.text).toBe('<html>Saved preview</html>');
    expect((await f.store.context(renamed.id, 'blockouts/stable-file/.workspace.json')).file?.text).toContain('stable-file');
    await expect(f.store.context(renamed.id, 'blockouts/sibling/.workspace.json')).rejects.toMatchObject({ statusCode: 403 });
    expect(await readFile(path.join(f.projectRoot, entryFile), 'utf8')).toBe('<html>Saved preview</html>');
  });

  it('replaces the provisional initial intent with named outputs without a duplicate active document', async () => {
    const f = await fixture();
    const first = new ProjectDocumentsStore({ dataRoot: f.dataRoot, projectId: 'parent', projectRoot: f.projectRoot, initialDocuments: [{ id: 'document-1', name: 'Initial type', provisional: true }] });
    expect((await first.list()).documents).toHaveLength(1);
    const named = new ProjectDocumentsStore({ dataRoot: f.dataRoot, projectId: 'parent', projectRoot: f.projectRoot, initialDocuments: [{ id: 'report-b', name: 'Relazione B' }, { id: 'graphics-b', name: 'Tavole B' }] });
    expect((await named.list()).documents.map((item) => item.id)).toEqual(['report-b', 'graphics-b']);
    expect((await named.list({ includeArchived: true })).documents.find((item) => item.id === 'document-1')?.archivedAt).toBeTruthy();
  });
});

describe('Document workspace runtime', () => {
  it('keeps a pending creation readable and replays its identity across concurrent calls and store instances', async () => {
    const f = await fixture(); let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const bootstrap = vi.fn(async (input: ProjectDocumentWorkspaceBootstrap) => { await gate; return f.bootstrap(input); });
    const input = { requestId: '2f0f04fc-1d88-4afc-a038-cfe4405171c5', name: 'Retry original', kind: 'document' as const };
    const first = f.store.create(input, bootstrap);
    await vi.waitFor(async () => expect((await f.store.list()).pendingCreations).toHaveLength(1));
    const secondStore = new ProjectDocumentsStore({ dataRoot: f.dataRoot, projectId: 'parent', projectRoot: f.projectRoot });
    const second = secondStore.create(input, bootstrap);
    await expect(secondStore.create({ ...input, name: 'Different operation' }, bootstrap)).rejects.toMatchObject({ statusCode: 409 });
    expect((await secondStore.list()).documents).toHaveLength(0);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.document).toEqual(b.document); expect(bootstrap).toHaveBeenCalledOnce();
    expect((await secondStore.create(input, bootstrap)).document.id).toBe(a.document.id);
    expect(bootstrap).toHaveBeenCalledOnce();
    expect((await secondStore.list()).pendingCreations).toBeUndefined();
    expect((await secondStore.list()).documents).toHaveLength(1);
    const deliberateSecond = await secondStore.create({ ...input, requestId: 'fe79cbbd-0290-461f-805e-99d725942e7a' }, f.bootstrap);
    expect(deliberateSecond.document.id).not.toBe(a.document.id);
  });

  it('retains the same reserved ID when workspace setup fails, then resumes it without another folder', async () => {
    const f = await fixture(); const ids: string[] = [];
    const input = { requestId: '3c2cd6b9-2438-45ae-8ab0-b97171696ffd', name: 'Interrupted save', kind: 'document' as const };
    await expect(f.store.create(input, async (value) => { ids.push(value.documentId); throw new Error('setup interrupted'); })).rejects.toThrow('setup interrupted');
    const pending = (await f.store.list()).pendingCreations!;
    expect(pending).toHaveLength(1); expect(pending[0]?.request).toMatchObject(input);
    const recovered = await f.store.create(pending[0]!.request, async (value) => { ids.push(value.documentId); return f.bootstrap(value); });
    expect(ids).toEqual([recovered.document.id, recovered.document.id]);
    expect(await readdir(path.join(f.projectRoot, 'documents'))).toEqual([recovered.document.id]);
    expect((await f.store.list()).documents).toHaveLength(1);
  });
  it('normalizes an omitted CLI subtype before committing so successful bootstrap cannot become a post-commit setup failure', async () => {
    const f = await fixture(), db = openDatabase(f.root, { dataDir: f.dataRoot });
    insertProject(db, { id: 'parent', name: 'Fast collection', metadata: { kind: 'other', projectMode: 'fast', baseDir: f.projectRoot }, createdAt: 1, updatedAt: 1 });
    const runtime = new ProjectDocumentsRuntime({ db, dataRoot: f.dataRoot, projectsRoot: path.join(f.dataRoot, 'projects') }), store = await runtime.store('parent', f.projectRoot);
    const created = await store.create({ name: 'Relazione tecnica veloce', kind: 'document', documentType: { kind: 'report', subtype: '' } }, runtime.bootstrapWorkspace);
    expect(created.document.documentType).toEqual({ kind: 'report', subtype: 'Relazione tecnica veloce' });
    await expect(runtime.onDocumentUpdated(created.document)).resolves.toBeUndefined();
    const records = (await store.list()).documents;
    expect(records).toHaveLength(1); expect(records[0]?.id).toBe(created.document.id);
    expect((await readDocumentSetup(created.document.workingDirectory, undefined, created.document.workspaceProjectId))?.intent.subtype).toBe('Relazione tecnica veloce');
    const updated = await store.update(created.document.id, { documentType: { kind: 'report', subtype: '' } }, runtime.bootstrapWorkspace);
    await expect(runtime.onDocumentUpdated(updated.document, created.document)).resolves.toBeUndefined();
    expect((await store.list()).documents).toHaveLength(1);
  });

  it('rejects invalid related editorial setup before allocating a document or invoking workspace bootstrap', async () => {
    const f = await fixture(), db = openDatabase(f.root, { dataDir: f.dataRoot });
    insertProject(db, { id: 'parent', name: 'Fast collection', metadata: { kind: 'other', projectMode: 'fast', baseDir: f.projectRoot }, createdAt: 1, updatedAt: 1 });
    const runtime = new ProjectDocumentsRuntime({ db, dataRoot: f.dataRoot, projectsRoot: path.join(f.dataRoot, 'projects') }), store = await runtime.store('parent', f.projectRoot);
    await expect(store.create({ name: 'Invalid draft', kind: 'document', documentType: { kind: 'report', subtype: '' }, presentation: { ...createDocumentPresentation('Invalid draft'), status: 'confirmed' } }, runtime.bootstrapWorkspace)).rejects.toThrow();
    expect((await store.list()).documents).toHaveLength(0);
    expect(await readdir(f.projectRoot)).not.toContain('documents');
    const valid = await store.create({ name: 'Valid retry', kind: 'document', documentType: { kind: 'report', subtype: '' } }, runtime.bootstrapWorkspace);
    await runtime.onDocumentUpdated(valid.document);
    expect((await store.list()).documents.map((document) => document.name)).toEqual(['Valid retry']);
  });

  it('registers the first document under its creation name, independently from project name and type, preserving later renames', async () => {
    const f = await fixture(), db = openDatabase(f.root, { dataDir: f.dataRoot });
    insertProject(db, { id: 'parent', name: 'Project Antro', metadata: { kind: 'other', baseDir: f.projectRoot, documentSetupIntent: { kind: 'report', subtype: 'Relazione tecnica', documentName: 'Relazione descrittiva B', purpose: 'Document purpose', contextRoots: [], imageIntakeConsent: false } }, createdAt: 1, updatedAt: 1 });
    const runtime = new ProjectDocumentsRuntime({ db, dataRoot: f.dataRoot, projectsRoot: path.join(f.dataRoot, 'projects') });
    const store = await runtime.store('parent', f.projectRoot), first = (await store.list()).documents;
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: 'document-1', name: 'Relazione descrittiva B', presentation: { name: 'Relazione descrittiva B' }, documentType: { kind: 'report', subtype: 'Relazione tecnica' } });
    await store.update('document-1', { name: 'Relazione rinominata' });
    expect((await (await runtime.store('parent', f.projectRoot)).list()).documents[0]?.name).toBe('Relazione rinominata');
  });

  it('keeps named editorial outputs authoritative over the initial creation name', async () => {
    const f = await fixture(), db = openDatabase(f.root, { dataDir: f.dataRoot });
    insertProject(db, { id: 'parent', name: 'Project', metadata: { baseDir: f.projectRoot }, createdAt: 1, updatedAt: 1 });
    await saveDocumentSetupIntent(f.projectRoot, { kind: 'report', subtype: 'Relazione tecnica', documentName: 'Initial name', contextRoots: [], imageIntakeConsent: false, editorialSettings: [
      { documentId: 'report-b', presentation: createDocumentPresentation('Relazione definitiva B') },
      { documentId: 'graphics-b', presentation: createDocumentPresentation('Fascicolo grafico A3') },
    ] }, undefined, 'parent');
    const runtime = new ProjectDocumentsRuntime({ db, dataRoot: f.dataRoot, projectsRoot: path.join(f.dataRoot, 'projects') });
    expect((await (await runtime.store('parent', f.projectRoot)).list()).documents.map((document) => document.name)).toEqual(['Relazione definitiva B', 'Fascicolo grafico A3']);
  });

  it('inherits Fast mode for document and design children while retaining explicit editorial choices in chat', async () => {
    const f = await fixture(), db = openDatabase(f.root, { dataDir: f.dataRoot });
    insertProject(db, { id: 'parent', name: 'Fast collection', metadata: { kind: 'other', projectMode: 'fast', baseDir: f.projectRoot }, createdAt: 1, updatedAt: 1 });
    const runtime = new ProjectDocumentsRuntime({ db, dataRoot: f.dataRoot, projectsRoot: path.join(f.dataRoot, 'projects') }), store = await runtime.store('parent', f.projectRoot);
    const document = (await store.create({ name: 'Relazione Fast', kind: 'document' }, runtime.bootstrapWorkspace)).document;
    const child = getProject(db, document.workspaceProjectId)!;
    expect(isFastProject(child.metadata)).toBe(true); expect(child.metadata?.collectionProjectId).toBe('parent');
    const setup = await readDocumentSetup(document.workingDirectory, undefined, child.id);
    expect(setup?.scan.status).toBe('not-run'); expect(setup?.intent.imageIntakeConsent).toBe(false);
    expect(documentPresentationMissingChoices(setup!.intent.editorialSettings![0]!.presentation)).toEqual(['header', 'footer', 'cover', 'pageNumbers']);
    const presentation = { ...document.presentation!, header: true, footer: false, cover: false, pageNumbers: false, status: 'confirmed' as const };
    const updated = await store.update(document.id, { presentation }, runtime.bootstrapWorkspace);
    expect(isFastProject(getProject(db, child.id)?.metadata)).toBe(true);
    expect((await readDocumentSetup(document.workingDirectory, undefined, child.id))?.intent.editorialSettings?.[0]?.presentation).toMatchObject({ header: true, footer: false, status: 'confirmed' });
    expect(updated.document.presentation?.header).toBe(true);
    const design = (await store.create({ name: 'Poster Fast', kind: 'design' }, runtime.bootstrapWorkspace)).document;
    expect(isFastProject(getProject(db, design.workspaceProjectId)?.metadata)).toBe(true);
    expect(getProject(db, design.workspaceProjectId)?.metadata?.documentSetupIntent).toBeUndefined();
    expect(getConversation(db, design.conversationIds[0]!)?.sessionMode).toBe('design');
  });
  it('repairs a legacy Fast child on authorised open without resetting setup or mutating metadata during a read', async () => {
    const f = await fixture(), db = openDatabase(f.root, { dataDir: f.dataRoot });
    insertProject(db, { id: 'parent', name: 'Fast collection', metadata: { kind: 'other', projectMode: 'fast', baseDir: f.projectRoot }, createdAt: 1, updatedAt: 1 });
    const runtime = new ProjectDocumentsRuntime({ db, dataRoot: f.dataRoot, projectsRoot: path.join(f.dataRoot, 'projects') }), store = await runtime.store('parent', f.projectRoot);
    const document = (await store.create({ name: 'Relazione esistente', kind: 'document' }, runtime.bootstrapWorkspace)).document, child = getProject(db, document.workspaceProjectId)!;
    const { projectMode: _mode, ...legacyMetadata } = child.metadata!; updateProject(db, child.id, { metadata: legacyMetadata });
    const previous = await readDocumentSetup(document.workingDirectory, undefined, child.id);
    await store.list(); expect(isFastProject(getProject(db, child.id)?.metadata)).toBe(false);
    await runtime.openDocument('parent', f.projectRoot, document.id);
    expect(isFastProject(getProject(db, child.id)?.metadata)).toBe(true); expect(await readDocumentSetup(document.workingDirectory, undefined, child.id)).toEqual(previous);
    expect((await store.get(document.id)).workingDirectory).toBe(document.workingDirectory);
  });
  it('preserves explicit multi-output confirmation and its saved order during setup/Blockout reconciliation', async () => {
    const f = await fixture(), db = openDatabase(f.root, { dataDir: f.dataRoot });
    insertProject(db, { id: 'parent', name: 'Collection', metadata: { baseDir: f.projectRoot }, createdAt: 1, updatedAt: 1 });
    insertConversation(db, { id: 'preparation', projectId: 'parent', createdAt: 1, updatedAt: 1 });
    const editorialSettings = ['report', 'drawings'].map((documentId, index) => ({ documentId, pageTarget: index === 0 ? 8 : 4, constraints: [],
      presentation: { ...createDocumentPresentation(documentId), status: 'confirmed' as const, header: false, footer: false, cover: false, pageNumbers: false } }));
    await saveDocumentSetupIntent(f.projectRoot, { kind: 'report', subtype: 'Two outputs', purpose: 'Two independent outputs', contextRoots: [], imageIntakeConsent: false,
      imageIntakeDecision: 'declined', editorialSettings, preparationConversation: { requestId: 'preparation-request', dispatched: true, blockoutRequestId: 'blockout-request' } }, undefined, 'parent');
    await scanDocumentSetupContext(f.projectRoot, undefined, async () => ({ pages: [], warnings: [], pagesRead: 0, pagesTotal: 0 }), 'parent');
    const confirmed = await confirmDocumentSetup(f.projectRoot, { purpose: 'Two independent outputs', constraints: [], blockoutApproach: 'agent', editorialSettings }, undefined, 'parent');
    const runtime = new ProjectDocumentsRuntime({ db, dataRoot: f.dataRoot, projectsRoot: path.join(f.dataRoot, 'projects') });
    await runtime.setupUpdated('parent', confirmed);
    const afterSetup = await readDocumentSetup(f.projectRoot, undefined, 'parent');
    expect(afterSetup).toEqual(confirmed);
    const drawings = (await readBlockoutWorkspace(f.projectRoot, 'drawings')).document!;
    await runtime.blockoutUpdated('parent', drawings);
    expect(await readDocumentSetup(f.projectRoot, undefined, 'parent')).toEqual(confirmed);
    expect((await runtime.store('parent', f.projectRoot).then((store) => store.list())).documents.map((document) => document.id)).toEqual(['report', 'drawings']);
  });

  it('opens legacy shared-folder outputs in stable exclusive chats without changing preparation history or files', async () => {
    const f = await fixture(), db = openDatabase(f.root, { dataDir: f.dataRoot });
    insertProject(db, { id: 'parent', name: 'Collection', metadata: { baseDir: f.projectRoot }, createdAt: 1, updatedAt: 1 });
    insertConversation(db, { id: 'preparation', projectId: 'parent', title: 'Original preparation', sessionMode: 'chat', createdAt: 1, updatedAt: 1 });
    const legacy = new ProjectDocumentsStore({ dataRoot: f.dataRoot, projectId: 'parent', projectRoot: f.projectRoot,
      initialDocuments: ['report-b', 'graphics-b'].map((id) => ({ id, name: id, conversationIds: ['preparation'] })) });
    await legacy.list();
    for (const id of ['report-b', 'graphics-b']) {
      const document = createBlockoutDocument(); document.documentId = id; document.title = id;
      await saveBlockoutWorkspace(f.projectRoot, id, { document, baseRaw: null });
      await mkdir(path.join(f.projectRoot, 'documents', id), { recursive: true });
      await writeFile(path.join(f.projectRoot, 'documents', id, 'index.html'), `ORIGINAL ${id}`);
    }
    const runtime = new ProjectDocumentsRuntime({ db, dataRoot: f.dataRoot, projectsRoot: path.join(f.dataRoot, 'projects') });
    const readStore = await runtime.store('parent', f.projectRoot), before = (await readStore.list()).documents;
    expect(listConversations(db, 'parent')).toHaveLength(1);
    expect(projectDocumentForConversation(before, 'parent', 'preparation')).toBeNull();
    const first = await runtime.openDocument('parent', f.projectRoot, 'report-b');
    const second = await runtime.openDocument('parent', f.projectRoot, 'graphics-b');
    expect(first.document.conversationIds).toHaveLength(1); expect(second.document.conversationIds).toHaveLength(1);
    expect(first.document.conversationIds[0]).not.toBe(second.document.conversationIds[0]);
    expect(first.document.preparationConversationIds).toContain('preparation');
    expect(second.document.preparationConversationIds).toContain('preparation');
    expect(getConversation(db, 'preparation')).toMatchObject({ title: 'Original preparation', sessionMode: 'chat', updatedAt: 1 });
    expect(listConversations(db, 'parent')).toHaveLength(3);
    expect((await runtime.openDocument('parent', f.projectRoot, 'report-b')).document.conversationIds).toEqual(first.document.conversationIds);
    const documents = (await readStore.list()).documents;
    expect(projectDocumentForConversation(documents, 'parent', second.document.conversationIds[0])?.id).toBe('graphics-b');
    expect(projectDocumentForConversation(documents, 'parent', 'preparation')).toBeNull();
    expect(projectDocumentForConversation(documents, 'parent', 'new-unbound-chat')).toBeNull();
    expect(projectDocumentForConversation(documents, 'foreign', second.document.conversationIds[0])).toBeNull();
    await expect(readStore.update('graphics-b', { conversationId: first.document.conversationIds[0] })).rejects.toMatchObject({ statusCode: 409 });
    await expect(readStore.update('graphics-b', { conversationId: 'preparation' })).rejects.toMatchObject({ statusCode: 409 });
    expect(getProject(db, 'parent')?.metadata?.collectionDocumentId).toBeUndefined();
    expect(await readFile(path.join(f.projectRoot, 'documents/report-b/index.html'), 'utf8')).toBe('ORIGINAL report-b');
    expect(await readFile(path.join(f.projectRoot, 'documents/graphics-b/index.html'), 'utf8')).toBe('ORIGINAL graphics-b');
    expect(documents.map((document) => document.workingDirectory)).toEqual(before.map((document) => document.workingDirectory));
  });

  it('materializes named setup outputs only on authorized setup writes and leaves child workspace chats unchanged', async () => {
    const f = await fixture(), db = openDatabase(f.root, { dataDir: f.dataRoot });
    insertProject(db, { id: 'parent', name: 'Collection', metadata: { baseDir: f.projectRoot }, createdAt: 1, updatedAt: 1 });
    insertConversation(db, { id: 'preparation', projectId: 'parent', createdAt: 1, updatedAt: 1 });
    const runtime = new ProjectDocumentsRuntime({ db, dataRoot: f.dataRoot, projectsRoot: path.join(f.dataRoot, 'projects') });
    const setup = await saveDocumentSetupIntent(f.projectRoot, { kind: 'report', subtype: 'Report', purpose: 'Two outputs', contextRoots: [], imageIntakeConsent: false,
      editorialSettings: ['a', 'b'].map((documentId) => ({ documentId, presentation: createDocumentPresentation(documentId) })) }, undefined, 'parent');
    const store = await runtime.store('parent', f.projectRoot); await store.list(); expect(listConversations(db, 'parent')).toHaveLength(1);
    await runtime.setupUpdated('parent', setup); const outputs = (await store.list()).documents;
    expect(outputs.map((document) => document.conversationIds[0])).toHaveLength(2);
    expect(new Set(outputs.flatMap((document) => document.conversationIds)).size).toBe(2);
    const child = (await store.create({ name: 'Linked child', kind: 'document', location: { mode: 'link-existing', path: f.linked, authorized: true } }, runtime.bootstrapWorkspace)).document;
    expect((await runtime.openDocument('parent', f.projectRoot, child.id)).document.conversationIds).toEqual(child.conversationIds);
    expect(getConversation(db, child.conversationIds[0]!)?.projectId).toBe(child.workspaceProjectId);
    expect(listConversations(db, 'parent')).toHaveLength(3);
  });

  it('creates real file/chat workspaces and preserves setup answers when renamed', async () => {
    const f = await fixture(), projectsRoot = path.join(f.dataRoot, 'projects'); await mkdir(projectsRoot);
    const db = openDatabase(f.root, { dataDir: f.dataRoot }); insertProject(db, { id: 'parent', name: 'Collection', metadata: { kind: 'other', baseDir: f.projectRoot }, createdAt: 1, updatedAt: 1 });
    const runtime = new ProjectDocumentsRuntime({ db, dataRoot: f.dataRoot, projectsRoot });
    const store = await runtime.store('parent', f.projectRoot);
    const result = await store.create({ name: 'Report', kind: 'document', documentType: { kind: 'tender-offer', subtype: 'Relazione tecnica' } }, runtime.bootstrapWorkspace);
    await runtime.onDocumentUpdated(result.document);
    const child = getProject(db, result.document.workspaceProjectId)!;
    expect(child.metadata).toMatchObject({ collectionProjectId: 'parent', collectionDocumentId: result.document.id, collectionProjectName: 'Collection' });
    expect(resolveProjectDir(projectsRoot, child.id, child.metadata)).toBe(result.document.workingDirectory);
    expect(getConversation(db, result.document.conversationIds[0]!)?.projectId).toBe(child.id);
    expect(runtime.authorizeConversation(result.document.conversationIds[0]!, ['parent'])).toBe(false);
    expect(runtime.authorizeConversation(result.document.conversationIds[0]!, [child.id])).toBe(true);
    await saveDocumentSetupIntent(result.document.workingDirectory, { purpose: 'ENGINEER DECISION', imageIntakeConsent: true, imageIntakeDecision: 'accepted' }, child.metadata, child.id);
    const renamed = await store.update(result.document.id, { name: 'Renamed report' }, runtime.bootstrapWorkspace); await runtime.onDocumentUpdated(renamed.document, result.document);
    const setup = await readDocumentSetup(result.document.workingDirectory, undefined, child.id);
    expect(setup?.intent.purpose).toBe('ENGINEER DECISION'); expect(setup?.intent.imageIntakeConsent).toBe(true);
    expect(setup?.intent.kind).toBe('tender-offer'); expect(setup?.intent.editorialSettings?.[0]?.presentation.name).toBe('Renamed report');
    await expect(runtime.store(child.id, result.document.workingDirectory)).rejects.toMatchObject({ statusCode: 409 });
    await expect(runtime.bootstrapWorkspace({ projectId: 'parent', documentId: 'foreign', name: 'Foreign', kind: 'document', workingDirectory: f.linked, workspaceProjectId: child.id })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('adopts pre-Blockout outputs and updates only the matching saved presentation', async () => {
    const f = await fixture(), db = openDatabase(f.root, { dataDir: f.dataRoot });
    const first = createDocumentPresentation('Relazione B'), second = createDocumentPresentation('Fascicolo B');
    const intent = { kind: 'tender-offer', subtype: 'Criterio B', purpose: 'Two outputs', contextRoots: [], imageIntakeConsent: false, editorialSettings: [{ documentId: 'report-b', presentation: first, pageTarget: 8 }, { documentId: 'graphics-b', presentation: second, pageTarget: 4 }] };
    insertProject(db, { id: 'parent', name: 'Collection', metadata: { kind: 'other', baseDir: f.projectRoot, documentSetupIntent: intent }, createdAt: 1, updatedAt: 1 });
    insertConversation(db, { id: 'initial-chat', projectId: 'parent', createdAt: 1, updatedAt: 1 });
    const runtime = new ProjectDocumentsRuntime({ db, dataRoot: f.dataRoot, projectsRoot: path.join(f.dataRoot, 'projects') });
    const store = await runtime.store('parent', f.projectRoot), initial = await store.list();
    expect(initial.documents.map((item) => item.id)).toEqual(['report-b', 'graphics-b']); expect(initial.documents[0]?.conversationIds).toEqual([]);
    expect(initial.documents[0]?.preparationConversationIds).toEqual(['initial-chat']);
    const blockout = createBlockoutDocument(); blockout.documentId = 'report-b'; blockout.title = first.name; blockout.presentation = first;
    await saveBlockoutWorkspace(f.projectRoot, 'report-b', { document: blockout, baseRaw: null, startingPoint: true });
    expect((await store.list()).documents).toHaveLength(2); expect((await store.get('report-b')).blockoutDocumentId).toBe('report-b');
    const previous = await store.get('report-b'), changed = await store.update('report-b', { name: 'Relazione aggiornata', presentation: { ...first, header: true } });
    await runtime.onDocumentUpdated(changed.document, previous);
    const setup = await readDocumentSetup(f.projectRoot, undefined, 'parent');
    expect(setup?.intent.editorialSettings?.find((item) => item.documentId === 'report-b')).toMatchObject({ pageTarget: 8, presentation: { name: 'Relazione aggiornata', header: true } });
    expect(setup?.intent.editorialSettings?.find((item) => item.documentId === 'graphics-b')).toMatchObject({ pageTarget: 4, presentation: second });
    expect((await readBlockoutWorkspace(f.projectRoot, 'report-b')).document?.title).toBe('Relazione aggiornata');
    expect(await readFile(path.join(f.projectRoot, 'blockout/brief.md'), 'utf8')).toContain('Relazione aggiornata');
  });

  it('keeps chat setup names in the library and applies cover accounting without adding pages', async () => {
    const f = await fixture(), db = openDatabase(f.root, { dataDir: f.dataRoot });
    insertProject(db, { id: 'parent', name: 'Collection', metadata: { kind: 'other', baseDir: f.projectRoot }, createdAt: 1, updatedAt: 1 });
    const runtime = new ProjectDocumentsRuntime({ db, dataRoot: f.dataRoot, projectsRoot: path.join(f.dataRoot, 'projects') }), store = await runtime.store('parent', f.projectRoot);
    const first = (await store.create({ name: 'Initial name', kind: 'document' }, runtime.bootstrapWorkspace)).document;
    const child = getProject(db, first.workspaceProjectId)!, blockout = createBlockoutDocument(); blockout.documentId = first.id; blockout.title = first.name;
    await saveBlockoutWorkspace(first.workingDirectory, first.id, { document: blockout, baseRaw: null });
    const setup = await saveDocumentSetupIntent(first.workingDirectory, { editorialSettings: [{ documentId: first.id, presentation: { ...first.presentation!, name: 'Named in chat', cover: true, coverCountsTowardPageLimit: false } }] }, child.metadata, child.id);
    await runtime.setupUpdated(child.id, setup);
    expect((await store.get(first.id)).name).toBe('Named in chat'); expect(getProject(db, child.id)?.name).toBe('Named in chat');
    const actual = (await readBlockoutWorkspace(first.workingDirectory, first.id)).document!;
    expect(actual.variants[0]!.pages).toHaveLength(blockout.variants[0]!.pages.length); expect(actual.variants[0]!.pages[0]).toMatchObject({ role: 'cover', countsTowardLimit: false });
    const renamed = { ...actual, title: 'Renamed in Blockout', presentation: { ...actual.presentation!, name: 'Renamed in Blockout' } };
    await saveBlockoutWorkspace(first.workingDirectory, first.id, { document: renamed, baseRaw: (await readBlockoutWorkspace(first.workingDirectory, first.id)).raw });
    await runtime.blockoutUpdated(child.id, renamed); expect((await store.get(first.id)).name).toBe('Renamed in Blockout');
  });

  it('starts designs in an ordinary design chat without technical document setup', async () => {
    const f = await fixture(), db = openDatabase(f.root, { dataDir: f.dataRoot });
    insertProject(db, { id: 'parent', name: 'Collection', metadata: { kind: 'other', baseDir: f.projectRoot }, createdAt: 1, updatedAt: 1 });
    const runtime = new ProjectDocumentsRuntime({ db, dataRoot: f.dataRoot, projectsRoot: path.join(f.dataRoot, 'projects') }), store = await runtime.store('parent', f.projectRoot);
    const design = (await store.create({ name: 'Poster', kind: 'design', location: { mode: 'link-existing', path: f.linked, authorized: true } }, runtime.bootstrapWorkspace)).document;
    const child = getProject(db, design.workspaceProjectId)!;
    expect(child.metadata?.kind).toBe('prototype'); expect(child.metadata?.intent).toBeUndefined(); expect(child.metadata?.documentSetupIntent).toBeUndefined();
    expect(getConversation(db, design.conversationIds[0]!)?.sessionMode).toBe('design'); expect(await readDocumentSetup(f.linked, undefined, child.id)).toBe(null);
  });

  it('rejects workspace relocation with active recovery integration before changing the registry or files', async () => {
    const f = await fixture(), db = openDatabase(f.root, { dataDir: f.dataRoot });
    insertProject(db, { id: 'parent', name: 'Collection', metadata: { kind: 'other', baseDir: f.projectRoot }, createdAt: 1, updatedAt: 1 });
    const runtime = new ProjectDocumentsRuntime({ db, dataRoot: f.dataRoot, projectsRoot: path.join(f.dataRoot, 'projects'), beforeWrite: async () => undefined }), store = await runtime.store('parent', f.projectRoot);
    const first = (await store.create({ name: 'Working', kind: 'document' }, runtime.bootstrapWorkspace)).document;
    await writeFile(path.join(first.workingDirectory, 'original.txt'), 'Keep here');
    await expect(store.update(first.id, { location: { mode: 'link-existing', path: f.linked, authorized: true } }, runtime.bootstrapWorkspace)).rejects.toMatchObject({ statusCode: 409 });
    expect((await store.get(first.id)).workingDirectory).toBe(first.workingDirectory);
    expect(getProject(db, first.workspaceProjectId)?.metadata?.baseDir).toBe(first.workingDirectory);
    expect(await readFile(path.join(first.workingDirectory, 'original.txt'), 'utf8')).toBe('Keep here'); expect(await readdir(f.linked)).toEqual([]);
  });
});
