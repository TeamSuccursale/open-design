import { constrainBlockoutBox, resizeBlockoutBox, type BlockoutBlock, type BlockoutBox, type BlockoutPage } from './blockout.js';

type Bounds = { left: number; top: number; right: number; bottom: number };
type Band = { top: number; bottom: number };
export type BlockoutGuide = { axis: 'x' | 'y'; position: number };

/** Percent bounds of the physically rotated rectangle, including non-square paper. */
export function blockoutBounds(box: BlockoutBox, pageAspect: number): Bounds {
  const angle = box.rotation * Math.PI / 180, cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  const rx = cos * box.width / 2 + sin * box.height / (2 * pageAspect);
  const ry = sin * box.width * pageAspect / 2 + cos * box.height / 2;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  return { left: cx - rx, top: cy - ry, right: cx + rx, bottom: cy + ry };
}

export function blockoutSafeArea(page: Pick<BlockoutPage, 'widthMm' | 'heightMm' | 'safeMarginMm' | 'reservedHeaderMm' | 'reservedFooterMm'>): Bounds & { marginMm: number } {
  const marginMm = Math.min(page.safeMarginMm ?? 10, page.widthMm * 0.45, page.heightMm * 0.45);
  const x = marginMm / page.widthMm * 100, y = marginMm / page.heightMm * 100;
  const top = Math.min(49, Math.max(y, ((page.reservedHeaderMm ?? 0) + marginMm) / page.heightMm * 100));
  const bottom = Math.max(51, Math.min(100 - y, 100 - ((page.reservedFooterMm ?? 0) + marginMm) / page.heightMm * 100));
  return { left: x, top, right: 100 - x, bottom, marginMm };
}

export function blockoutOutsideSafeArea(box: BlockoutBox, page: Pick<BlockoutPage, 'widthMm' | 'heightMm' | 'safeMarginMm' | 'reservedHeaderMm' | 'reservedFooterMm'>): boolean {
  const bounds = blockoutBounds(box, page.widthMm / page.heightMm), safe = blockoutSafeArea(page);
  // Stored coordinates have two decimal places; rounding at a guide is not overflow.
  return bounds.left < safe.left - 0.015 || bounds.top < safe.top - 0.015 || bounds.right > safe.right + 0.015 || bounds.bottom > safe.bottom + 0.015;
}

/** What a run-authored save moved so a page's body stays out of the applied header/footer reserve. Bands are % of page height. */
export interface BlockoutReserveAdjustment { variantId: string; pageId: string; blockIds: string[]; from: Band; to: Band }
/** A body that would have to shrink further is recomposed by its author, not squeezed by the host. */
export const BLOCKOUT_RESERVE_MIN_SCALE = 0.75;
export type BlockoutReserveFit =
  | { status: 'clear' }
  | { status: 'fitted'; blocks: BlockoutBlock[]; blockIds: string[]; from: Band; to: Band }
  | { status: 'refused'; free: Band };

/**
 * Pull a page's body out of the band its reserved header and footer occupy.
 * The edge that crosses moves to the free band, the opposite edge stays where
 * it is, and every non-background block between them scales vertically with
 * it, so order, gaps and proportions hold. Backgrounds may sit under the
 * reserve. A body that needs more than a modest squeeze, or a rotated block
 * whose corner still crosses, is refused: that page needs recomposing.
 */
export function fitBlockoutPageToReserve(page: BlockoutPage): BlockoutReserveFit {
  const aspect = page.widthMm / page.heightMm, safe = blockoutSafeArea(page), free = { top: safe.top, bottom: safe.bottom };
  const header = (page.reservedHeaderMm ?? 0) > 0, footer = (page.reservedFooterMm ?? 0) > 0;
  const entersReserve = (block: BlockoutBlock) => {
    if (block.designRole === 'background') return false;
    const bounds = blockoutBounds(block.box, aspect);
    return (header && bounds.top < safe.top - 0.015) || (footer && bounds.bottom > safe.bottom + 0.015);
  };
  if (!page.blocks.some(entersReserve)) return { status: 'clear' };
  const body = page.blocks.filter((block) => block.designRole !== 'background').map((block) => blockoutBounds(block.box, aspect));
  const from = { top: Math.min(...body.map((bounds) => bounds.top)), bottom: Math.max(...body.map((bounds) => bounds.bottom)) };
  const to = { top: header ? Math.max(from.top, safe.top) : from.top, bottom: footer ? Math.min(from.bottom, safe.bottom) : from.bottom };
  const scale = (to.bottom - to.top) / (from.bottom - from.top);
  if (!(scale >= BLOCKOUT_RESERVE_MIN_SCALE)) return { status: 'refused', free };
  // Stored coordinates keep two decimals: round each edge inward so rounding never re-enters the reserve.
  const at = (value: number) => to.top + (value - from.top) * scale;
  const inward = (value: number, up: boolean) => (up ? Math.ceil(value * 100 - 1e-6) : Math.floor(value * 100 + 1e-6)) / 100;
  const blocks = page.blocks.map((block) => {
    if (block.designRole === 'background') return block;
    const top = inward(at(block.box.y), true), bottom = inward(at(block.box.y + block.box.height), false);
    return { ...block, box: { ...block.box, y: top, height: Math.max(1, Math.round((bottom - top) * 100) / 100) } };
  });
  if (blocks.some(entersReserve)) return { status: 'refused', free };
  return { status: 'fitted', blocks, blockIds: page.blocks.filter((block) => block.designRole !== 'background').map((block) => block.id), from, to };
}

function nearest(anchors: number[], targets: number[], threshold: number) {
  let result: { delta: number; target: number } | undefined;
  for (const anchor of anchors) for (const target of targets) {
    const delta = target - anchor;
    if (Math.abs(delta) <= threshold && (!result || Math.abs(delta) < Math.abs(result.delta))) result = { delta, target };
  }
  return result;
}

/** Thresholds are converted from screen pixels by the canvas, so zoom does not change the feel. */
export function snapBlockoutBox(box: BlockoutBox, page: BlockoutPage, movingId: string, mode: string, thresholdX: number, thresholdY: number, lockRatio = false, axis?: 'x' | 'y') {
  const aspect = page.widthMm / page.heightMm, safe = blockoutSafeArea(page), bounds = blockoutBounds(box, aspect);
  const targetsX = [safe.left, safe.right, 50, 0, 100], targetsY = [safe.top, safe.bottom, 50, 0, 100];
  for (const other of page.blocks) {
    if (other.id === movingId) continue;
    const b = blockoutBounds(other.box, aspect);
    targetsX.push(b.left, (b.left + b.right) / 2, b.right);
    targetsY.push(b.top, (b.top + b.bottom) / 2, b.bottom);
  }
  const anchorsX = mode === 'move' ? [bounds.left, (bounds.left + bounds.right) / 2, bounds.right] : mode.includes('w') ? [bounds.left] : mode.includes('e') ? [bounds.right] : [];
  const anchorsY = mode === 'move' ? [bounds.top, (bounds.top + bounds.bottom) / 2, bounds.bottom] : mode.includes('n') ? [bounds.top] : mode.includes('s') ? [bounds.bottom] : [];
  // Rotated moves align their physical bounds; rotated resize keeps its opposite edge stable.
  if (mode !== 'move' && box.rotation !== 0) return { box, guides: [] as BlockoutGuide[] };
  const x = axis === 'y' ? undefined : nearest(anchorsX, targetsX, thresholdX);
  const y = axis === 'x' ? undefined : nearest(anchorsY, targetsY, thresholdY);
  let next = box;
  if (mode === 'move') next = constrainBlockoutBox({ ...box, x: box.x + (x?.delta ?? 0), y: box.y + (y?.delta ?? 0) });
  else {
    let dx = x?.delta ?? 0, dy = y?.delta ?? 0;
    if (lockRatio && x && y && mode.length === 2) {
      if (Math.abs(y.delta / thresholdY) < Math.abs(x.delta / thresholdX)) dx = dy * box.width / box.height * (mode.includes('w') ? -1 : 1) * (mode.includes('n') ? -1 : 1);
      else dy = 0;
    } else if (lockRatio && y && !x && mode.length === 2) dx = dy * box.width / box.height * (mode.includes('w') ? -1 : 1) * (mode.includes('n') ? -1 : 1);
    next = resizeBlockoutBox(box, mode, dx, dy, aspect, lockRatio);
  }
  const aligned = blockoutBounds(next, aspect), guides: BlockoutGuide[] = [];
  if (x && [aligned.left, (aligned.left + aligned.right) / 2, aligned.right].some((value) => Math.abs(value - x.target) < 0.02)) guides.push({ axis: 'x', position: x.target });
  if (y && [aligned.top, (aligned.top + aligned.bottom) / 2, aligned.bottom].some((value) => Math.abs(value - y.target) < 0.02)) guides.push({ axis: 'y', position: y.target });
  return { box: next, guides };
}
