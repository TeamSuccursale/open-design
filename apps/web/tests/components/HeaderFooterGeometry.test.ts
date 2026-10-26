import { describe, expect, it } from 'vitest';
import { changeRecurringBlockSize, fitRecurringPageWidth, recurringBlockOutsideSafeArea, snapRecurringGeometry } from '../../src/components/header-footer/geometry';
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
