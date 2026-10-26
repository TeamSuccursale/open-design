import { describe, expect, it } from 'vitest';
import { BlockoutDocumentSchema, BlockoutPageBudgetSchema, createBlockoutDocument, createBlockoutPage, renderBlockoutBrief, type BlockoutBlock } from '../src/api/blockout.js';
import { deriveBlockoutPageBudget, getBlockoutPageBudgetStatus, moveBlockoutBlock, projectBlockoutBoxToPage, reorderBlockoutPages } from '../src/api/blockout-document.js';
import { blockoutOutsideSafeArea } from '../src/api/blockout-geometry.js';
import { blockoutPageFiles } from '../src/api/blockout-files.js';
import { type DocumentSetup } from '../src/api/document-setup.js';

function block(id = 'figure'): BlockoutBlock {
  return { id, kind: 'image', label: 'Survey photograph', box: { x: 20, y: 25, width: 40, height: 30, rotation: 23 },
    lockRatio: true, images: [], references: [], expectation: 'Preserve the survey label', feedback: 'Crop less tightly', flexibility: 'guided' };
}
function documentWithTwoPages() {
  const document = createBlockoutDocument();
  document.variants[0]!.pages.push(createBlockoutPage('page-2', 'Second page'));
  document.variants[0]!.pages[0]!.blocks.push(block());
  return document;
}
function setup(value = 'Massimo 4 pagine', kind: DocumentSetup['intent']['kind'] = 'tender-offer'): DocumentSetup {
  const constraint = { id: 'page-rule', kind: 'page-limit' as const, value, status: 'confirmed' as const, sourceIds: ['disciplinare'] };
  return { version: 1, status: 'confirmed', intent: { kind, subtype: 'Technical document', purpose: '', contextRoots: [], imageIntakeConsent: false },
    workingDirectory: 'workspace', scan: { status: 'complete', sources: [{ id: 'disciplinare', title: 'Disciplinare', path: 'disciplinare.pdf', root: 'workspace', page: 18,
      excerpt: value, readable: true, role: 'rules' }], constraints: [constraint], warnings: [] },
    confirmed: { purpose: 'Present the supplied material', constraints: [constraint], blockoutApproach: 'agent', confirmedAt: '2026-10-23' }, updatedAt: '2026-10-23' };
}

describe('document-wide page budgets', () => {
  it('keeps older documents valid and counts old pages unless explicitly excluded', () => {
    const document = documentWithTwoPages();
    expect(BlockoutDocumentSchema.safeParse(document).success).toBe(true);
    document.variants[0]!.pages[0]!.countsTowardLimit = false;
    expect(getBlockoutPageBudgetStatus(document)).toMatchObject({ total: 2, counted: 1, excluded: 1, over: 0, unfilled: 0 });
  });
  it('compares each whole proposal to its target without preventing over-budget draft pages', () => {
    const document = documentWithTwoPages(); document.pageBudget = { mode: 'maximum', limit: 4, target: 4 };
    document.variants.push({ id: 'b', label: 'B', pages: Array.from({ length: 5 }, (_, index) => createBlockoutPage(`b-${index}`, '')) });
    expect(getBlockoutPageBudgetStatus(document, 'brief')).toMatchObject({ counted: 2, remaining: 2, unfilled: 2, over: 0 });
    expect(getBlockoutPageBudgetStatus(document, 'b')).toMatchObject({ counted: 5, remaining: 0, unfilled: 0, over: 1 });
    expect(BlockoutDocumentSchema.safeParse(document).success).toBe(true);
    expect(() => getBlockoutPageBudgetStatus(document, 'missing')).toThrow('missing');
  });
  it('resolves exact counts and keeps a flexible target separate from a source ceiling', () => {
    const document = documentWithTwoPages(); document.pageBudget = { mode: 'exact', limit: 4 };
    expect(getBlockoutPageBudgetStatus(document)).toMatchObject({ target: 4, unfilled: 2 });
    document.pageBudget = { mode: 'flexible', limit: 1, target: 3 };
    expect(getBlockoutPageBudgetStatus(document)).toMatchObject({ target: 3, over: 0, unfilled: 1 });
    expect(getBlockoutPageBudgetStatus(document).limit).toBeUndefined();
    expect(BlockoutPageBudgetSchema.safeParse({ mode: 'maximum' }).success).toBe(false);
    expect(BlockoutPageBudgetSchema.safeParse({ mode: 'maximum', limit: 4, target: 5 }).success).toBe(false);
    expect(BlockoutPageBudgetSchema.safeParse({ mode: 'exact', limit: 4, target: 3 }).success).toBe(false);
  });
  it('carries the page budget, source and exclusions into saved page files and the agent brief', () => {
    const document = documentWithTwoPages(); document.pageBudget = { mode: 'maximum', limit: 4, target: 4, source: 'Disciplinare p. 18', note: 'Cover excluded' };
    document.variants[0]!.pages[0]!.countsTowardLimit = false;
    const file = JSON.parse(blockoutPageFiles(document)[0]!.content);
    expect(file.pageBudget).toEqual(document.pageBudget);
    expect(file.variants[0].page.countsTowardLimit).toBe(false);
    expect(renderBlockoutBrief(document)).toContain('Disciplinare p. 18');
    expect(renderBlockoutBrief(document)).toContain('countsTowardLimit');
  });
  it('uses the entire confirmed maximum for both tender offers and tender forms, preserving provenance', () => {
    for (const kind of ['tender-offer', 'tender-form'] as const) {
      expect(deriveBlockoutPageBudget(setup('Non oltre 4 pagine, formato A4, carattere 11', kind))).toMatchObject({ mode: 'maximum', limit: 4, target: 4,
        source: 'Disciplinare (p. 18) [disciplinare]', note: 'Non oltre 4 pagine, formato A4, carattere 11' });
    }
    expect(deriveBlockoutPageBudget(setup('Maximum 4 pages', 'report'))).toMatchObject({ mode: 'maximum', limit: 4, target: undefined });
    expect(deriveBlockoutPageBudget(setup('Esattamente 4 facciate', 'report'))).toMatchObject({ mode: 'exact', limit: 4, target: 4 });
    expect(deriveBlockoutPageBudget(setup('Elaborato grafico: esattamente 4 tavole (appunti.txt, pagina logica 1).', 'report'))).toMatchObject({ mode: 'exact', limit: 4, target: 4 });
  });
  it('honors an explicit smaller target while preserving the source ceiling and rejects invalid targets', () => {
    const explicit = setup(); explicit.confirmed!.pageTarget = 3;
    expect(deriveBlockoutPageBudget(explicit)).toMatchObject({ mode: 'maximum', limit: 4, target: 3, source: 'Disciplinare (p. 18) [disciplinare]' });
    explicit.confirmed!.pageTarget = 5;
    expect(() => deriveBlockoutPageBudget(explicit)).toThrow('cannot exceed');
    const exact = setup('Esattamente 4 pagine'); exact.confirmed!.pageTarget = 3;
    expect(() => deriveBlockoutPageBudget(exact)).toThrow('must match');
    exact.confirmed!.pageTarget = 4;
    expect(deriveBlockoutPageBudget(exact)).toMatchObject({ mode: 'exact', limit: 4, target: 4 });
    const free = setup(); free.confirmed!.constraints = []; free.confirmed!.pageTarget = 3;
    expect(deriveBlockoutPageBudget(free)).toEqual({ mode: 'flexible', target: 3 });
    const ambiguous = setup('Da 2 a 4 pagine'); ambiguous.confirmed!.pageTarget = 3;
    expect(() => deriveBlockoutPageBudget(ambiguous)).toThrow('Resolve');
  });
  it('does not infer a document budget from ambiguous, conflicting, unconfirmed or unrelated numbers', () => {
    for (const value of ['Massimo 4 pagine per criterio e 8 pagine complessive', 'Da 2 a 4 pagine', 'Massimo 4,5 pagine', 'Formato A4, carattere 11', '4 pagine']) {
      expect(deriveBlockoutPageBudget(setup(value)), value).toBeUndefined();
    }
    const draft = setup(); draft.status = 'review'; expect(deriveBlockoutPageBudget(draft)).toBeUndefined();
    const conflict = setup(); conflict.confirmed!.constraints.push({ ...conflict.confirmed!.constraints[0]!, id: 'other', value: 'Massimo 6 pagine' });
    expect(deriveBlockoutPageBudget(conflict)).toBeUndefined();
    const suggested = setup(); suggested.confirmed!.constraints[0]!.status = 'suggested'; expect(deriveBlockoutPageBudget(suggested)).toBeUndefined();
  });
});

describe('moving blocks between document pages', () => {
  it('preserves all block content and answers, leaves surrounding blocks alone and marks an approved layout for readaptation', () => {
    const document = documentWithTwoPages(), before = structuredClone(document);
    document.approval = { variantId: 'brief', acceptedAt: '2026-10-23' };
    document.answers.push({ formId: 'clarify-figure', target: { pageId: 'page-1', blockId: 'figure' }, answers: { crop: 'Keep the legend' }, answeredAt: '2026-10-23' });
    const moved = moveBlockoutBlock(document, { variantId: 'brief', sourcePageId: 'page-1', blockId: 'figure', targetPageId: 'page-2' });
    expect(moved.variants[0]!.pages[0]!.blocks).toHaveLength(0);
    expect(moved.variants[0]!.pages[1]!.blocks[0]).toEqual(before.variants[0]!.pages[0]!.blocks[0]);
    expect(moved.answers[0]!.target).toEqual({ variantId: 'brief', pageId: 'page-2', blockId: 'figure' });
    expect(moved.needsReadaptation).toBe(true); expect(moved.approval).toEqual(document.approval);
    expect(document.variants).toEqual(before.variants);
    expect(BlockoutDocumentSchema.safeParse(moved).success).toBe(true);
  });
  it('renames a collision without replacing the existing block, including long identities', () => {
    const document = documentWithTwoPages(), identity = 'x'.repeat(120);
    document.variants[0]!.pages[0]!.blocks[0]!.id = identity;
    document.variants[0]!.pages[1]!.blocks.push(block(identity));
    const moved = moveBlockoutBlock(document, { variantId: 'brief', sourcePageId: 'page-1', blockId: identity, targetPageId: 'page-2' });
    expect(moved.variants[0]!.pages[1]!.blocks.map((item) => item.id)).toEqual([identity, `${'x'.repeat(118)}-2`]);
    expect(BlockoutDocumentSchema.safeParse(moved).success).toBe(true);
  });
  it('keeps physical size and rotation when a different paper size has room', () => {
    const source = createBlockoutPage('source', ''), target = createBlockoutPage('target', '');
    target.widthMm = 297; target.heightMm = 420;
    const original = block().box, projected = projectBlockoutBoxToPage(original, source, target);
    expect(projected.box.width * target.widthMm).toBeCloseTo(original.width * source.widthMm);
    expect(projected.box.height * target.heightMm).toBeCloseTo(original.height * source.heightMm);
    expect(projected.box.rotation).toBe(23); expect(projected.scaled).toBe(false);
    expect(blockoutOutsideSafeArea(projected.box, target)).toBe(false);
  });
  it('uniformly scales an oversized rotated block into a smaller safe area without changing its physical ratio', () => {
    const source = createBlockoutPage('source', ''), target = createBlockoutPage('target', '');
    source.widthMm = 420; source.heightMm = 594;
    const original = { ...block().box, width: 90, height: 90 }, projected = projectBlockoutBoxToPage(original, source, target);
    expect(projected.scaled).toBe(true);
    expect(projected.box.width * target.widthMm / (projected.box.height * target.heightMm)).toBeCloseTo(original.width * source.widthMm / (original.height * source.heightMm));
    expect(blockoutOutsideSafeArea(projected.box, target)).toBe(false);
  });
  it('keeps serialized transforms valid near corners for rotated transfers across A3, A4 and landscape paper', () => {
    for (const rotation of [-180, -90, -23, 0, 45, 90, 179]) for (const targetSize of [[210, 297], [297, 210], [420, 594]]) {
      const source = createBlockoutPage('source', ''), target = createBlockoutPage('target', '');
      source.widthMm = 420; source.heightMm = 594;
      target.widthMm = targetSize[0]!; target.heightMm = targetSize[1]!; target.safeMarginMm = 12;
      const original = { x: 0, y: 0, width: 85, height: 5, rotation };
      const projected = projectBlockoutBoxToPage(original, source, target);
      const document = createBlockoutDocument(); document.variants[0]!.pages[0] = { ...target, blocks: [{ ...block(), box: projected.box }] };
      expect(BlockoutDocumentSchema.safeParse(document).success, `rotation ${rotation}, ${targetSize}`).toBe(true);
      expect(blockoutOutsideSafeArea(projected.box, target), `rotation ${rotation}, ${targetSize}`).toBe(false);
    }
  });
  it('fails visibly for missing targets and otherwise treats an in-page transfer as a no-op', () => {
    const document = documentWithTwoPages();
    expect(moveBlockoutBlock(document, { variantId: 'brief', sourcePageId: 'page-1', blockId: 'figure', targetPageId: 'page-1' })).toBe(document);
    expect(() => moveBlockoutBlock(document, { variantId: 'brief', sourcePageId: 'page-1', blockId: 'figure', targetPageId: 'missing' })).toThrow('missing');
  });
  it('reorders a complete proposal without losing pages or changing other proposals', () => {
    const document = documentWithTwoPages(); document.variants.push({ id: 'b', label: 'B', pages: [createBlockoutPage('b-1', '')] });
    const other = document.variants[1]; document.approval = { variantId: 'brief', acceptedAt: '2026-10-23' };
    const reordered = reorderBlockoutPages(document, 'brief', ['page-2', 'page-1']);
    expect(reordered.variants[0]!.pages.map((page) => page.id)).toEqual(['page-2', 'page-1']);
    expect(reordered.variants[1]).toBe(other); expect(reordered.needsReadaptation).toBe(true);
    expect(() => reorderBlockoutPages(document, 'brief', ['page-2'])).toThrow('every page');
    expect(() => reorderBlockoutPages(document, 'brief', ['page-2', 'page-2'])).toThrow('every page');
  });
});
