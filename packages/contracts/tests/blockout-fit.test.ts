import { describe, expect, it } from 'vitest';
import { clipPhysicalPolygon, compareBlockoutAlternatives, createBlockoutDocument, createBlockoutPage, physicalPolygonUnionArea, physicalRectPolygon } from '../src/index.js';

describe('physical Blockout geometry', () => {
  it('uses the union of measured extents, not the sum of block areas', () => {
    const a = physicalRectPolygon({ x: 0, y: 0, width: 10, height: 10 }), b = physicalRectPolygon({ x: 5, y: 0, width: 10, height: 10 });
    expect(physicalPolygonUnionArea([a, b])).toBeCloseTo(150, 8);
    expect(physicalPolygonUnionArea([a, b], 2)).toBeCloseTo(50, 8);
    expect(physicalPolygonUnionArea([a, a, a], 2)).toBeCloseTo(100, 8);
  });
  it('clips rotated extents at the safe area and preserves exact overlapping union', () => {
    const rotated = physicalRectPolygon({ x: 0, y: 0, width: 10, height: 10 }, 45);
    expect(physicalPolygonUnionArea([rotated, rotated])).toBeCloseTo(100, 8);
    const clipped = clipPhysicalPolygon(rotated, { x: 0, y: 0, width: 10, height: 10 });
    expect(physicalPolygonUnionArea([clipped])).toBeCloseTo(82.842712, 5);
  });
});

describe('meaningful alternatives use the same actual material', () => {
  const block = (id: string, ids: string[], x: number, y: number, size = 11) => ({ id, label: id, kind: 'text' as const, contentIds: ids, typography: { fontFamily: 'Arial', fontSizePt: size, lineHeight: 1.5 }, box: { x, y, width: 30, height: 30, rotation: 0 }, lockRatio: false, images: [], references: [], expectation: '', feedback: '', flexibility: 'guided' as const });
  const document = () => {
    const doc = createBlockoutDocument(); doc.activeVariantId = 'a';
    doc.variants = [{ id: 'a', label: 'A', pages: [{ ...createBlockoutPage('a-page', 'Page'), blocks: [block('one', ['text'], 10, 10), block('two', ['image'], 10, 55)] }] }];
    return doc;
  };
  it('rejects renamed or uniformly nudged duplicate layouts', () => {
    const doc = document(), b = structuredClone(doc.variants[0]!); b.id = 'b'; b.label = 'A new visual story';
    b.pages[0]!.blocks.forEach((block) => { block.id += '-renamed'; block.label = 'Different colour'; block.box.x += 2; block.box.y += 2; }); doc.variants.push(b);
    expect(compareBlockoutAlternatives(doc, ['a', 'b'])[0]).toMatchObject({ sameContent: true, meaningful: false, differences: [] });
  });
  it('recognizes changed reading axis and grouping while rejecting different inventory allocations', () => {
    const doc = document(), b = structuredClone(doc.variants[0]!); b.id = 'b';
    b.pages[0]!.blocks[1]!.box = { x: 55, y: 10, width: 30, height: 30, rotation: 0 }; doc.variants.push(b);
    expect(compareBlockoutAlternatives(doc, ['a', 'b'])[0]).toMatchObject({ sameContent: true, meaningful: true, differences: ['reading-axis'] });
    b.pages[0]!.blocks[1]!.contentIds = ['another-image'];
    expect(compareBlockoutAlternatives(doc, ['a', 'b'])[0]).toMatchObject({ sameContent: false, meaningful: false });
  });
  it('does not mistake a tiny baseline nudge within one row for a different reading order', () => {
    const doc = document(); doc.variants[0]!.pages[0]!.blocks[1]!.box = { x: 55, y: 10, width: 30, height: 30, rotation: 0 };
    const b = structuredClone(doc.variants[0]!); b.id = 'b'; b.pages[0]!.blocks[0]!.box.y += 1; doc.variants.push(b);
    expect(compareBlockoutAlternatives(doc, ['a', 'b'])[0]).toMatchObject({ sameContent: true, meaningful: false });
  });
});
