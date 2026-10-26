import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBlockoutDocument, createBlockoutPage, type BlockoutBlock, type BlockoutDocument, type BlockoutMaterialInventory, type BlockoutMaterialItem } from '@open-design/contracts';
import { assessBlockoutFit } from '../src/services/blockout-fit.js';

const revision = 'b'.repeat(64), hash = 'a'.repeat(64), normalText = Array(250).fill('progetto').join(' ');
const arial = existsSync('C:/Windows/Fonts/arial.ttf') || existsSync('/Library/Fonts/arial.ttf') || existsSync('/usr/share/fonts/truetype/msttcorefonts/arial.ttf');
const bundled = path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const python = process.env.MELILLO_PYTHON || (existsSync(bundled) ? bundled : 'python');
const pillowAvailable = (() => { try { execFileSync(python, ['-c', 'from PIL import Image'], { windowsHide: true, stdio: 'ignore' }); return true; } catch { return false; } })();
let root = '', imageHash = hash;
const options = () => ({ projectRoot: root, minimumAlternatives: 1 });
beforeAll(async () => {
  if (!pillowAvailable) return;
  root = await mkdtemp(path.join(tmpdir(), 'blockout-fit-'));
  execFileSync(python, ['-c', 'from PIL import Image; import sys,os; Image.new("RGB",(2000,2800),"white").save(os.path.join(sys.argv[1],"portrait.png")); Image.new("RGB",(3000,2000),"white").save(os.path.join(sys.argv[1],"landscape.png"))', root], { windowsHide: true });
  imageHash = createHash('sha256').update(await readFile(path.join(root, 'portrait.png'))).digest('hex');
});
afterAll(async () => { if (root && path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)) await rm(root, { recursive: true, force: true }); });
function textItem(id = 'text', text = normalText): Extract<BlockoutMaterialItem, { kind: 'text' }> {
  return { id, label: 'Exact source paragraph', kind: 'text', text, offsetStart: 0, offsetEnd: text.length, sourcePath: 'source.txt', sourcePage: 1, sourceHash: hash, sourceRole: 'content' };
}
function visualItem(id = 'image', landscape = false, kind: 'image' | 'table' | 'drawing' = 'image'): Exclude<BlockoutMaterialItem, { kind: 'text' }> {
  return { id, label: 'Source raster', kind, imagePath: landscape ? 'landscape.png' : 'portrait.png', width: landscape ? 3000 : 2000, height: landscape ? 2000 : 2800, sourcePath: 'portrait.png', sourcePage: 1, sourceHash: imageHash, sourceRole: 'content' };
}
function inventory(items: BlockoutMaterialItem[]): BlockoutMaterialInventory {
  const sources = [...new Map(items.map((item) => [item.sourcePath, { id: item.sourcePath, path: item.sourcePath, hash: item.sourceHash, role: 'content' as const, status: 'ready' as const, pagesProcessed: 1, pagesTotal: 1, gaps: [] }])).values()];
  return { version: 1, projectId: 'project', revision, status: 'ready', sources: { processed: sources.length, total: sources.length, entries: sources }, items, gaps: [], createdAt: '2026-10-23T12:00:00Z', updatedAt: '2026-10-23T12:00:00Z' };
}
function block(id: string, contentIds: string[], patch: Partial<BlockoutBlock> = {}): BlockoutBlock {
  return { id, label: 'Bound material', kind: 'text', box: { x: 5, y: 5, width: 90, height: 90, rotation: 0 }, lockRatio: false, images: [], references: [], expectation: '', feedback: '', flexibility: 'guided', contentIds, typography: { fontFamily: 'Arial', fontSizePt: 11, lineHeight: 1.5 }, ...patch };
}
function document(ids: string[], blocks = [block('body', ids)]): BlockoutDocument {
  const doc = createBlockoutDocument(); doc.activeVariantId = 'a'; doc.materialRevision = revision; doc.materialIds = ids; doc.pageBudget = { mode: 'maximum', limit: 8, target: 1 };
  doc.variants = [{ id: 'a', label: 'Proposal A', pages: [{ ...createBlockoutPage('page', 'Body'), role: 'body', blocks }] }]; return doc;
}
const allIssues = (result: Awaited<ReturnType<typeof assessBlockoutFit>>) => [...result.issues, ...result.alternatives.issues, ...result.variants.flatMap((variant) => [...variant.issues, ...variant.pages.flatMap((page) => [...page.issues, ...page.blocks.flatMap((block) => block.issues)])])];

describe.skipIf(!pillowAvailable)('material-bound physical Blockout assessment (requires Pillow)', () => {
  it.skipIf(!arial)('measures a normal flowed Arial11/1.5 body page without falsely calling it mostly empty', async () => {
    const doc = document(['text']), before = structuredClone(doc);
    const result = await assessBlockoutFit(doc, inventory([textItem()]), options());
    expect(result.status).toBe('ready'); expect(allIssues(result).some((issue) => issue.code === 'body-page-sparse')).toBe(false);
    expect(result.variants[0]!.pages[0]!.density).toBeGreaterThan(0.25);
    expect(result.variants[0]!.pages[0]!.blocks[0]!.text!.fontSizePt).toBe(11); expect(doc).toEqual(before);
  });
  it.skipIf(!arial)('reports exact overfull source text and physical overflow instead of reducing its font', async () => {
    const doc = document(['text'], [block('body', ['text'], { box: { x: 5, y: 5, width: 90, height: 5, rotation: 0 } })]);
    const result = await assessBlockoutFit(doc, inventory([textItem('text', normalText.repeat(5))]), options());
    const measured = result.variants[0]!.pages[0]!.blocks[0]!;
    expect(result.status).toBe('blocked'); expect(measured.overflowHeightMm).toBeGreaterThan(100); expect(measured.text!.fontSizePt).toBe(11);
    expect(allIssues(result).some((issue) => issue.code === 'text-overflow')).toBe(true);
  });
  it.skipIf(!arial)('uses shared exact contiguous text composition and leaves source offsets/CRLF intact', async () => {
    const first = textItem('first', 'First paragraph\r\n\r\n'), second = { ...textItem('second', 'Second paragraph'), offsetStart: first.offsetEnd, offsetEnd: first.offsetEnd + 'Second paragraph'.length };
    const result = await assessBlockoutFit(document(['first', 'second']), inventory([first, second]), options());
    expect(result.variants[0]!.pages[0]!.blocks[0]!.text!.lines.map((line) => line.text)).toEqual(['First paragraph', '', 'Second paragraph']);
    expect(first.text).toContain('\r\n'); expect(second.offsetStart).toBe(first.offsetEnd);
  });
  it('blocks unbound placeholders, stale revisions and unavailable preserved-font measurement', async () => {
    const doc = document(['text'], [block('placeholder', [])]); doc.materialRevision = 'old';
    const result = await assessBlockoutFit(doc, inventory([textItem()]), options());
    expect(result.status).toBe('blocked'); expect(allIssues(result).map((issue) => issue.code)).toEqual(expect.arrayContaining(['material-revision-stale', 'block-material-missing', 'allocation-incomplete']));
    const unknown = document(['text']); unknown.variants[0]!.pages[0]!.blocks[0]!.typography!.fontFamily = 'Unknown Font';
    const notMeasured = await assessBlockoutFit(unknown, inventory([textItem()]), options());
    expect(notMeasured.status).toBe('blocked'); expect(allIssues(notMeasured).some((issue) => issue.code === 'text-measurement-unavailable')).toBe(true);
  });
  it('waits honestly for absent/preparing material and excludes the blank legacy brief from proposals', async () => {
    expect((await assessBlockoutFit(document(['text']), null, options())).status).toBe('waiting');
    const preparing = inventory([textItem()]); preparing.status = 'preparing';
    expect((await assessBlockoutFit(document(['text']), preparing, options())).status).toBe('waiting');
    const blank = createBlockoutDocument(); blank.materialRevision = revision; blank.materialIds = ['text'];
    const result = await assessBlockoutFit(blank, inventory([textItem()]), options());
    expect(result.status).not.toBe('ready'); expect(result.excludedVariantIds).toEqual(['brief']); expect(result.variants).toEqual([]);
  });
  it('checks real raster dimensions, contain/crop proportions and effective physical resolution', async () => {
    const item = visualItem(), doc = document(['image'], [block('image', ['image'], { kind: 'image' })]);
    const fit = await assessBlockoutFit(doc, inventory([item]), options()), image = fit.variants[0]!.pages[0]!.blocks[0]!.image!;
    expect(image.widthPx).toBe(2000); expect(image.heightPx).toBe(2800); expect(image.placedWidthMm / image.placedHeightMm).toBeCloseTo(2000 / 2800, 8); expect(image.effectiveDpi).toBeGreaterThan(150);
    const stale = { ...item, width: 500 };
    expect(allIssues(await assessBlockoutFit(doc, inventory([stale]), options())).some((issue) => issue.code === 'image-dimensions-stale')).toBe(true);
    doc.variants[0]!.pages[0]!.blocks[0]!.imageFit = 'cover';
    const cropped = await assessBlockoutFit(doc, inventory([item]), options());
    expect(cropped.variants[0]!.pages[0]!.blocks[0]!.image!.croppedFraction).toBeGreaterThan(0); expect(allIssues(cropped).some((issue) => issue.code === 'image-cropped')).toBe(true);
  });
  it('uses union density, flags actual overlap and drastic adjacent sparse allocation without shortening the target', async () => {
    const items = [visualItem('first'), visualItem('second')], doc = document(['first', 'second']);
    doc.pageBudget = { mode: 'maximum', limit: 4, target: 2 };
    doc.variants[0]!.pages = [
      { ...createBlockoutPage('dense', 'Dense'), blocks: [block('dense', ['first'], { kind: 'image' })] },
      { ...createBlockoutPage('sparse', 'Sparse'), blocks: [block('sparse', ['second'], { kind: 'image', box: { x: 10, y: 10, width: 15, height: 15, rotation: 0 } })] },
    ];
    const result = await assessBlockoutFit(doc, inventory(items), options());
    expect(allIssues(result).map((issue) => issue.code)).toEqual(expect.arrayContaining(['body-page-sparse', 'adjacent-density-imbalance'])); expect(doc.pageBudget.target).toBe(2);
    const overlap = document(['first', 'second'], [block('one', ['first'], { kind: 'image' }), block('two', ['second'], { kind: 'image' })]);
    const overlapped = await assessBlockoutFit(overlap, inventory(items), options()), page = overlapped.variants[0]!.pages[0]!;
    expect(overlapped.status).toBe('blocked'); expect(page.overlapAreaMm2).toBeCloseTo(page.usedAreaMm2, 5); expect(page.usedAreaMm2).toBeLessThan(page.safeAreaMm2);
  });
  it('requires every alternative to allocate the same selected items exactly once and rejects renamed duplicates', async () => {
    const doc = document(['image'], [block('image', ['image'], { kind: 'image' })]);
    const b = structuredClone(doc.variants[0]!); b.id = 'b'; b.label = 'Different label'; b.pages[0]!.blocks[0]!.box.x += 1;
    const c = structuredClone(doc.variants[0]!); c.id = 'c'; c.pages[0]!.blocks[0]!.contentIds = [];
    doc.variants.push(b, c);
    const result = await assessBlockoutFit(doc, inventory([visualItem()]), { ...options(), minimumAlternatives: 3 });
    expect(result.status).toBe('blocked'); expect(result.variants[2]!.missingContentIds).toEqual(['image']);
    expect(allIssues(result).map((issue) => issue.code)).toEqual(expect.arrayContaining(['allocation-incomplete', 'alternatives-not-distinct', 'alternatives-content-mismatch']));
  });
  it('blocks duplicate bindings, missing rasters and a measurer that silently substitutes a smaller font', async () => {
    const duplicated = document(['text'], [block('first', ['text']), block('second', ['text'])]);
    const duplicateResult = await assessBlockoutFit(duplicated, inventory([textItem()]), { ...options(), measureText: async (request) => ({ ...request, status: 'unavailable', engine: 'test', limitations: ['Unavailable'], lines: [], lineHeightMm: 0, heightMm: 0, maxWidthMm: 0 }) });
    expect(duplicateResult.variants[0]!.duplicatedContentIds).toEqual(['text']);
    const badFont = await assessBlockoutFit(document(['text']), inventory([textItem()]), { ...options(), measureText: async (request) => ({ ...request, fontSizePt: 8, status: 'measured', engine: 'substituted', limitations: [], lines: [{ text: request.text, widthMm: 10, inkHeightMm: 2 }], lineHeightMm: 4, heightMm: 4, maxWidthMm: 10 }) });
    expect(badFont.status).toBe('blocked'); expect(allIssues(badFont).some((issue) => issue.code === 'text-measurement-unavailable')).toBe(true);
    const missing = visualItem(); missing.imagePath = 'missing-raster.png';
    const missingImage = await assessBlockoutFit(document(['image'], [block('image', ['image'], { kind: 'image' })]), inventory([missing]), options());
    expect(missingImage.status).toBe('blocked'); expect(allIssues(missingImage).some((issue) => issue.code === 'image-measurement-unavailable')).toBe(true);
  });
  it.each([{ count: 8, landscape: false }, { count: 4, landscape: true }])('preserves chosen $count-page scope and measures raster tables at their actual dimensions', async ({ count, landscape }) => {
    const items = Array.from({ length: count }, (_, index) => visualItem(`source-${index}`, landscape, 'table'));
    const doc = document(items.map((item) => item.id)); doc.pageBudget = { mode: 'maximum', limit: count, target: count };
    doc.variants[0]!.pages = items.map((item, index) => ({ ...createBlockoutPage(`page-${index}`, `Page ${index + 1}`), widthMm: landscape ? 420 : 210, heightMm: 297, blocks: [block(`table-${index}`, [item.id], { kind: 'table' })] }));
    const result = await assessBlockoutFit(doc, inventory(items), options());
    expect(result.status).toBe('ready'); expect(result.variants[0]!.pages).toHaveLength(count); expect(doc.pageBudget.target).toBe(count);
    expect(result.variants[0]!.pages.every((page) => page.blocks[0]!.image!.widthPx === (landscape ? 3000 : 2000))).toBe(true);
  });
});
