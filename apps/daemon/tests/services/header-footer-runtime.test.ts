import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { load } from 'cheerio';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockoutOutsideSafeArea, blockoutSafeArea, createBlockoutDocument, createBlockoutPage, createDocumentPresentation, documentPresentationPageState, renderAppliedHeaderFooterSvg, type BlockoutBlock, type BlockoutDocument, type HeaderFooterDraft, type ProjectDocument } from '@open-design/contracts';
import { closeDatabase, getProject, insertProject, openDatabase } from '../../src/db.js';
import { HeaderFooterRuntime } from '../../src/services/header-footer-runtime.js';
import { ProjectDocumentsRuntime } from '../../src/services/project-documents-runtime.js';
import { appendBlockoutAlternatives, readBlockoutWorkspace, saveBlockoutWorkspace, saveBlockoutWorkspaceStartingPoint } from '../../src/services/blockout-workspaces.js';
import { confirmDocumentSetup, readDocumentSetup, saveDocumentSetupIntent, scanDocumentSetupContext } from '../../src/services/document-setup.js';

const folders: string[] = [];
afterEach(async () => { closeDatabase(); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 20"><rect width="80" height="20" fill="#165e52"/></svg>';
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'melillo-header-footer-runtime-')); folders.push(root);
  const dataRoot = path.join(root, 'private'), projectRoot = path.join(root, 'project'), projectsRoot = path.join(dataRoot, 'projects');
  await mkdir(projectRoot); await mkdir(projectsRoot, { recursive: true });
  const db = openDatabase(root, { dataDir: dataRoot }); insertProject(db, { id: 'parent', name: 'Antro', metadata: { baseDir: projectRoot, kind: 'other' }, createdAt: 1, updatedAt: 1 });
  const documentsRuntime = new ProjectDocumentsRuntime({ db, dataRoot, projectsRoot }), documentsStore = await documentsRuntime.store('parent', projectRoot);
  const runtime = new HeaderFooterRuntime({ db, dataRoot, projectsRoot, documents: documentsRuntime });
  const make = async (name: string, count: number, a3 = false, cover = false) => {
    const presentation = { ...createDocumentPresentation(name), status: 'confirmed' as const, header: true, footer: true, cover, pageNumbers: true, numberOnCover: false, coverCountsTowardPageLimit: true, coverCountsInNumbering: false };
    const document = (await documentsStore.create({ name, kind: 'document', presentation, documentType: { kind: 'report', subtype: a3 ? 'Tavole grafiche' : 'Relazione tecnica' } }, documentsRuntime.bootstrapWorkspace)).document;
    const blockout: BlockoutDocument = { ...createBlockoutDocument(), documentId: document.id, title: name, presentation, pageBudget: { mode: 'exact', limit: count, target: count }, variants: [{ id: 'structure', label: 'Studio', pages: Array.from({ length: count }, (_, index) => ({ ...createBlockoutPage(`page-${index + 1}`, `Pagina ${index + 1}`), widthMm: a3 ? 420 : 210, heightMm: 297, ...(index === 0 && cover ? { role: 'cover' as const } : {}), blocks: [] })) }], activeVariantId: 'structure' };
    await saveBlockoutWorkspace(document.workingDirectory, document.id, { document: blockout, baseRaw: null });
    await documentsStore.synchronize(document.id, { blockoutDocumentId: document.id });
    const html = `<!doctype html><html><body>${blockout.variants[0]!.pages.map((page, index) => `<section data-melillodesign-document-page="${document.id}" data-width-mm="${page.widthMm}" data-height-mm="297"${index === 0 && cover ? ' data-page-role="cover"' : ''}><article id="body-${index + 1}"><h2>${name}</h2><p>Lorem ipsum ${index + 1}</p></article></section>`).join('')}</body></html>`;
    await writeFile(path.join(document.workingDirectory, 'elaborato.html'), html);
    return { ...document, blockoutDocumentId: document.id };
  };
  return { root, db, projectRoot, projectsRoot, dataRoot, documentsRuntime, documentsStore, runtime, make };
}
function design(assetId: string, headerHeightMm = 20): HeaderFooterDraft {
  return { version: 1, name: 'Studio Antro', guidance: 'Logo, nome del documento e numero locale.', stage: 'graphic', variants: [210, 420].map((width) => ({ id: `format-${width}`, name: width === 210 ? 'A4 verticale' : 'A3 orizzontale', pageWidthMm: width, pageHeightMm: 297, headerHeightMm, footerHeightMm: 15,
    blocks: [{ id: 'logo', region: 'header' as const, kind: 'logo' as const, assetId, x: .05, y: .15, width: .2, height: .65 }, { id: 'name', region: 'header' as const, kind: 'field' as const, field: 'documentName' as const, x: .3, y: .2, width: .65, height: .5, fontSize: 10 }, { id: 'page', region: 'footer' as const, kind: 'field' as const, field: 'pageNumber' as const, x: .85, y: .2, width: .1, height: .5, fontSize: 10 }] })) };
}
async function publish(f: Awaited<ReturnType<typeof fixture>>, document: ProjectDocument, headerHeightMm = 20) {
  const store = await f.runtime.store('parent'), asset = await store.addAsset({ name: 'Studio', filename: 'studio.svg', mimeType: 'image/svg+xml', source: 'upload', width: 80, height: 20 }, Buffer.from(svg));
  const created = await store.create({ name: 'Studio Antro' }); await store.saveDraft(created.set.id, { expectedDraftVersion: 1, draft: design(asset.id, headerHeightMm) });
  const state = await store.publish(created.set.id, { expectedDraftVersion: 2, expectedRevision: 0, stage: 'graphic-approved', originDocumentId: document.id, binding: { documentId: document.id, followUpdates: true, header: true, footer: true, showOnCover: false } });
  expect(state.bindings[0]?.error).toBeUndefined();
  return { store, asset, set: state.sets[0]!, state };
}

function bodyBlock(id: string, designRole: NonNullable<BlockoutBlock['designRole']>, y: number, height: number): BlockoutBlock {
  return { id, kind: 'text', label: id, designRole, box: { x: 12, y, width: 76, height, rotation: 0 }, lockRatio: false, images: [], expectation: id, feedback: '', flexibility: 'guided', references: [] };
}

describe('applied header/footer runtime', () => {
  it('reapplies and retries recurring graphics after an appended alternative without a false comparison-revision conflict', async () => {
    const f = await fixture(), report = await f.make('Relazione con alternativa', 3), p = await publish(f, report);
    const before = await readBlockoutWorkspace(report.workingDirectory, report.id);
    const request = await saveBlockoutWorkspaceStartingPoint(report.workingDirectory, report.id, { document: before.document, baseRaw: before.raw,
      requestId: 'header-footer-realignment', operation: { type: 'append-alternatives', count: 1, instruction: 'Keep all saved pages and make one new empty structure.' } });
    const candidate = { label: 'Alternativa aggiunta', pages: structuredClone(before.document!.variants[0]!.pages) };
    const appended = await appendBlockoutAlternatives(report.workingDirectory, report.id, { requestId: request.handoff.id, candidates: [candidate] });
    const variants = structuredClone(appended.document!.variants), receipts = structuredClone(appended.document!.alternativeBatches);
    const result = await p.store.apply(report.id, { setId: p.set.id, followUpdates: true, header: true, footer: true, showOnCover: false });
    expect(result.bindings[0]).toMatchObject({ status: 'applied', appliedRevision: 1 });
    expect(result.bindings[0]?.error).toBeUndefined();
    expect(result.bindings[0]?.pendingRevision).toBeUndefined();
    const materialize = vi.spyOn(f.runtime, 'materialize').mockRejectedValueOnce(new Error('Comparison assessment does not match the document snapshot'));
    const pending = await p.store.apply(report.id, { setId: p.set.id, followUpdates: true, header: true, footer: true, showOnCover: false });
    expect(pending.bindings[0]).toMatchObject({ status: 'pending', appliedRevision: 1, error: 'Comparison assessment does not match the document snapshot' });
    materialize.mockRestore();
    const retried = await p.store.retry();
    expect(retried.bindings[0]?.status).toBe('applied');
    expect(retried.bindings[0]?.error).toBeUndefined();
    const after = await readBlockoutWorkspace(report.workingDirectory, report.id);
    expect(after.document!.variants).toEqual(variants);
    expect(after.document!.alternativeBatches).toEqual(receipts);
    expect(after.document!.presentation?.headerFooter?.revision).toBe(1);
    const comparison = await readFile(path.join(report.workingDirectory, 'documents/relazione-con-alternativa/blockout-comparison.html'), 'utf8');
    expect(comparison).toContain('Alternativa aggiunta');
  });
  it('rejects literal and resolved field overflow before publishing, binding, or writing document assets', async () => {
    const f = await fixture(), report = await f.make('Relazione descrittiva con un nome completo da mantenere leggibile', 8);
    const store = await f.runtime.store('parent'), asset = await store.addAsset({ name: 'Studio', filename: 'studio.svg', mimeType: 'image/svg+xml', source: 'upload' }, Buffer.from(svg));
    const created = await store.create({ name: 'Studio' }), literal = design(asset.id);
    Object.assign(literal.variants[0]!.blocks[1]!, { kind: 'text', text: 'PROGETTO', width: .02 });
    await store.saveDraft(created.set.id, { expectedDraftVersion: 1, draft: literal });
    const request = (draftVersion: number) => ({ expectedDraftVersion: draftVersion, expectedRevision: 0, stage: 'graphic-approved' as const, binding: { documentId: report.id, followUpdates: true, header: true, footer: true, showOnCover: false } });
    const before = await store.list();
    await expect(store.validate(created.set.id, { documentId: report.id })).rejects.toMatchObject({ code: 'HEADER_FOOTER_TEXT_OVERFLOW' });
    await expect(store.publish(created.set.id, request(2))).rejects.toMatchObject({ code: 'HEADER_FOOTER_TEXT_OVERFLOW' });
    const field = design(asset.id); field.variants[0]!.blocks[1]!.width = .03;
    await store.saveDraft(created.set.id, { expectedDraftVersion: 2, draft: field });
    await expect(store.validate(created.set.id, { documentId: report.id })).rejects.toMatchObject({ code: 'HEADER_FOOTER_TEXT_OVERFLOW' });
    await expect(store.publish(created.set.id, request(3))).rejects.toMatchObject({ code: 'HEADER_FOOTER_TEXT_OVERFLOW' });
    const rejected = await store.list(); expect(rejected.sets[0]?.revision).toBe(0); expect(rejected.bindings).toEqual([]); expect(rejected.transactions).toEqual([]);
    expect(rejected.history.filter((entry) => entry.action === 'publish')).toHaveLength(0);
    await expect(readFile(path.join(report.workingDirectory, 'header-footer', report.id, 'applied.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await store.saveDraft(created.set.id, { expectedDraftVersion: 3, draft: design(asset.id) });
    const saved = await store.list();
    expect(await store.validate(created.set.id, { documentId: report.id, expectedDraftVersion: 4 })).toMatchObject({ valid: true, documentIds: [report.id] });
    expect((await store.list()).history).toEqual(saved.history); expect(before.sets[0]?.revision).toBe(0);
    expect((await store.publish(created.set.id, request(4))).bindings[0]?.status).toBe('applied');
  });
  it('fits a document’s own name only in the format variants its pages use', async () => {
    const f = await fixture(), booklet = await f.make('Fascicolo grafico B con un nome lungo', 4, true);
    const store = await f.runtime.store('parent'), asset = await store.addAsset({ name: 'Studio', filename: 'studio.svg', mimeType: 'image/svg+xml', source: 'upload' }, Buffer.from(svg)), created = await store.create({ name: 'Studio' });
    const shared = design(asset.id); shared.variants[0]!.blocks[1]!.width = .1; // Sized for a short A4 report name; the A3 booklet never renders here.
    await store.saveDraft(created.set.id, { expectedDraftVersion: 1, draft: shared });
    expect(await store.validate(created.set.id, { documentId: booklet.id, expectedDraftVersion: 2 })).toMatchObject({ valid: true, documentIds: [booklet.id] });
    shared.variants[1]!.blocks[1]!.width = .05;
    await store.saveDraft(created.set.id, { expectedDraftVersion: 2, draft: shared });
    await expect(store.validate(created.set.id, { documentId: booklet.id })).rejects.toMatchObject({ code: 'HEADER_FOOTER_TEXT_OVERFLOW', message: expect.stringContaining('A3 orizzontale') });
  });
  it('validates a document’s confirmed intended A3 format and enabled regions before any page Blockout exists', async () => {
    const f = await fixture(), presentation = { ...createDocumentPresentation('Tavole B'), status: 'confirmed' as const, header: true, footer: true, cover: false, pageNumbers: false };
    const document = (await f.documentsStore.create({ name: 'Tavole B', kind: 'document', presentation }, f.documentsRuntime.bootstrapWorkspace)).document;
    const project = getProject(f.db, document.workspaceProjectId)!;
    await saveDocumentSetupIntent(document.workingDirectory, { editorialSettings: [{ documentId: document.id, presentation, pageTarget: 4, constraints: [
      { id: 'paper', kind: 'paper', value: 'Tavole B: A3', status: 'confirmed', sourceIds: [] },
      { id: 'orientation', kind: 'orientation', value: 'Tavole B: orizzontale', status: 'confirmed', sourceIds: [] },
    ] }] }, project.metadata, project.id);
    expect((await readBlockoutWorkspace(document.workingDirectory, document.id)).document).toBeNull();
    const store = await f.runtime.store(project.id);
    expect((await store.list()).pageContexts?.find((item) => item.documentId === document.id)).toEqual({ documentId: document.id, totalPages: 4, initialFormat: { widthMm: 420, heightMm: 297 } });
    const asset = await store.addAsset({ name: 'Studio', filename: 'studio.svg', mimeType: 'image/svg+xml', source: 'upload' }, Buffer.from(svg));
    const set = (await store.create({ name: 'Studio' })).set, a4Only = design(asset.id); a4Only.variants.pop();
    await store.saveDraft(set.id, { expectedDraftVersion: 1, draft: a4Only });
    const publish = (version: number) => store.publish(set.id, { expectedDraftVersion: version, expectedRevision: 0, stage: 'graphic-approved', binding: { documentId: document.id, followUpdates: true, header: true, footer: true, showOnCover: false } });
    await expect(publish(2)).rejects.toMatchObject({ code: 'HEADER_FOOTER_FORMAT_REQUIRED' }); expect((await store.list()).sets[0]?.revision).toBe(0);
    const emptyA3 = design(asset.id); emptyA3.variants[1]!.blocks = [];
    await store.saveDraft(set.id, { expectedDraftVersion: 2, draft: emptyA3 }); await expect(publish(3)).rejects.toMatchObject({ code: 'HEADER_FOOTER_REGION_EMPTY' });
    await store.saveDraft(set.id, { expectedDraftVersion: 3, draft: design(asset.id) });
    const applied = await publish(4); expect(applied.bindings[0]?.status).toBe('applied'); expect((await readBlockoutWorkspace(document.workingDirectory, document.id)).document).toBeNull();
  });
  it('checks every existing page format before publication rather than only the first page', async () => {
    const f = await fixture(), report = await f.make('Relazione mista', 2), old = await readBlockoutWorkspace(report.workingDirectory, report.id), document = old.document!;
    document.variants[0]!.pages[1]!.widthMm = 420; await saveBlockoutWorkspace(report.workingDirectory, report.id, { document, baseRaw: old.raw });
    const store = await f.runtime.store('parent'), asset = await store.addAsset({ name: 'Studio', filename: 'studio.svg', mimeType: 'image/svg+xml', source: 'upload' }, Buffer.from(svg)), created = await store.create({ name: 'Studio' });
    const a4Only = design(asset.id); a4Only.variants.pop(); await store.saveDraft(created.set.id, { expectedDraftVersion: 1, draft: a4Only });
    await expect(store.publish(created.set.id, { expectedDraftVersion: 2, expectedRevision: 0, stage: 'graphic-approved', binding: { documentId: report.id, followUpdates: true, header: true, footer: true, showOnCover: false } })).rejects.toMatchObject({ code: 'HEADER_FOOTER_FORMAT_REQUIRED' });
    expect((await store.list()).transactions).toHaveLength(0); expect((await store.list()).sets[0]?.revision).toBe(0);
  });
  it('keeps legacy existing-body edits available without inventing a new zero-height reservation or revoking approval', async () => {
    const f = await fixture(), report = await f.make('Relazione esistente', 2), saved = await readBlockoutWorkspace(report.workingDirectory, report.id), document = saved.document!;
    document.variants[0]!.pages[0]!.blocks.push({ id: 'legacy', kind: 'text', label: 'Testo esistente', designRole: 'body', box: { x: 0, y: 0, width: 80, height: 70, rotation: 0 }, lockRatio: false, images: [], expectation: 'Esistente', feedback: '', flexibility: 'guided', references: [] });
    document.approval = { variantId: document.activeVariantId, acceptedAt: 'approved-before-feature' };
    await saveBlockoutWorkspace(report.workingDirectory, report.id, { document, baseRaw: saved.raw });
    const normalized = await f.runtime.normalizeBlockout(report.workspaceProjectId, document);
    expect(normalized.variants[0]!.pages[0]!.reservedHeaderMm).toBe(0); expect(normalized.needsReadaptation).toBe(false); expect(normalized.approval?.acceptedAt).toBe('approved-before-feature');
  });
  it('revokes approval only when a changed reservation newly overlaps a non-background block', async () => {
    const f = await fixture(), report = await f.make('Relazione B', 2); await publish(f, report);
    const document = (await readBlockoutWorkspace(report.workingDirectory, report.id)).document!;
    document.approval = { variantId: document.activeVariantId, acceptedAt: 'approved' };
    const page = document.variants[0]!.pages[0]!; page.reservedHeaderMm = 0; page.reservedFooterMm = 0;
    page.blocks = [{ id: 'background', kind: 'mixed', label: 'Filigrana', designRole: 'background', box: { x: 0, y: 0, width: 100, height: 100, rotation: 0 }, lockRatio: false, images: [], expectation: 'Filigrana', feedback: '', flexibility: 'guided', references: [] }];
    expect((await f.runtime.normalizeBlockout(report.workspaceProjectId, document)).approval?.acceptedAt).toBe('approved');
    page.blocks[0]!.designRole = 'body'; page.blocks[0]!.box = { x: 10, y: 1, width: 80, height: 10, rotation: 0 };
    expect((await f.runtime.normalizeBlockout(report.workspaceProjectId, document)).approval?.acceptedAt).toBe('approved');
    page.blocks[0]!.box.y = 5;
    const overlap = await f.runtime.normalizeBlockout(report.workspaceProjectId, document); expect(overlap.approval).toBeUndefined(); expect(overlap.needsReadaptation).toBe(true);
  });
  it('fits an agent-saved proposal’s body into the band the applied header and footer leave free, keeping its order and proportions', async () => {
    const f = await fixture(), report = await f.make('Relazione B', 2); await publish(f, report);
    const document = (await readBlockoutWorkspace(report.workingDirectory, report.id)).document!;
    const page = document.variants[0]!.pages[1]!;
    // The agent composes without the reservation, as the live run did: the caption runs into the footer.
    delete page.reservedHeaderMm; delete page.reservedFooterMm;
    page.blocks = [bodyBlock('title', 'heading', 12, 8), bodyBlock('figure', 'figure', 22, 60), bodyBlock('caption', 'caption', 84, 10),
      { ...bodyBlock('watermark', 'background', 0, 100), box: { x: 0, y: 0, width: 100, height: 100, rotation: 0 } }];
    const { document: saved, reserveAdjustments } = await f.runtime.normalizeBlockoutSave(report.workspaceProjectId, document, { authoredByRun: true });
    const fitted = saved.variants[0]!.pages[1]!, safe = blockoutSafeArea(fitted);
    expect(fitted.reservedFooterMm).toBe(15);
    for (const block of fitted.blocks.filter((item) => item.designRole !== 'background')) expect(blockoutOutsideSafeArea(block.box, fitted)).toBe(false);
    const [title, figure, caption, watermark] = fitted.blocks;
    expect(title!.box.y).toBe(12);
    expect(figure!.box.y + figure!.box.height).toBeLessThanOrEqual(caption!.box.y);
    expect(caption!.box.y + caption!.box.height).toBeCloseTo(safe.bottom, 1);
    expect(figure!.box.height / caption!.box.height).toBeCloseTo(6, 1);
    expect(watermark!.box).toEqual({ x: 0, y: 0, width: 100, height: 100, rotation: 0 });
    expect(saved.needsReadaptation).toBe(false);
    expect(reserveAdjustments).toEqual([expect.objectContaining({ variantId: 'structure', pageId: 'page-2', blockIds: ['title', 'figure', 'caption'] })]);
  });
  it('refuses an agent-saved page it cannot fit without recomposing it, naming the page and the free band', async () => {
    const f = await fixture(), report = await f.make('Relazione B', 2); await publish(f, report, 60);
    const document = (await readBlockoutWorkspace(report.workingDirectory, report.id)).document!;
    document.variants[0]!.pages[0]!.blocks = [bodyBlock('figure', 'figure', 1, 98)];
    await expect(f.runtime.normalizeBlockoutSave(report.workspaceProjectId, document, { authoredByRun: true }))
      .rejects.toMatchObject({ code: 'BLOCKOUT_RESERVE_OVERLAP', message: expect.stringMatching(/Pagina 1[\s\S]*23,6%[\s\S]*91,6%/) });
    const rotated = (await readBlockoutWorkspace(report.workingDirectory, report.id)).document!;
    // A small crossing, but a rotated box keeps part of its corner in the footer after a vertical fit.
    rotated.variants[0]!.pages[0]!.blocks = [{ ...bodyBlock('note', 'body', 80, 12), box: { x: 30, y: 80, width: 40, height: 12, rotation: 10 } }];
    await expect(f.runtime.normalizeBlockoutSave(report.workspaceProjectId, rotated, { authoredByRun: true })).rejects.toMatchObject({ code: 'BLOCKOUT_RESERVE_OVERLAP' });
  });
  it('keeps the engineer’s own placement in the reserve as a reviewable warning instead of moving it', async () => {
    const f = await fixture(), report = await f.make('Relazione B', 2); await publish(f, report);
    const document = (await readBlockoutWorkspace(report.workingDirectory, report.id)).document!;
    document.variants[0]!.pages[0]!.blocks = [bodyBlock('caption', 'caption', 84, 10)];
    const { document: saved, reserveAdjustments } = await f.runtime.normalizeBlockoutSave(report.workspaceProjectId, document, { authoredByRun: false });
    expect(saved.variants[0]!.pages[0]!.blocks[0]!.box).toEqual({ x: 12, y: 84, width: 76, height: 10, rotation: 0 });
    expect(reserveAdjustments).toEqual([]);
  });
  it('gates real page Blockout until enabled regions are applied and keeps a single canonical parent library', async () => {
    const f = await fixture(), report = await f.make('Relazione B', 8, false, true), blockout = (await readBlockoutWorkspace(report.workingDirectory, report.id)).document!;
    blockout.variants[0]!.pages[1]!.blocks.push({ id: 'text', kind: 'text', label: 'Corpo testo', designRole: 'body', box: { x: 10, y: 15, width: 80, height: 70, rotation: 0 }, lockRatio: false, images: [], expectation: 'Testo dell’ingegnere', feedback: '', flexibility: 'guided', references: [] });
    await expect(f.runtime.normalizeBlockout(report.workspaceProjectId, blockout)).rejects.toMatchObject({ code: 'HEADER_FOOTER_REQUIRED' });
    const p = await publish(f, report); expect(p.state.bindings[0]?.status).toBe('applied');
    const normalized = await f.runtime.normalizeBlockout(report.workspaceProjectId, blockout); expect(normalized.presentation?.headerFooter?.revision).toBe(1);
    expect(normalized.variants[0]!.pages[0]!.reservedHeaderMm).toBe(0); expect(normalized.variants[0]!.pages[1]!.reservedHeaderMm).toBe(20);
    expect((await f.runtime.store(report.workspaceProjectId)).identity).toBe('parent');
    normalized.variants[0]!.pages[1]!.widthMm = 297; normalized.variants[0]!.pages[1]!.heightMm = 420;
    await expect(f.runtime.normalizeBlockout(report.workspaceProjectId, normalized)).rejects.toMatchObject({ code: 'HEADER_FOOTER_FORMAT_REQUIRED' });
  });
  it('copies logos to both independent document folders and renders local A4/A3 titles, cover numbers and body reservations', async () => {
    const f = await fixture(), report = await f.make('Relazione B', 8, false, true), booklet = await f.make('Fascicolo grafico B', 4, true), p = await publish(f, report);
    await p.store.apply(booklet.id, { setId: p.set.id, followUpdates: true, header: true, footer: true, showOnCover: false });
    for (const [document, count] of [[report, 8], [booklet, 4]] as const) {
      const workspace = (await readBlockoutWorkspace(document.workingDirectory, document.id)).document!, applied = workspace.presentation!.headerFooter!;
      expect(workspace.variants[0]!.pages).toHaveLength(count); expect(applied.assets).toHaveLength(1);
      expect(await readFile(path.join(document.workingDirectory, applied.assets[0]!.path), 'utf8')).toBe(svg);
      const html = await readFile(path.join(document.workingDirectory, 'elaborato.html'), 'utf8'), $ = load(html), pages = $('[data-melillodesign-document-page]');
      expect(pages).toHaveLength(count); expect($('article').map((_index, element) => $(element).text()).get().join(' ')).toContain(`Lorem ipsum ${count}`);
      const firstBody = document === report ? 1 : 0, region = pages.eq(firstBody).children('[data-melillodesign-recurring-region]');
      expect(region.text()).toContain(document.name); expect(region.find('[data-header-footer-block="page"]').text()).toBe('1');
      expect(region.find('image').attr('preserveAspectRatio')).toBe('xMidYMid meet');
      if (document === report) expect(pages.eq(0).children('[data-melillodesign-recurring-region]').text()).toBe('');
      const page = workspace.variants[0]!.pages[firstBody]!, state = documentPresentationPageState(workspace.presentation, { index: firstBody });
      expect(renderAppliedHeaderFooterSvg(applied, { widthMm: page.widthMm, heightMm: page.heightMm, documentName: document.name, index: firstBody, totalPages: count, visibleNumber: state.visibleNumber })).toContain(document.name);
    }
  });
  it('updates linked outputs from the second document, preserves independent output and marks larger regions for body review', async () => {
    const f = await fixture(), report = await f.make('Relazione B', 8), booklet = await f.make('Fascicolo B', 4, true), independent = await f.make('Copia indipendente', 2), p = await publish(f, report);
    for (const document of [booklet, independent]) await p.store.apply(document.id, { setId: p.set.id, followUpdates: document !== independent, header: true, footer: true, showOnCover: false });
    const old = await readBlockoutWorkspace(report.workingDirectory, report.id), document = old.document!;
    document.variants[0]!.pages[0]!.blocks.push({ id: 'text', kind: 'text', label: 'Corpo testo', box: { x: 10, y: 15, width: 80, height: 70, rotation: 0 }, lockRatio: false, images: [], expectation: 'Testo', feedback: '', flexibility: 'guided', references: [] });
    document.approval = { variantId: document.activeVariantId, acceptedAt: 'before' }; await saveBlockoutWorkspace(report.workingDirectory, report.id, { document, baseRaw: old.raw });
    const changed = design(p.asset.id, 60); changed.name = 'Studio aggiornato'; await p.store.saveDraft(p.set.id, { expectedDraftVersion: 2, draft: changed });
    const result = await p.store.publish(p.set.id, { expectedDraftVersion: 3, expectedRevision: 1, stage: 'graphic-approved', originDocumentId: booklet.id });
    expect(result.bindings.find((binding) => binding.documentId === independent.id)?.appliedRevision).toBe(1);
    expect(result.bindings.find((binding) => binding.documentId === report.id)?.status).toBe('needs-review');
    const after = (await readBlockoutWorkspace(report.workingDirectory, report.id)).document!;
    expect(after.variants[0]!.pages[0]!.blocks[0]!.box.y).toBe(15); expect(after.variants[0]!.pages[0]!.reservedHeaderMm).toBe(60); expect(after.needsReadaptation).toBe(true); expect(after.approval).toBeUndefined();
    expect((await readBlockoutWorkspace(booklet.workingDirectory, booklet.id)).document?.presentation?.headerFooter?.revision).toBe(2);
  });
  it('keeps directly edited HTML regions unresolved and visibly pending, without overwriting the body or claiming every document updated', async () => {
    const f = await fixture(), report = await f.make('Relazione B', 8), p = await publish(f, report), file = path.join(report.workingDirectory, 'elaborato.html');
    const original = await readFile(file, 'utf8'), $ = load(original); $('[data-melillodesign-recurring-region]').first().append('<span>Modifica manuale</span>'); await writeFile(file, $.html());
    const next = design(p.asset.id); next.name = 'Aggiornato'; await p.store.saveDraft(p.set.id, { expectedDraftVersion: 2, draft: next });
    const pending = await p.store.publish(p.set.id, { expectedDraftVersion: 3, expectedRevision: 1, stage: 'graphic-approved', originDocumentId: report.id });
    expect(pending.bindings[0]?.status).toBe('pending'); expect(pending.bindings[0]?.appliedRevision).toBe(1); expect(pending.bindings[0]?.error).toContain('modificato direttamente');
    expect(await readFile(file, 'utf8')).toContain('Modifica manuale'); expect(await readFile(file, 'utf8')).toContain('Lorem ipsum 8');
    await writeFile(file, original); expect((await p.store.retry()).bindings[0]?.appliedRevision).toBe(2);
  });
  it('keeps an explicitly confirmed brief confirmed for derived graphics, while changing header intent still reopens it', async () => {
    const f = await fixture(), report = await f.make('Relazione B', 8), project = getProject(f.db, report.workspaceProjectId)!;
    const editorialSettings = [{ documentId: report.id, presentation: report.presentation!, pageTarget: 8, constraints: [] }];
    await saveDocumentSetupIntent(report.workingDirectory, { kind: 'report', subtype: 'Relazione tecnica', purpose: 'Impostare la relazione B', contextRoots: [], imageIntakeConsent: false, imageIntakeDecision: 'declined', editorialSettings, preparationConversation: { requestId: 'request', dispatched: true, blockoutRequestId: 'blockout-request' } }, project.metadata, project.id);
    await scanDocumentSetupContext(report.workingDirectory, undefined, async () => ({ pages: [], warnings: [], pagesRead: 0, pagesTotal: 0 }), project.id);
    const confirmed = await confirmDocumentSetup(report.workingDirectory, { purpose: 'Impostare la relazione B', constraints: [], blockoutApproach: 'agent', editorialSettings }, undefined, project.id);
    await f.documentsRuntime.setupUpdated(project.id, confirmed);
    const p = await publish(f, report); expect(p.state.bindings[0]?.status).toBe('applied');
    expect((await readDocumentSetup(report.workingDirectory, undefined, project.id))?.status).toBe('confirmed');
    const current = await f.documentsStore.get(report.id), changed = await f.documentsStore.update(report.id, { presentation: { ...current.presentation!, header: false } });
    await f.documentsRuntime.onDocumentUpdated(changed.document, current);
    expect((await readDocumentSetup(report.workingDirectory, undefined, project.id))?.status).toBe('review');
  });
});
