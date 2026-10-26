import { describe, expect, it } from 'vitest';
import { BlockoutPageSchema, createBlockoutPage, type BlockoutBlock } from '../src/api/blockout.js';
import { blockoutBounds, blockoutOutsideSafeArea, blockoutSafeArea, snapBlockoutBox } from '../src/api/blockout-geometry.js';

describe('blockout snapping and safe margins', () => {
  it('loads older pages with a 10 mm safe margin and adapts to paper format', () => {
    const old = { ...createBlockoutPage('page', '') } as Partial<ReturnType<typeof createBlockoutPage>>;
    delete old.safeMarginMm;
    const page = BlockoutPageSchema.parse(old);
    expect(page.safeMarginMm).toBe(10);
    expect(blockoutSafeArea(page).left).toBeCloseTo(10 / 210 * 100);
    expect(blockoutSafeArea({ ...page, widthMm: 420 }).left).toBeCloseTo(10 / 420 * 100);
  });
  it('snaps a nearby edge to the safe margin and leaves distant positions free', () => {
    const page = createBlockoutPage('page', '');
    const box = { x: 4, y: 20, width: 20, height: 20, rotation: 0 };
    const snapped = snapBlockoutBox(box, page, 'moving', 'move', 1, 1);
    expect(snapped.box.x).toBeCloseTo(4.76, 2);
    expect(snapped.guides).toContainEqual({ axis: 'x', position: blockoutSafeArea(page).left });
    expect(snapBlockoutBox({ ...box, x: 12, y: 22 }, page, 'moving', 'move', 0.2, 0.2).box).toEqual({ ...box, x: 12, y: 22 });
  });
  it('aligns with another block, respects a constrained axis and snaps resize edges', () => {
    const page = createBlockoutPage('page', '');
    page.blocks = [{ id: 'other', box: { x: 22, y: 24, width: 20, height: 20, rotation: 0 } } as BlockoutBlock];
    const box = { x: 21.5, y: 23.5, width: 13, height: 14, rotation: 0 };
    const moved = snapBlockoutBox(box, page, 'moving', 'move', 1, 1, false, 'x');
    expect(moved.box.x).toBe(22); expect(moved.box.y).toBe(23.5);
    const resized = snapBlockoutBox({ ...box, x: 10, y: 10, width: 31.5, height: 20 }, page, 'moving', 'e', 1, 1);
    expect(resized.box.x).toBe(10); expect(resized.box.width).toBe(32);
  });
  it('detects rotated corners outside the safe area without moving the block', () => {
    const page = createBlockoutPage('page', '');
    const box = { x: 6, y: 6, width: 25, height: 20, rotation: 0 };
    expect(blockoutOutsideSafeArea(box, page)).toBe(false);
    expect(blockoutOutsideSafeArea({ ...box, rotation: 45 }, page)).toBe(true);
    const bounds = blockoutBounds({ ...box, rotation: 90 }, 210 / 297);
    expect(bounds.right - bounds.left).toBeCloseTo(20 * 297 / 210);
  });
  it('preserves locked physical proportions while snapping a resize', () => {
    const page = createBlockoutPage('page', '');
    const box = { x: 10, y: 10, width: 39.5, height: 19.75, rotation: 0 };
    const snapped = snapBlockoutBox(box, page, 'moving', 'se', 1, 1, true);
    expect(snapped.box.width / snapped.box.height).toBeCloseTo(2, 2);
    expect(snapped.box.x).toBe(10); expect(snapped.box.y).toBe(10);
  });
});
