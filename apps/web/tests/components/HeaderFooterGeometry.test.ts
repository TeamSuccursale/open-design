import { describe, expect, it } from 'vitest';
import { changeRecurringBlockSize, equivalentRecurringGeometry, fitRecurringPageWidth, freeRecurringPlacement, recurringBlockOutsideSafeArea, snapRecurringGeometry } from '../../src/components/header-footer/geometry';
const a4Footer = { widthMm: 210, heightMm: 20 }, a3Footer = { widthMm: 420, heightMm: 20 };
describe('recurring elements across page formats', () => {
  it('keeps a block spanning most of the strip at its share of the page', () => {
    expect(equivalentRecurringGeometry({ x: .1, y: .2, width: .8, height: .025 }, a4Footer, a3Footer)).toEqual({ x: .1, y: .2, width: .8, height: .025 });
  });
  it('keeps a centred block centred at its printed width', () => {
    expect(equivalentRecurringGeometry({ x: .4, y: .2, width: .2, height: .5 }, a4Footer, a3Footer)).toEqual({ x: .45, y: .2, width: .1, height: .5 });
  });
  it('keeps a block near the left end at its distance from that end', () => {
    expect(equivalentRecurringGeometry({ x: .05, y: .2, width: .2, height: .5 }, a4Footer, a3Footer)).toEqual({ x: .025, y: .2, width: .1, height: .5 });
  });
  it('shrinks a locked logo as a whole when the target strip is shorter', () => {
    const copy = equivalentRecurringGeometry({ x: .05, y: .1, width: .2, height: .8, lockedRatio: true }, { widthMm: 210, heightMm: 30 }, a4Footer);
    expect(copy.height).toBe(1); expect(copy.width).toBeCloseTo(.2 * 20 / 24); expect(recurringBlockOutsideSafeArea(copy)).toBe(false);
  });
});
describe('a new block in a crowded strip', () => {
  it('ignores a separator above the band it is placed in', () => {
    expect(freeRecurringPlacement([{ x: .1, y: .05, width: .8, height: .025 }], { y: .2, height: .5 }, .55)).toEqual({ x: .02, width: .55 });
  });
  it('reports a strip with no room left', () => {
    expect(freeRecurringPlacement([{ x: 0, y: .2, width: .6, height: .5 }, { x: .59, y: .2, width: .41, height: .5 }], { y: .2, height: .5 }, .55)).toBeNull();
  });
});
describe('recurring strip transforms', () => {
  it('fits the entire portrait page, including its footer, inside a short viewport', () => {
    const availableHeight = 216 - 56;
    const width = fitRecurringPageWidth(700, availableHeight, 210, 297);
    expect(width).toBeLessThan(150);
    expect(width * 297 / 210).toBeCloseTo(availableHeight);
    expect(width).toBeLessThanOrEqual(700);
  });
  it('fits a landscape page to narrow available width and preserves explicit inspection zoom', () => {
    const fit = fitRecurringPageWidth(180, 300, 420, 297);
    expect(fit).toBe(180);
    expect(fit * 297 / 420).toBeLessThanOrEqual(300);
    expect(fitRecurringPageWidth(180, 300, 420, 297, 2)).toBe(fit * 2);
  });
  it('keeps logo proportions and allows crossing the border to remain visible as a warning', () => {
    const original = { x: .7, y: .2, width: .2, height: .4 };
    const resized = changeRecurringBlockSize(original, .2, .05, true);
    expect(resized.height).toBeCloseTo(.8); expect(recurringBlockOutsideSafeArea(resized)).toBe(true);
  });
  it('snaps only when requested and keeps a minimum usable block size', () => {
    const original = { x: .131, y: .169, width: .003, height: .002 };
    expect(snapRecurringGeometry(original, true)).toEqual({ x: .125, y: .175, width: .025, height: .025 });
    expect(snapRecurringGeometry(original, false).x).toBe(.131);
  });
});
