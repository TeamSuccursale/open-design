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
/** Printed length of a strip: across is the page width, down is the strip height, both in millimetres. */
export interface RecurringStripSize { widthMm: number; heightMm: number; }
const fourPlaces = (n: number) => Math.round(n * 10000) / 10000;
/** Keeps a block inside its strip, shrinking it only where it is larger than the strip. */
export function clampRecurringGeometry(value: RecurringBlockGeometry): RecurringBlockGeometry {
  const width = Math.min(1, Math.max(.025, value.width)), height = Math.min(1, Math.max(.025, value.height));
  return { x: fourPlaces(Math.min(1 - width, Math.max(0, value.x))), y: fourPlaces(Math.min(1 - height, Math.max(0, value.y))), width: fourPlaces(width), height: fourPlaces(height) };
}
/**
 * The place a block takes in the same strip of another page format. A block spanning at least half the
 * strip keeps its share of it; any other keeps its printed size and stays centred or at its distance from
 * the nearer end. Vertically it keeps its printed height around the same relative centre. Locked logos
 * shrink as a whole when they would not fit, and the result always lies inside the target strip.
 */
export function equivalentRecurringGeometry(block: RecurringBlockGeometry & { lockedRatio?: boolean }, from: RecurringStripSize, to: RecurringStripSize): RecurringBlockGeometry {
  if (!(from.widthMm > 0 && from.heightMm > 0 && to.widthMm > 0 && to.heightMm > 0)) return clampRecurringGeometry(block);
  const fit = block.lockedRatio ? Math.min(1, to.widthMm / (block.width * from.widthMm), to.heightMm / (block.height * from.heightMm)) : 1;
  const height = block.height * from.heightMm * fit / to.heightMm, y = block.y + block.height / 2 - height / 2;
  if (!block.lockedRatio && block.width >= .5) return clampRecurringGeometry({ x: block.x, y, width: block.width, height });
  const width = block.width * from.widthMm * fit / to.widthMm, before = block.x * from.widthMm, after = (1 - block.x - block.width) * from.widthMm;
  const x = Math.abs(block.x + block.width / 2 - .5) < .01 ? .5 - width / 2 : before <= after ? before / to.widthMm : 1 - after / to.widthMm - width;
  return clampRecurringGeometry({ x, y, width, height });
}
/**
 * Where a new block of the preferred width goes across its strip: inside the widest stretch that no block
 * crosses at the band's height, a little clear of its neighbours. Null when no stretch has room for it.
 */
export function freeRecurringPlacement(blocks: readonly RecurringBlockGeometry[], band: { y: number; height: number }, preferredWidth: number): { x: number; width: number } | null {
  const taken = blocks.filter((block) => block.y < band.y + band.height && block.y + block.height > band.y)
    .map((block) => [Math.max(0, block.x), Math.min(1, block.x + block.width)] as const).filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  let widest = { start: 0, end: 0 }, cursor = 0;
  for (const [start, end] of [...taken, [1, 1] as const]) { if (start - cursor > widest.end - widest.start) widest = { start: cursor, end: start }; cursor = Math.max(cursor, end); }
  const length = widest.end - widest.start, inset = Math.min(.02, length / 10), width = Math.min(preferredWidth, length - 2 * inset);
  return width < .025 ? null : { x: fourPlaces(widest.start + inset), width: fourPlaces(width) };
}
/** Width of a page at print scale: CSS defines 96 px per inch, so one millimetre of paper is one CSS millimetre. */
export function printRecurringPageWidth(pageWidthMm: number): number {
  return pageWidthMm * 96 / 25.4;
}

export function fitRecurringPageWidth(availableWidth: number, availableHeight: number, pageWidthMm: number, pageHeightMm: number, zoom = 1): number {
  return Math.max(1, Math.min(availableWidth, availableHeight * pageWidthMm / pageHeightMm)) * zoom;
}
