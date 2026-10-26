import { describe, expect, it } from 'vitest';
import { BlockoutDocumentSchema, blockoutReferenceTiles, createBlockoutDocument } from '../src/api/blockout.js';
import { blockoutHandoffSnapshot } from '../src/api/blockout-handoff.js';
describe('rough image reference tiles', () => {
  it.each([.4, .707, 1, 1.414, 3])('fills contained non-overlapping slots for mixed ratios in a %s block', (aspect) => {
    const images = [{ width: 1600, height: 400 }, { width: 300, height: 1200 }, { width: 600, height: 600 }];
    const tiles = blockoutReferenceTiles(images, aspect); expect(tiles).toHaveLength(3);
    expect(tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0)).toBeCloseTo(10000);
    tiles.forEach((tile, index) => {
      expect(tile.x).toBeGreaterThanOrEqual(0); expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.width).toBeLessThanOrEqual(100.00001); expect(tile.y + tile.height).toBeLessThanOrEqual(100.00001);
      tiles.slice(index + 1).forEach((other) => expect(Math.max(0, Math.min(tile.x + tile.width, other.x + other.width) - Math.max(tile.x, other.x)) * Math.max(0, Math.min(tile.y + tile.height, other.y + other.height) - Math.max(tile.y, other.y))).toBeCloseTo(0));
    });
  });
  it('stacks wide references in a portrait block and places them side by side in a wide block', () => {
    const images = [{ width: 1800, height: 600 }, { width: 1800, height: 600 }];
    const portrait = blockoutReferenceTiles(images, .7), landscape = blockoutReferenceTiles(images, 6);
    expect(portrait[0]!.width).toBe(100); expect(portrait[1]!.y).toBeGreaterThan(0);
    expect(landscape[0]!.height).toBe(100); expect(landscape[1]!.x).toBeGreaterThan(0);
  });
  it('keeps explicit preview intent and exact asset metadata in the parsed layout and handoff', () => {
    const doc = createBlockoutDocument(); doc.variants[0]!.pages[0]!.blocks.push({ id: 'figure', label: '', kind: 'image', box: { x: 10, y: 10, width: 40, height: 30, rotation: 0 }, lockRatio: false, images: [], expectation: '', feedback: '', flexibility: 'guided', references: [], referencePreview: true });
    expect(BlockoutDocumentSchema.parse(doc).variants[0]!.pages[0]!.blocks[0]!.referencePreview).toBe(true);
    expect(blockoutHandoffSnapshot(doc).variant.pages[0]!.blocks[0]!.referencePreview).toBe(true);
    expect(blockoutReferenceTiles([], 1)).toEqual([]);
  });
});
