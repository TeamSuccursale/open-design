import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDocumentPresentation, type HeaderFooterDraft, type ProjectDocument } from '@open-design/contracts';
import { HeaderFooterStore, type HeaderFooterStoreOptions } from '../../src/services/header-footer.js';

const fixtures: string[] = [];
afterEach(async () => { for (const root of fixtures.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(options: Partial<HeaderFooterStoreOptions> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'melillo-header-footer-')); fixtures.push(root);
  const projectRoot = path.join(root, 'project'), dataRoot = path.join(root, 'private'); await mkdir(projectRoot); await mkdir(dataRoot);
  const documents: ProjectDocument[] = [];
  for (const id of ['report', 'booklet', 'independent']) { const workingDirectory = path.join(root, id); await mkdir(workingDirectory); documents.push({ id, projectId: 'parent', workspaceProjectId: `workspace-${id}`, name: id, workingDirectory, kind: 'document', availability: 'available', folderMode: 'linked', conversationIds: [`chat-${id}`], presentation: createDocumentPresentation(id), createdAt: 'today', updatedAt: 'today', archivedAt: null }); }
  const applied: { documentId: string; revision: number | null }[] = [];
  const storeOptions: HeaderFooterStoreOptions = { dataRoot, projectRoot, projectId: 'parent', documents: async () => documents, format: async (document) => ({ widthMm: document.id === 'booklet' ? 420 : 210, heightMm: 297 }), onApply: async (document, _binding, revision) => { applied.push({ documentId: document.id, revision: revision?.id ?? null }); }, ...options };
  return { root, projectRoot, dataRoot, documents, applied, options: storeOptions, store: new HeaderFooterStore(storeOptions) };
}
function draft(name = 'Studio'): HeaderFooterDraft {
  return { version: 1, name, guidance: 'Keep the document name and local numbering.', stage: 'graphic', variants: [{ id: 'a4', name: 'A4', pageWidthMm: 210, pageHeightMm: 297, headerHeightMm: 20, footerHeightMm: 15, blocks: [{ id: 'name', region: 'header', kind: 'field', field: 'documentName', x: .05, y: .2, width: .9, height: .5, fontSize: 11 }, { id: 'page', region: 'footer', kind: 'field', field: 'pageNumber', x: .8, y: .2, width: .15, height: .5, fontSize: 10 }] }, { id: 'a3', name: 'A3', pageWidthMm: 420, pageHeightMm: 297, headerHeightMm: 20, footerHeightMm: 15, blocks: [{ id: 'name', region: 'header', kind: 'field', field: 'documentName', x: .05, y: .2, width: .9, height: .5, fontSize: 11 }, { id: 'page', region: 'footer', kind: 'field', field: 'pageNumber', x: .8, y: .2, width: .15, height: .5, fontSize: 10 }] }] };
}
async function published(store: HeaderFooterStore) {
  const created = await store.create({ name: 'Studio' });
  await store.saveDraft(created.set.id, { expectedDraftVersion: 1, draft: draft() });
  const result = await store.publish(created.set.id, { expectedDraftVersion: 2, expectedRevision: 0, stage: 'graphic-approved', binding: { documentId: 'report', followUpdates: true, header: true, footer: true, showOnCover: false, expectedBindingVersion: 0 } });
  return result.sets[0]!;
}

describe('project header/footer library', () => {
  it('keeps drafts unapplied, rejects stale writes, and recovers every acknowledged save outside user Git', async () => {
    const f = await fixture(), created = await f.store.create({ name: 'Studio' });
    expect(created.set.draft.stage).toBe('structural'); expect(created.bindings).toEqual([]);
    await f.store.saveDraft(created.set.id, { expectedDraftVersion: 1, draft: draft() });
    await expect(f.store.saveDraft(created.set.id, { expectedDraftVersion: 1, draft: draft('Stale') })).rejects.toMatchObject({ statusCode: 409 });
    const reloaded = await new HeaderFooterStore(f.options).list(); expect(reloaded.sets[0]?.draft.name).toBe('Studio'); expect(reloaded.sets[0]?.publishedRevision).toBeNull();
    const registryRoot = path.dirname(await f.store.assetDirectory()); expect(registryRoot.startsWith(f.dataRoot)).toBe(true);
    expect((await readdir(path.join(registryRoot, 'recovery'))).length).toBe(2); expect(await readdir(f.projectRoot)).not.toContain('.git');
  });
  it('publishes across separate document folders and leaves independent copies unchanged', async () => {
    const f = await fixture(), set = await published(f.store);
    for (const documentId of ['booklet', 'independent']) await f.store.apply(documentId, { setId: set.id, followUpdates: documentId !== 'independent', header: true, footer: true, showOnCover: false });
    await f.store.saveDraft(set.id, { expectedDraftVersion: 2, draft: draft('Updated') });
    const result = await f.store.publish(set.id, { expectedDraftVersion: 3, expectedRevision: 1, stage: 'graphic-approved', originDocumentId: 'booklet' });
    expect(result.bindings.find((binding) => binding.documentId === 'report')?.snapshot?.name).toBe('Updated');
    expect(result.bindings.find((binding) => binding.documentId === 'booklet')?.appliedRevision).toBe(2);
    expect(result.bindings.find((binding) => binding.documentId === 'independent')?.snapshot?.name).toBe('Studio');
    expect(result.transactions[0]?.documents.map((item) => item.documentId).sort()).toEqual(['booklet', 'report']);
    expect(f.applied.at(-1)?.revision).toBe(2); expect(result.history.some((entry) => entry.originDocumentId === 'booklet')).toBe(true);
  });
  it('requires approved real graphics, validates borders and asset references, and checks all target formats before publication', async () => {
    const f = await fixture(), created = await f.store.create({ name: 'Studio' });
    await expect(f.store.publish(created.set.id, { expectedDraftVersion: 1, expectedRevision: 0, stage: 'graphic-approved' })).rejects.toThrow('actual graphic preview');
    const bad = draft(); bad.variants[0]!.blocks[0]!.x = .9;
    await f.store.saveDraft(created.set.id, { expectedDraftVersion: 1, draft: bad });
    await expect(f.store.publish(created.set.id, { expectedDraftVersion: 2, expectedRevision: 0, stage: 'graphic-approved' })).rejects.toThrow('bordo sicuro');
    const onlyA4 = draft(); onlyA4.variants.pop(); await f.store.saveDraft(created.set.id, { expectedDraftVersion: 2, draft: onlyA4 });
    await expect(f.store.publish(created.set.id, { expectedDraftVersion: 3, expectedRevision: 0, stage: 'graphic-approved', binding: { documentId: 'booklet', followUpdates: true, header: true, footer: true, showOnCover: false } })).rejects.toMatchObject({ code: 'HEADER_FOOTER_FORMAT_REQUIRED' });
    expect((await f.store.list()).sets[0]?.revision).toBe(0); expect(f.applied).toEqual([]);
  });
  it('retains the old coherent snapshot on materialization failure and resumes pending work after restart', async () => {
    let fail = false;
    const f = await fixture({ onApply: async () => { if (fail) throw new Error('Destination unavailable'); } }), set = await published(f.store);
    fail = true; await f.store.saveDraft(set.id, { expectedDraftVersion: 2, draft: draft('Updated') });
    const failed = await f.store.publish(set.id, { expectedDraftVersion: 3, expectedRevision: 1, stage: 'graphic-approved' });
    expect(failed.bindings[0]).toMatchObject({ status: 'pending', appliedRevision: 1, pendingRevision: 2, snapshot: { name: 'Studio' }, error: 'Destination unavailable' });
    expect(failed.transactions[0]?.status).toBe('pending');
    fail = false; const resumed = await new HeaderFooterStore(f.options).retry();
    expect(resumed.bindings[0]).toMatchObject({ status: 'applied', appliedRevision: 2, snapshot: { name: 'Updated' } }); expect(resumed.bindings[0]?.pendingRevision).toBeUndefined();
    expect(resumed.transactions[0]?.status).toBe('applied');
  });
  it('publishes a corrected revision over older pending shared updates without discarding independent work or history', async () => {
    let fail = false;
    const f = await fixture({ onApply: async () => { if (fail) throw new Error('Previous publication cannot be applied'); } }), set = await published(f.store);
    await f.store.apply('booklet', { setId: set.id, followUpdates: true, header: true, footer: true, showOnCover: false });
    fail = true; await f.store.saveDraft(set.id, { expectedDraftVersion: 2, draft: draft('Older pending design') });
    const pending = await f.store.publish(set.id, { expectedDraftVersion: 3, expectedRevision: 1, stage: 'graphic-approved' });
    expect(pending.bindings.filter((binding) => binding.status === 'pending')).toHaveLength(2);
    await f.store.apply('independent', { setId: set.id, revision: 2, followUpdates: false, header: true, footer: true, showOnCover: false });
    await f.store.saveDraft(set.id, { expectedDraftVersion: 3, draft: draft('Corrected design') });
    fail = false;
    const fixed = await f.store.publish(set.id, { expectedDraftVersion: 4, expectedRevision: 2, stage: 'graphic-approved' });
    expect(fixed.bindings.find((binding) => binding.documentId === 'report')).toMatchObject({ appliedRevision: 3, status: 'applied', snapshot: { name: 'Corrected design' } });
    expect(fixed.bindings.find((binding) => binding.documentId === 'booklet')?.appliedRevision).toBe(3);
    expect(fixed.bindings.find((binding) => binding.documentId === 'independent')).toMatchObject({ status: 'pending', pendingRevision: 2, followUpdates: false });
    const olderShared = fixed.transactions.find((transaction) => transaction.revision === 2 && transaction.documents.length === 2)!;
    expect(olderShared.status).toBe('applied'); expect(olderShared.documents.every((target) => target.status === 'superseded')).toBe(true);
    expect((await f.store.revisionHistory(set.id)).map((revision) => revision.id)).toEqual([3, 2, 1]);
    expect(fixed.history.filter((entry) => entry.action === 'publish')).toHaveLength(3);
    const resumed = await new HeaderFooterStore(f.options).retry();
    expect(resumed.bindings.find((binding) => binding.documentId === 'independent')).toMatchObject({ appliedRevision: 2, status: 'applied', snapshot: { name: 'Older pending design' } });
  });
  it('keeps unavailable/archived destinations visibly pending and retries without losing assets or local numbering settings', async () => {
    const f = await fixture(), set = await published(f.store);
    f.documents[1]!.availability = 'unavailable';
    const result = await f.store.apply('booklet', { setId: set.id, followUpdates: true, header: true, footer: false, showOnCover: true });
    expect(result.bindings.find((binding) => binding.documentId === 'booklet')?.status).toBe('pending');
    f.documents[1]!.availability = 'available'; const resumed = await f.store.retry();
    expect(resumed.bindings.find((binding) => binding.documentId === 'booklet')).toMatchObject({ status: 'applied', footer: false, showOnCover: true });
    expect(f.documents[1]!.presentation?.pageNumbers).toBeNull();
  });
  it('detaches and restores independently or republishes a previous shared revision with explicit scope', async () => {
    const f = await fixture(), set = await published(f.store);
    await f.store.apply('booklet', { setId: set.id, followUpdates: true, header: true, footer: true, showOnCover: false });
    const binding = (await f.store.list()).bindings.find((item) => item.documentId === 'booklet')!;
    await f.store.detach('booklet', binding.version);
    await f.store.saveDraft(set.id, { expectedDraftVersion: 2, draft: draft('Updated') });
    await f.store.publish(set.id, { expectedDraftVersion: 3, expectedRevision: 1, stage: 'graphic-approved' });
    const restored = await f.store.restore(set.id, { revision: 1, expectedRevision: 2, expectedDraftVersion: 3, originDocumentId: 'report' });
    expect(restored.bindings.find((item) => item.documentId === 'report')).toMatchObject({ appliedRevision: 3, snapshot: { name: 'Studio' } });
    expect(restored.bindings.find((item) => item.documentId === 'booklet')).toMatchObject({ appliedRevision: 1, followUpdates: false });
    expect((await f.store.revisionHistory(set.id)).map((revision) => revision.id)).toEqual([3, 2, 1]);
    const independent = await f.store.restore(set.id, { revision: 2, expectedRevision: 3, expectedDraftVersion: 4, documentId: 'booklet' });
    expect(independent.bindings.find((item) => item.documentId === 'booklet')).toMatchObject({ appliedRevision: 2, followUpdates: false, snapshot: { name: 'Updated' } });
  });
  it('owns logo metadata/provenance, allows immutable reads inside apply hooks, and prevents foreign identity access', async () => {
    const f = await fixture(); const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    const asset = await f.store.addAsset({ name: 'Studio', filename: 'studio.svg', mimeType: 'image/svg+xml', source: 'upload', width: 10, height: 10 }, svg);
    expect(await readFile((await f.store.readAsset(asset.id)).path)).toEqual(svg);
    const search = await f.store.createSearch({ target: 'Studio', website: 'https://example.com' });
    await f.store.updateSearch(search.id, { status: 'ready', assetIds: [asset.id], sessionId: 'session-1', attempt: 1 });
    expect((await f.store.getSearch(search.id)).model).toBe('gpt-6.1-sol');
    await expect(f.store.getBinding('foreign-document')).rejects.toMatchObject({ statusCode: 404 });
    await expect(f.store.readAsset('../secret')).rejects.toThrow();
    let sawAsset = false; const withHook = new HeaderFooterStore({ ...f.options, onApply: async () => { sawAsset = !!(await f.store.readAsset(asset.id)).asset; } });
    await published(withHook); expect(sawAsset).toBe(true);
  });
  it('compares and restores saved drafts without applying them, and retains archived published designs', async () => {
    const f = await fixture(), set = await published(f.store);
    await f.store.saveDraft(set.id, { expectedDraftVersion: 2, draft: draft('Unpublished') });
    const history = await f.store.draftHistory(set.id), previous = history.find((entry) => entry.draftVersion === 2)!;
    expect(history[0]?.draft.name).toBe('Unpublished');
    const restored = await f.store.restoreDraft(set.id, previous.id, 3);
    expect(restored.sets[0]?.draft.name).toBe('Studio'); expect(restored.sets[0]?.revision).toBe(1); expect(restored.bindings[0]?.snapshot?.name).toBe('Studio');
    const archived = await f.store.archive(set.id, true, 1); expect(archived.sets[0]?.archivedAt).toBeTruthy();
    await expect(f.store.apply('booklet', { setId: set.id, followUpdates: true, header: true, footer: true, showOnCover: false })).rejects.toMatchObject({ statusCode: 409 });
    expect((await f.store.getBinding('report'))?.snapshot?.name).toBe('Studio'); expect((await f.store.revisionHistory(set.id))).toHaveLength(1);
  });
  it('clears an abandoned pending propagation when a document explicitly disables its regions', async () => {
    let fail = false; const f = await fixture({ onApply: async (_document, _binding, revision) => { if (revision && fail) throw new Error('Fail once'); } }), set = await published(f.store);
    fail = true; const pending = await f.store.apply('report', { setId: set.id, followUpdates: true, header: true, footer: true, showOnCover: false });
    const disabled = await f.store.disable('report', pending.bindings[0]!.version);
    expect(disabled.bindings[0]?.status).toBe('disabled'); expect(disabled.transactions.every((transaction) => transaction.status === 'applied')).toBe(true); expect(disabled.transactions[0]?.documents[0]?.status).toBe('superseded');
    await f.store.saveDraft(set.id, { expectedDraftVersion: 2, draft: draft('New') });
    expect((await f.store.publish(set.id, { expectedDraftVersion: 3, expectedRevision: 1, stage: 'graphic-approved' })).sets[0]?.revision).toBe(2);
  });
  it('restores logo metadata and bytes when recovering a draft after the logo was removed from the active collection', async () => {
    const f = await fixture(), asset = await f.store.addAsset({ name: 'Studio', filename: 'studio.svg', mimeType: 'image/svg+xml', source: 'upload' }, Buffer.from('<svg viewBox="0 0 10 10"/>'));
    const created = await f.store.create({ name: 'Studio' }), withLogo = draft();
    withLogo.variants[0]!.blocks.push({ id: 'logo', kind: 'logo', region: 'header', assetId: asset.id, x: .1, y: .2, width: .2, height: .5 });
    await f.store.saveDraft(created.set.id, { expectedDraftVersion: 1, draft: withLogo });
    const old = (await f.store.draftHistory(created.set.id)).find((entry) => entry.draftVersion === 2)!;
    await f.store.saveDraft(created.set.id, { expectedDraftVersion: 2, draft: draft() }); await f.store.removeAsset(asset.id);
    expect((await f.store.list()).assets).toHaveLength(0);
    const restored = await f.store.restoreDraft(created.set.id, old.id, 3); expect(restored.assets[0]?.id).toBe(asset.id); expect((await f.store.readAsset(asset.id)).asset.sha256).toBe(asset.sha256);
  });
});
