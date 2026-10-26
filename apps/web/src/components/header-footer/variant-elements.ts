import type { HeaderFooterBlock, HeaderFooterVariant } from '@open-design/contracts';
import { equivalentRecurringGeometry, type RecurringStripSize } from './geometry';

export function recurringStripSize(variant: HeaderFooterVariant, region: HeaderFooterBlock['region']): RecurringStripSize {
  return { widthMm: variant.pageWidthMm, heightMm: region === 'header' ? variant.headerHeightMm : variant.footerHeightMm };
}
/**
 * Whether two blocks show the same element of a strip: the same dynamic field, the same logo, a separator,
 * or the same text, which a copy keeps recognising by its id after the wording changes.
 */
export function sameRecurringElement(a: HeaderFooterBlock, b: HeaderFooterBlock): boolean {
  if (a.region !== b.region || a.kind !== b.kind) return false;
  if (a.kind === 'field') return a.field === b.field;
  if (a.kind === 'logo') return a.assetId === b.assetId;
  if (a.kind === 'text') return a.id === b.id || (a.text ?? '').trim() === (b.text ?? '').trim();
  return true;
}
/**
 * The other formats that already show the element and those that lack it. Only formats already composed
 * and with room for the element's strip count: a format still to compose is adapted as a whole instead.
 */
export function recurringElementFormats(variants: readonly HeaderFooterVariant[], from: HeaderFooterVariant, block: HeaderFooterBlock) {
  const others = variants.filter((variant) => variant.id !== from.id && variant.blocks.length > 0 && recurringStripSize(variant, block.region).heightMm > 0);
  const shows = (variant: HeaderFooterVariant) => variant.blocks.some((candidate) => sameRecurringElement(block, candidate));
  return { present: others.filter(shows), lacking: others.filter((variant) => !shows(variant)) };
}
/** A copy of the block for another format at the equivalent place in its strip; it keeps its id unless that format already uses it. */
export function copyRecurringElement(block: HeaderFooterBlock, from: HeaderFooterVariant, to: HeaderFooterVariant): HeaderFooterBlock {
  const id = to.blocks.some((candidate) => candidate.id === block.id) ? `block-${crypto.randomUUID()}` : block.id;
  return { ...structuredClone(block), id, ...equivalentRecurringGeometry(block, recurringStripSize(from, block.region), recurringStripSize(to, block.region)) };
}
/** A field for a new block: the first the page does not show yet, else the first its strip does not show. */
export function unusedRecurringField<Field extends NonNullable<HeaderFooterBlock['field']>>(fields: readonly Field[], variant: HeaderFooterVariant, region: HeaderFooterBlock['region']): Field {
  const shown = (blocks: readonly HeaderFooterBlock[]) => new Set(blocks.flatMap((block) => block.kind === 'field' && block.field ? [block.field] : []));
  const page = shown(variant.blocks), strip = shown(variant.blocks.filter((block) => block.region === region));
  return fields.find((field) => !page.has(field)) ?? fields.find((field) => !strip.has(field)) ?? fields[0]!;
}
