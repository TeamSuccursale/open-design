import { describe, expect, it } from 'vitest';
import { BlockoutDocumentSchema, blockoutBoxWithRatio, constrainBlockoutBox, createBlockoutDocument, mergeBlockoutBriefDraft, renderBlockoutBrief, resizeBlockoutBox, resolveBlockoutTarget } from '../src/api/blockout.js';

describe('blockout document and transforms', () => {
  it('replaces an older resolved brief without duplicating it or losing surrounding notes', () => {
    const doc = createBlockoutDocument(); const first = renderBlockoutBrief(doc);
    doc.title = 'Revised'; const second = renderBlockoutBrief(doc);
    const merged = mergeBlockoutBriefDraft(`Keep these instructions.\n\n${first}\n\nAlso keep this note.`, second);
    expect(merged.match(/# Blockout starting brief/g)).toHaveLength(1);
    expect(merged).toContain('Revised'); expect(merged).toContain('Also keep this note.'); expect(merged).toContain('Keep these instructions.');
  });
  it('validates stable identities and refuses duplicate or missing variant targets', () => {
    const doc = createBlockoutDocument();
    expect(BlockoutDocumentSchema.safeParse(doc).success).toBe(true);
    expect(BlockoutDocumentSchema.safeParse({ ...doc, activeVariantId: 'absent' }).success).toBe(false);
    expect(BlockoutDocumentSchema.safeParse({ ...doc, variants: [...doc.variants, doc.variants[0]] }).success).toBe(false);
    expect(resolveBlockoutTarget(doc, { pageId: 'page-1' })?.page.widthMm).toBe(210);
    expect(resolveBlockoutTarget(doc, { pageId: 'page-1', blockId: 'missing' })).toBeNull();
  });
  it('keeps moves inside the page and clamps invalid dimensions', () => {
    expect(constrainBlockoutBox({ x: 96, y: -5, width: 30, height: 120, rotation: 999 })).toEqual({ x: 70, y: 0, width: 30, height: 100, rotation: 180 });
  });
  it('uses physical paper proportions when changing image ratio', () => {
    const box = blockoutBoxWithRatio({ x: 10, y: 10, width: 60, height: 30, rotation: 0 }, 4 / 3, 210 / 297);
    expect(box.width * 210 / (box.height * 297)).toBeCloseTo(4 / 3, 2);
  });
  it('preserves the opposite edge when resizing and keeps a locked ratio', () => {
    const box = { x: 10, y: 20, width: 40, height: 30, rotation: 0 };
    const moved = resizeBlockoutBox(box, 'nw', -5, -6, 210 / 297, false);
    expect(moved).toEqual({ x: 5, y: 14, width: 45, height: 36, rotation: 0 });
    const locked = resizeBlockoutBox(box, 'se', 10, 8, 210 / 297, true);
    expect(locked.width / locked.height).toBeCloseTo(40 / 30, 2);
  });
  it('preserves expectations and routes page/block clarification in the resolved brief', () => {
    const doc = createBlockoutDocument(); doc.variants[0]!.pages[0]!.expectation = 'Keep 42 kN and the source legend. ```';
    const brief = renderBlockoutBrief(doc);
    expect(brief).toContain('42 kN'); expect(brief).toContain('fixed = preserve this geometry');
    expect(brief).toContain('blockout-block'); expect(brief.match(/```/g)).toHaveLength(2);
  });
});
