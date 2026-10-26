import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockoutDocumentSchema, createBlockoutDocument, type BlockoutFitAssessment, type BlockoutMaterialInventory } from '@open-design/contracts';
import { blockoutComparisonPath, renderMeasuredBlockoutComparison, renderStructuralBlockoutComparison, saveMeasuredBlockoutComparison, saveStructuralBlockoutComparison } from '../../src/services/blockout-comparison.js';
import { saveBlockoutWorkspace } from '../../src/services/blockout-workspaces.js';

interface TestElement {
  textContent: string | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  querySelector(selector: string): TestElement | null;
  querySelectorAll(selector: string): ArrayLike<TestElement>;
  scrollIntoView(...args: unknown[]): void;
  click(): void;
  dispatchEvent(event: unknown): boolean;
}
interface TestWindow {
  document: Pick<TestElement, 'querySelector' | 'querySelectorAll'> & { activeElement: TestElement | null };
  location: { href: string };
  MouseEvent: new (type: string, options: { bubbles: boolean }) => unknown;
  MessageEvent: new (type: string, options: { data: unknown; origin: string; source: unknown }) => unknown;
  dispatchEvent(event: unknown): boolean;
  close(): void;
}
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options?: { url?: string; referrer?: string; runScripts?: string }) => { window: TestWindow };
};

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
function fixture() {
  const document = createBlockoutDocument();
  document.title = 'Materiale reale <script>';
  document.materialRevision = 'a'.repeat(64); document.materialIds = ['text', 'image'];
  const page = document.variants[0]!.pages[0]!; page.label = 'Pagina con fonti';
  page.blocks = [
    { id: 'text-block', label: 'Testo', kind: 'text', box: { x: 10, y: 10, width: 80, height: 30, rotation: 0 }, lockRatio: false, images: [], contentIds: ['text'], typography: { fontFamily: 'Arial', fontSizePt: 11, lineHeight: 1.5 }, expectation: 'Intent only, no fictitious content', feedback: '', flexibility: 'guided', references: [] },
    { id: 'image-block', label: 'Disegno', kind: 'drawing', box: { x: 10, y: 50, width: 80, height: 30, rotation: 0 }, lockRatio: true, images: [], contentIds: ['image'], imageFit: 'contain', expectation: '', feedback: '', flexibility: 'guided', references: [] },
  ];
  const sourceText = 'Actual material & <source>\nSecond measured line';
  const inventory: BlockoutMaterialInventory = { version: 1, projectId: 'project', revision: 'a'.repeat(64), status: 'ready', sources: { processed: 1, total: 1, entries: [] }, gaps: [], createdAt: '', updatedAt: '', items: [
    { id: 'text', kind: 'text', label: 'Testo effettivo', sourcePath: 'originale.txt', sourcePage: 1, sourceHash: 'b'.repeat(64), sourceRole: 'content', text: sourceText, offsetStart: 0, offsetEnd: sourceText.length },
    { id: 'image', kind: 'drawing', label: 'Disegno originale', sourcePath: 'originale.pdf', sourcePage: 2, sourceHash: 'c'.repeat(64), sourceRole: 'content', imagePath: 'intake-assets/actual-drawing.png', width: 1200, height: 800 },
  ] };
  const assessment: BlockoutFitAssessment = { version: 1, documentId: document.documentId, documentRevision: createHash('sha256').update(JSON.stringify(BlockoutDocumentSchema.parse(document))).digest('hex'), materialRevision: inventory.revision, inventoryRevision: inventory.revision, selectedContentIds: document.materialIds, status: 'warning', assessedAt: '2026-10-23T17:00:00Z', excludedVariantIds: [], limitations: [], policy: { sparseDensity: .24, adjacentDensityDifference: .35, minimumImageDpi: 150 }, issues: [], alternatives: { status: 'ready', distinctCount: 1, minimum: 1, pairs: [], issues: [] }, variants: [{ variantId: 'brief', status: 'warning', boundContentIds: document.materialIds, missingContentIds: [], duplicatedContentIds: [], unexpectedContentIds: [], issues: [], pages: [{ pageId: page.id, pageNumber: 1, status: 'warning', safeAreaMm2: 52630, usedAreaMm2: 20000, density: .38, overlapAreaMm2: 0, overflowAreaMm2: 0, issues: [{ code: 'example', severity: 'warning', message: 'Check the real drawing legend', contentIds: ['image'] }], blocks: [
    { blockId: 'text-block', contentIds: ['text'], status: 'ready', boxMm: { x: 21, y: 29.7, width: 168, height: 89.1 }, usableWidthMm: 168, usableHeightMm: 89.1, usedAreaMm2: 1000, overflowWidthMm: 0, overflowHeightMm: 0, issues: [], text: { status: 'measured', fontFamily: 'Arial', fontSizePt: 11, lineHeight: 1.5, engine: 'fixture', limitations: [], lines: [{ text: 'Actual material & <source>', widthMm: 50, inkHeightMm: 3 }, { text: 'Second measured line', widthMm: 45, inkHeightMm: 3 }], lineHeightMm: 5.82, heightMm: 11.64, maxWidthMm: 50 } },
    { blockId: 'image-block', contentIds: ['image'], status: 'ready', boxMm: { x: 21, y: 148.5, width: 168, height: 89.1 }, usableWidthMm: 168, usableHeightMm: 89.1, usedAreaMm2: 19000, overflowWidthMm: 0, overflowHeightMm: 0, issues: [], image: { widthPx: 1200, heightPx: 800, placedWidthMm: 133.65, placedHeightMm: 89.1, effectiveDpi: 228, croppedFraction: 0, fit: 'contain' } },
  ] }] }] };
  return { document, inventory, assessment };
}

describe('Measured Blockout comparison', () => {
  it('renders actual measured lines, source images and warnings with editable page links', () => {
    const { document, inventory, assessment } = fixture();
    const html = renderMeasuredBlockoutComparison(document, inventory, assessment);
    expect(html).toContain('data-measured-lines="2"');
    expect(html).toContain('Actual material &amp; &lt;source&gt;');
    expect(html).toContain('Second measured line');
    expect(html).toContain('href="../../intake-assets/actual-drawing.png"');
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).toContain('38.0%'); expect(html).toContain('Check the real drawing legend');
    expect(html).toContain('data-open-page data-document-id="document-1" data-variant-id="brief" data-page-id="page-1"');
    expect(html).toContain('melillodesign:blockout-page-open');
    expect(html).toContain('<dialog aria-labelledby="page-preview-title">');
    expect(html).not.toContain('.blockout.json');
    expect(html).toContain('1200 × 800 px');
    expect(html).not.toContain('Materiale reale <script>'); expect(html).not.toContain('Intent only, no fictitious content');
    expect(html).not.toContain('textBars');
  });

  it('backs up an earlier comparison and publishes the exact saved revision', async () => {
    const { document, inventory, assessment } = fixture();
    const root = await mkdtemp(path.join(tmpdir(), 'measured-blockout-')); roots.push(root);
    const saved = await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: null });
    const relative = blockoutComparisonPath(document); await mkdir(path.join(root, path.dirname(relative)), { recursive: true });
    const old = '<html>Earlier agent comparison</html>'; await writeFile(path.join(root, relative), old);
    expect(await saveMeasuredBlockoutComparison(root, document, saved.raw!, inventory, assessment)).toBe(relative);
    expect(await readFile(path.join(root, relative), 'utf8')).toContain('data-melillodesign-blockout-comparison="1"');
    const backup = path.join(root, 'blockout/.context/comparison-history', `${createHash('sha256').update(old).digest('hex')}.html`);
    expect(await readFile(backup, 'utf8')).toBe(old);
  });

  it('does not overwrite a newer layout’s comparison with stale measured output', async () => {
    const { document, inventory, assessment } = fixture();
    const root = await mkdtemp(path.join(tmpdir(), 'measured-blockout-')); roots.push(root);
    const first = await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: null });
    const relative = blockoutComparisonPath(document); await mkdir(path.join(root, path.dirname(relative)), { recursive: true });
    await writeFile(path.join(root, relative), '<html>Current comparison</html>');
    await saveBlockoutWorkspace(root, document.documentId, { document: { ...document, title: 'New user title' }, baseRaw: first.raw });
    expect(await saveMeasuredBlockoutComparison(root, document, first.raw!, inventory, assessment)).toBeNull();
    expect(await readFile(path.join(root, relative), 'utf8')).toBe('<html>Current comparison</html>');
    expect((await readdir(path.dirname(path.join(root, relative)))).some((file) => file.endsWith('.tmp'))).toBe(false);
  });
});

function structureFixture() {
  const { document, assessment } = fixture();
  document.planningStage = 'structure';
  document.title = 'Relazione tecnica';
  document.variants[0]!.label = 'A · Lettura continua';
  const page = document.variants[0]!.pages[0]!;
  page.expectation = 'Una pagina di lettura con una figura di supporto';
  page.blocks[0]!.designRole = 'body';
  page.blocks[0]!.feedback = 'Riduci la larghezza del testo';
  page.blocks[1]!.designRole = 'background';
  page.blocks[1]!.expectation = 'Filigrana discreta dietro il testo';
  page.blocks[1]!.images = [{ assetId: 'actual-photo', imagePath: 'intake-assets/never-embed-this.png', title: 'Real source image', description: 'Source description', sourceName: 'Source.pdf', sourcePath: 'Source.pdf', page: 1, width: 1000, height: 800 }];
  assessment.basis = 'structure';
  assessment.inventoryRevision = null;
  assessment.documentRevision = createHash('sha256').update(JSON.stringify(BlockoutDocumentSchema.parse(document))).digest('hex');
  return { document, assessment };
}

describe('Structural Blockout comparison', () => {
  it('renders only explicit user reference previews as faint contained images, preserving metadata and geometry', () => {
    const { document, assessment } = structureFixture();
    const block = document.variants[0]!.pages[0]!.blocks[1]!;
    block.referencePreview = true;
    block.images.push({ ...block.images[0]!, assetId: 'portrait', imagePath: 'intake-assets/portrait #1.png', width: 400, height: 1200 });
    assessment.documentRevision = createHash('sha256').update(JSON.stringify(BlockoutDocumentSchema.parse(document))).digest('hex');
    const before = JSON.stringify(document), dom = new JSDOM(renderStructuralBlockoutComparison(document, assessment));
    const previews = dom.window.document.querySelectorAll('image[data-blockout-reference]');
    expect(previews).toHaveLength(2);
    Array.from(previews).forEach((image) => { expect(image.getAttribute('opacity')).toBe('.25'); expect(image.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet'); });
    expect(previews[1]!.getAttribute('href')).toContain('portrait%20%231.png');
    expect(JSON.stringify(document)).toBe(before); dom.window.close();
  });
  it('renders empty functional blocks and editable intentions without material content or inventory', () => {
    const { document, assessment } = structureFixture();
    const original = JSON.stringify(document);
    const html = renderStructuralBlockoutComparison(document, assessment);
    const dom = new JSDOM(html);
    expect(dom.window.document.querySelectorAll('svg image, img')).toHaveLength(0);
    expect(html).toContain('data-design-role="body"');
    expect(html).toContain('data-design-role="background"');
    expect(html).toContain('Sfondo / filigrana');
    expect(html).toContain('Filigrana discreta dietro il testo');
    expect(html).toContain('Riduci la larghezza del testo');
    expect(html).toContain('Una pagina di lettura con una figura di supporto');
    expect(html).not.toContain('never-embed-this.png');
    expect(html).not.toContain('actual-drawing.png');
    expect(html).not.toContain('Actual material');
    expect(html).not.toContain('Second measured line');
    expect(html).not.toContain('Materiali utilizzati');
    expect(html).not.toContain('Spazio occupato');
    expect(html).not.toContain('38.0%');
    expect(html).toContain('saranno verificate durante la composizione grafica');
    expect(JSON.stringify(document)).toBe(original);
    dom.window.close();
  });

  it('keeps page proportions, block rotation and all supplied alternatives', () => {
    const { document, assessment } = structureFixture();
    const firstPage = document.variants[0]!.pages[0]!;
    firstPage.widthMm = 420; firstPage.heightMm = 297;
    firstPage.blocks[0]!.box.rotation = 20;
    document.variants.push({ id: 'second', label: 'B · Testo e richiamo', pages: [{ ...firstPage, id: 'page-second', blocks: [] }] });
    assessment.documentRevision = createHash('sha256').update(JSON.stringify(BlockoutDocumentSchema.parse(document))).digest('hex');
    assessment.excludedVariantIds = ['second'];
    const dom = new JSDOM(renderStructuralBlockoutComparison(document, assessment));
    const first = dom.window.document.querySelector('svg')!;
    expect(first.getAttribute('viewBox')).toBe('0 0 420 297');
    expect(first.querySelector('[data-block-id="text-block"]')!.getAttribute('transform')).toBe('rotate(20 210 74.25)');
    const box = first.querySelector('[data-block-id="text-block"] > rect')!;
    expect(box.getAttribute('x')).toBe('42'); expect(box.getAttribute('width')).toBe('336');
    expect(dom.window.document.querySelectorAll('.proposals > article')).toHaveLength(2);
    expect(dom.window.document.querySelector('[data-variant-id="second"]')).not.toBeNull();
    expect(dom.window.document.querySelectorAll('a[href]')).toHaveLength(0);
    dom.window.close();
  });

  it('rejects a stale document revision or material-fit assessment', () => {
    const { document, assessment } = structureFixture();
    expect(() => renderStructuralBlockoutComparison({ ...document, title: 'Updated title' }, assessment)).toThrow('snapshot');
    expect(() => renderStructuralBlockoutComparison(document, { ...assessment, basis: 'materials' })).toThrow('structural assessment');
  });

  it('keeps previews read-only and selects the whole named proposal through a dedicated message', () => {
    const { document, assessment } = structureFixture();
    const dom = new JSDOM(renderStructuralBlockoutComparison(document, assessment), { url: 'http://localhost/projects/test/files/comparison.html', runScripts: 'dangerously' });
    const postMessage = vi.fn();
    Object.defineProperty(dom.window, 'parent', { value: { postMessage } });
    const showModal = vi.fn();
    Object.defineProperty(dom.window.document.querySelector('dialog'), 'showModal', { value: showModal });
    expect(dom.window.document.querySelectorAll('[data-open-page], [data-scroll-target]')).toHaveLength(0);
    expect(dom.window.document.querySelector('.structureProposal h2')!.textContent).toBe('Lettura continua');
    expect(dom.window.document.querySelectorAll('[data-select-proposal]')).toHaveLength(1);
    dom.window.document.querySelector('svg > rect')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(showModal).toHaveBeenCalledOnce();
    expect(postMessage).not.toHaveBeenCalled();
    expect(dom.window.document.querySelector('[data-page-preview]')!.textContent).toContain('Riduci la larghezza del testo');
    dom.window.document.querySelector('[data-select-proposal]')!.click();
    expect(postMessage).toHaveBeenCalledWith({ type: 'melillodesign:blockout-proposal-select', documentId: 'document-1', variantId: 'brief' }, '*');
    expect(dom.window.document.querySelector('[data-select-proposal]')!.getAttribute('aria-pressed')).toBe('true');
    expect(dom.window.location.href).toBe('http://localhost/projects/test/files/comparison.html');
    dom.window.close();
  });

  it('marks standalone selection locally without pretending to save it to the project', () => {
    const { document, assessment } = structureFixture();
    const dom = new JSDOM(renderStructuralBlockoutComparison(document, assessment), { runScripts: 'dangerously' });
    dom.window.document.querySelector('[data-select-proposal]')!.click();
    expect(dom.window.document.querySelector('[data-proposal-selection-status]')!.textContent).toContain('non è stata salvata nel progetto');
    dom.window.close();
  });

  it('previews the clicked page, navigates within its proposal, and chooses that current page for editing only after selection saves', () => {
    const { document, assessment } = structureFixture();
    const page = document.variants[0]!.pages[0]!;
    document.variants[0]!.pages.push({ ...page, id: 'page-2', label: 'Seconda pagina' });
    assessment.documentRevision = createHash('sha256').update(JSON.stringify(BlockoutDocumentSchema.parse(document))).digest('hex');
    const dom = new JSDOM(renderStructuralBlockoutComparison(document, assessment), { url: 'http://preview.localhost/comparison.html', referrer: 'http://localhost/project', runScripts: 'dangerously' });
    const postMessage = vi.fn(), host = { postMessage };
    Object.defineProperty(dom.window, 'parent', { value: host });
    const dialog = dom.window.document.querySelector('dialog')!;
    const showModal = vi.fn(() => dialog.setAttribute('open', ''));
    const close = vi.fn(() => dialog.removeAttribute('open'));
    Object.defineProperty(dialog, 'showModal', { value: showModal });
    Object.defineProperty(dialog, 'close', { value: close });
    dom.window.document.querySelector('[data-page-id="page-2"] h3')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(showModal).toHaveBeenCalledOnce();
    expect(dom.window.document.querySelector('[data-preview-position]')!.textContent).toBe('Pagina 2 di 2');
    expect(dom.window.document.querySelector('[data-preview-next]')!.getAttribute('disabled')).not.toBeNull();
    dom.window.document.querySelector('[data-preview-previous]')!.click();
    expect(dom.window.document.querySelector('[data-preview-position]')!.textContent).toBe('Pagina 1 di 2');
    dom.window.document.querySelector('[data-preview-next]')!.click();
    expect(postMessage).not.toHaveBeenCalled();
    const chooseAndEdit = dom.window.document.querySelector('[data-choose-preview-edit]')!;
    chooseAndEdit.click();
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'melillodesign:blockout-proposal-select', documentId: 'document-1', variantId: 'brief', editPageId: 'page-2' }, '*');
    expect(close).not.toHaveBeenCalled();
    expect(chooseAndEdit.getAttribute('disabled')).not.toBeNull();
    const reply = (saved: boolean, variantId = 'brief', origin = 'http://localhost') => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: host, origin, data: { type: 'melillodesign:blockout-proposal-result', documentId: 'document-1', variantId, saved } }));
    reply(true, 'different-proposal');
    reply(true, 'brief', 'http://unrelated.test');
    expect(close).not.toHaveBeenCalled();
    reply(false);
    expect(dom.window.document.querySelector('[data-preview-selection-status]')!.textContent).toBe('Scelta non salvata. Riprova.');
    expect(dialog.getAttribute('open')).not.toBeNull();
    expect(chooseAndEdit.getAttribute('disabled')).toBeNull();
    chooseAndEdit.click();
    expect(postMessage).toHaveBeenCalledTimes(2);
    reply(true);
    expect(close).toHaveBeenCalledOnce();
    expect(dialog.getAttribute('open')).toBeNull();
    expect(dom.window.document.querySelector('[data-proposal-selection-status]')!.textContent).toBe('Scelta salvata nel progetto.');
    dom.window.close();
  });

  it('chooses the whole proposal from modal without requesting an editor page', () => {
    const { document, assessment } = structureFixture();
    const dom = new JSDOM(renderStructuralBlockoutComparison(document, assessment), { url: 'http://localhost/comparison.html', runScripts: 'dangerously' });
    const postMessage = vi.fn();
    Object.defineProperty(dom.window, 'parent', { value: { postMessage } });
    Object.defineProperty(dom.window.document.querySelector('dialog'), 'showModal', { value: vi.fn() });
    dom.window.document.querySelector('[data-preview-page]')!.click();
    dom.window.document.querySelector('[data-choose-preview]')!.click();
    expect(postMessage).toHaveBeenCalledWith({ type: 'melillodesign:blockout-proposal-select', documentId: 'document-1', variantId: 'brief' }, '*');
    dom.window.close();
  });

  it('keeps composition proposal navigation inside the same comparison document', () => {
    const { document, inventory, assessment } = fixture();
    const dom = new JSDOM(renderMeasuredBlockoutComparison(document, inventory, assessment), { url: 'http://localhost/comparison.html', runScripts: 'dangerously' });
    const article = dom.window.document.querySelector('article')!, scroll = vi.fn();
    article.scrollIntoView = scroll;
    dom.window.document.querySelector('[data-scroll-target]')!.click();
    expect(scroll).toHaveBeenCalledOnce();
    expect(dom.window.document.activeElement).toBe(article);
    expect(dom.window.location.href).toBe('http://localhost/comparison.html');
    dom.window.close();
  });

  it('uses shared snapshot publication and preserves the prior canonical comparison in history', async () => {
    const { document, assessment } = structureFixture();
    const root = await mkdtemp(path.join(tmpdir(), 'structural-blockout-')); roots.push(root);
    const saved = await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: null });
    const relative = blockoutComparisonPath(document);
    await mkdir(path.join(root, path.dirname(relative)), { recursive: true });
    const old = '<html data-melillodesign-blockout-comparison="1">Previous composed comparison</html>';
    await writeFile(path.join(root, relative), old);
    expect(await saveStructuralBlockoutComparison(root, document, saved.raw!, assessment)).toBe(relative);
    const html = await readFile(path.join(root, relative), 'utf8');
    expect(html).toContain('blockout-planning-stage" content="structure');
    const backup = path.join(root, 'blockout/.context/comparison-history', `${createHash('sha256').update(old).digest('hex')}.html`);
    expect(await readFile(backup, 'utf8')).toBe(old);
    expect((await readFile(path.join(root, 'blockout/layout.json'), 'utf8'))).toContain('never-embed-this.png');
    await saveBlockoutWorkspace(root, document.documentId, { document: { ...document, title: 'New title' }, baseRaw: saved.raw });
    expect(await saveStructuralBlockoutComparison(root, document, saved.raw!, assessment)).toBeNull();
    expect(await readFile(path.join(root, relative), 'utf8')).toBe(html);
    expect((await readdir(path.dirname(path.join(root, relative)))).some((file) => file.endsWith('.tmp'))).toBe(false);
  });

  it('refuses an assessment for a different document even if the supplied raw revision is current', async () => {
    const { document, assessment } = structureFixture();
    const root = await mkdtemp(path.join(tmpdir(), 'structural-blockout-')); roots.push(root);
    const saved = await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: null });
    const changed = { ...document, title: 'Different snapshot' };
    const changedAssessment = { ...assessment, documentRevision: createHash('sha256').update(JSON.stringify(BlockoutDocumentSchema.parse(changed))).digest('hex') };
    expect(await saveStructuralBlockoutComparison(root, changed, saved.raw!, changedAssessment)).toBeNull();
    await expect(readFile(path.join(root, blockoutComparisonPath(changed)), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
