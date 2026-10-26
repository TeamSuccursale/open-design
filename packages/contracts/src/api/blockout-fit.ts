import type { BlockoutBox, BlockoutDocument, BlockoutPage } from './blockout.js';

export type BlockoutFitStatus = 'waiting' | 'blocked' | 'warning' | 'ready';
export interface BlockoutFitIssue { code: string; severity: Exclude<BlockoutFitStatus, 'ready'>; message: string; contentIds: string[] }
export interface BlockoutPhysicalRect { x: number; y: number; width: number; height: number }
export interface BlockoutPhysicalPoint { x: number; y: number }
export interface BlockoutTextMeasurement {
  status: 'measured' | 'unavailable'; fontFamily: string; fontSizePt: number; lineHeight: number;
  resolvedFont?: string; fontHash?: string; engine: string; limitations: string[];
  lines: Array<{ text: string; widthMm: number; inkHeightMm: number }>;
  lineHeightMm: number; heightMm: number; maxWidthMm: number;
}
export interface BlockoutImageMeasurement { status: 'measured' | 'unavailable'; width: number; height: number; limitations: string[] }
export interface BlockoutFitBlock {
  blockId: string; contentIds: string[]; status: BlockoutFitStatus; boxMm: BlockoutPhysicalRect;
  usableWidthMm: number; usableHeightMm: number; usedAreaMm2: number;
  overflowWidthMm: number; overflowHeightMm: number; text?: BlockoutTextMeasurement;
  image?: { widthPx: number; heightPx: number; placedWidthMm: number; placedHeightMm: number; effectiveDpi: number; croppedFraction: number; fit: 'contain' | 'cover' };
  issues: BlockoutFitIssue[];
}
export interface BlockoutFitPage {
  pageId: string; pageNumber: number; status: BlockoutFitStatus; safeAreaMm2: number;
  usedAreaMm2: number; density: number; overlapAreaMm2: number; overflowAreaMm2: number;
  blocks: BlockoutFitBlock[]; issues: BlockoutFitIssue[];
}
export interface BlockoutFitVariant {
  variantId: string; status: BlockoutFitStatus; pages: BlockoutFitPage[];
  boundContentIds: string[]; missingContentIds: string[]; duplicatedContentIds: string[]; unexpectedContentIds: string[];
  issues: BlockoutFitIssue[];
}
export interface BlockoutAlternativePair { leftVariantId: string; rightVariantId: string; sameContent: boolean; meaningful: boolean; differences: string[] }
export interface BlockoutFitAssessment {
  basis?: 'structure' | 'materials';
  version: 1; documentId: string; documentRevision: string; status: BlockoutFitStatus; assessedAt: string;
  materialRevision: string | null; inventoryRevision: string | null; selectedContentIds: string[];
  variants: BlockoutFitVariant[]; excludedVariantIds: string[];
  alternatives: { status: BlockoutFitStatus; distinctCount: number; minimum: number; pairs: BlockoutAlternativePair[]; issues: BlockoutFitIssue[] };
  issues: BlockoutFitIssue[]; limitations: string[];
  policy: { sparseDensity: number; adjacentDensityDifference: number; minimumImageDpi: number };
}
export interface BlockoutFitResponse { assessment: BlockoutFitAssessment }

export function blockoutFitStatus(issues: readonly BlockoutFitIssue[], children: readonly BlockoutFitStatus[] = []): BlockoutFitStatus {
  const states = [...issues.map((issue) => issue.severity), ...children];
  return states.includes('blocked') ? 'blocked' : states.includes('waiting') ? 'waiting' : states.includes('warning') ? 'warning' : 'ready';
}
export function physicalBlockoutBox(page: Pick<BlockoutPage, 'widthMm' | 'heightMm'>, box: BlockoutBox): BlockoutPhysicalRect {
  return { x: box.x * page.widthMm / 100, y: box.y * page.heightMm / 100, width: box.width * page.widthMm / 100, height: box.height * page.heightMm / 100 };
}
export function physicalRectPolygon(rect: BlockoutPhysicalRect, rotation = 0, center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }): BlockoutPhysicalPoint[] {
  const angle = rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]].map(([x = 0, y = 0]) => ({ x: center.x + (x - center.x) * cos - (y - center.y) * sin, y: center.y + (x - center.x) * sin + (y - center.y) * cos }));
}
export function physicalPolygonArea(points: readonly BlockoutPhysicalPoint[]): number {
  return Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]!; return sum + point.x * next.y - next.x * point.y; }, 0)) / 2;
}
/** Sutherland–Hodgman clipping; area and overlap use physical rotated extents. */
export function clipPhysicalPolygon(points: readonly BlockoutPhysicalPoint[], rect: BlockoutPhysicalRect): BlockoutPhysicalPoint[] {
  let result = [...points];
  for (const [axis, edge, greater] of [['x', rect.x, true], ['x', rect.x + rect.width, false], ['y', rect.y, true], ['y', rect.y + rect.height, false]] as const) {
    const input = result; result = [];
    for (let index = 0; index < input.length; index++) {
      const a = input[index]!, b = input[(index + 1) % input.length]!;
      const insideA = greater ? a[axis] >= edge : a[axis] <= edge, insideB = greater ? b[axis] >= edge : b[axis] <= edge;
      if (insideA) result.push(a);
      if (insideA !== insideB) { const t = (edge - a[axis]) / (b[axis] - a[axis]); result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
    }
  }
  return result;
}
/** Exact polygon-union area by vertical slabs split at every edge crossing.
 * Union interval length is linear within each slab; two interior samples integrate it. */
export function physicalPolygonUnionArea(polygons: readonly (readonly BlockoutPhysicalPoint[])[], minimumCoverage = 1): number {
  const shapes = polygons.filter((polygon) => polygon.length >= 3);
  const edges = shapes.flatMap((polygon) => polygon.map((a, index) => ({ a, b: polygon[(index + 1) % polygon.length]! })));
  const xs = edges.flatMap(({ a, b }) => [a.x, b.x]);
  const axisAligned = edges.every(({ a, b }) => Math.abs(a.x - b.x) < 1e-9 || Math.abs(a.y - b.y) < 1e-9);
  if (!axisAligned) for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const e = edges[i]!, f = edges[j]!, dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, ex = f.b.x - f.a.x, ey = f.b.y - f.a.y;
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < 1e-10) continue;
    const t = ((f.a.x - e.a.x) * ey - (f.a.y - e.a.y) * ex) / denominator;
    const u = ((f.a.x - e.a.x) * dy - (f.a.y - e.a.y) * dx) / denominator;
    if (t > 0 && t < 1 && u > 0 && u < 1) xs.push(e.a.x + t * dx);
  }
  const cuts = [...new Set(xs)].sort((a, b) => a - b);
  function length(x: number) {
    const intervals: Array<[number, number]> = [];
    for (const polygon of shapes) {
      const ys: number[] = [];
      for (let index = 0; index < polygon.length; index++) { const a = polygon[index]!, b = polygon[(index + 1) % polygon.length]!; if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) ys.push(a.y + (x - a.x) * (b.y - a.y) / (b.x - a.x)); }
      ys.sort((a, b) => a - b); for (let i = 0; i + 1 < ys.length; i += 2) intervals.push([ys[i]!, ys[i + 1]!]);
    }
    const events = intervals.flatMap(([from, to]) => [{ y: from, delta: 1 }, { y: to, delta: -1 }]).sort((a, b) => a.y - b.y);
    let total = 0, coverage = 0, last = events[0]?.y ?? 0;
    for (const event of events) { if (coverage >= minimumCoverage) total += event.y - last; coverage += event.delta; last = event.y; }
    return total;
  }
  let area = 0;
  for (let index = 0; index + 1 < cuts.length; index++) { const a = cuts[index]!, width = cuts[index + 1]! - a; area += width * (length(a + width * 0.25) + length(a + width * 0.75)) / 2; }
  return area;
}

interface ContentPlacement { page: number; group: string; order: number; x: number; y: number; size: number }
/** Ignores names, colours and uniform margin nudges; compares relationships. */
export function compareBlockoutAlternatives(document: BlockoutDocument, variantIds: readonly string[]): BlockoutAlternativePair[] {
  const placements = new Map<string, Map<string, ContentPlacement>>();
  for (const variant of document.variants.filter((variant) => variantIds.includes(variant.id))) {
    const items = new Map<string, ContentPlacement>(); let order = 0;
    variant.pages.forEach((page, pageIndex) => {
      const blocks = [...page.blocks].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
      for (const block of blocks) for (const contentId of block.contentIds ?? []) items.set(contentId, { page: pageIndex, group: [...(block.contentIds ?? [])].sort().join('|'), order: order++, x: (block.box.x + block.box.width / 2) / 100, y: (block.box.y + block.box.height / 2) / 100, size: block.typography?.fontSizePt ?? 0 });
    }); placements.set(variant.id, items);
  }
  const pairs: BlockoutAlternativePair[] = [];
  for (let i = 0; i < variantIds.length; i++) for (let j = i + 1; j < variantIds.length; j++) {
    const leftVariantId = variantIds[i]!, rightVariantId = variantIds[j]!, a = placements.get(leftVariantId)!, b = placements.get(rightVariantId)!;
    const ids = [...a.keys()].sort(), sameContent = ids.join('|') === [...b.keys()].sort().join('|'), differences: string[] = [];
    if (sameContent) {
      if (ids.some((id) => a.get(id)!.page !== b.get(id)!.page || a.get(id)!.group !== b.get(id)!.group)) differences.push('content-grouping');
      const axis = (x: ContentPlacement, y: ContentPlacement) => x.page !== y.page ? 'pages' : Math.abs(x.x - y.x) > Math.max(0.1, Math.abs(x.y - y.y) * 1.5) ? 'horizontal' : Math.abs(x.y - y.y) > Math.max(0.1, Math.abs(x.x - y.x) * 1.5) ? 'vertical' : 'shared';
      for (let k = 0; k < ids.length; k++) for (let l = k + 1; l < ids.length; l++) {
        const x = ids[k]!, y = ids[l]!;
        const axp = a.get(x)!, ayp = a.get(y)!, bxp = b.get(x)!, byp = b.get(y)!;
        const relationshipChange = Math.hypot((axp.x - ayp.x) - (bxp.x - byp.x), (axp.y - ayp.y) - (bxp.y - byp.y));
        const readingOrder = (first: ContentPlacement, second: ContentPlacement) => first.page !== second.page ? Math.sign(first.page - second.page) : Math.abs(first.y - second.y) >= 0.12 ? Math.sign(first.y - second.y) : Math.abs(first.x - second.x) >= 0.12 ? Math.sign(first.x - second.x) : 0;
        const reversedParagraphs = axp.group === ayp.group && bxp.group === byp.group && (axp.order - ayp.order) * (bxp.order - byp.order) < 0;
        if ((reversedParagraphs || (relationshipChange >= 0.15 && readingOrder(axp, ayp) * readingOrder(bxp, byp) < 0)) && !differences.includes('reading-order')) differences.push('reading-order');
        if (relationshipChange >= 0.15 && axis(axp, ayp) !== axis(bxp, byp) && !differences.includes('reading-axis')) differences.push('reading-axis');
        const ax = a.get(x)!.size, ay = a.get(y)!.size, bx = b.get(x)!.size, by = b.get(y)!.size;
        if (ax > 0 && ay > 0 && bx > 0 && by > 0 && Math.abs(Math.log((ax / ay) / (bx / by))) > Math.log(1.2) && !differences.includes('typographic-hierarchy')) differences.push('typographic-hierarchy');
      }
    }
    pairs.push({ leftVariantId, rightVariantId, sameContent, meaningful: sameContent && differences.length > 0, differences });
  }
  return pairs;
}
