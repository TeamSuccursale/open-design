/** Header/footer blocks use normalized coordinates within their own strip. */
export interface RecurringBlockGeometry { x: number; y: number; width: number; height: number; }
export function snapRecurringGeometry(value: RecurringBlockGeometry, enabled: boolean): RecurringBlockGeometry {
  const round = (n: number) => Math.round(n * (enabled ? 40 : 1000)) / (enabled ? 40 : 1000);
  return { x: round(value.x), y: round(value.y), width: Math.max(.025, round(value.width)), height: Math.max(.025, round(value.height)) };
}
export function recurringBlockOutsideSafeArea(block: RecurringBlockGeometry, inset = 0): boolean {
  return block.x < inset - .0001 || block.y < inset - .0001 || block.x + block.width > 1 - inset + .0001 || block.y + block.height > 1 - inset + .0001;
}
export function changeRecurringBlockSize(block: RecurringBlockGeometry, dx: number, dy: number, keepRatio: boolean): RecurringBlockGeometry {
  const width = Math.max(.025, block.width + dx);
  return { ...block, width, height: keepRatio ? Math.max(.025, block.height * width / block.width) : Math.max(.025, block.height + dy) };
}
export function fitRecurringPageWidth(availableWidth: number, availableHeight: number, pageWidthMm: number, pageHeightMm: number, zoom = 1): number {
  return Math.max(1, Math.min(availableWidth, availableHeight * pageWidthMm / pageHeightMm)) * zoom;
}
