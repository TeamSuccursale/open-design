import type { HeaderFooterBlock, HeaderFooterVariant } from '@open-design/contracts';

export interface HeaderFooterFormatDiff {
  name: string; widthMm: number; heightMm: number;
  selectedHeaderMm: number | null; currentHeaderMm: number | null;
  selectedFooterMm: number | null; currentFooterMm: number | null;
  addedBlocks: number; removedBlocks: number; changedBlocks: number;
  changedBlockDetails: { id: string; kind: HeaderFooterBlock['kind']; region: HeaderFooterBlock['region']; changes: { property: string; selected: string; current: string }[] }[];
}
const formatKey = (variant: HeaderFooterVariant) => `${variant.pageWidthMm}x${variant.pageHeightMm}`;
const blockValue = (block: HeaderFooterBlock) => JSON.stringify(Object.fromEntries(Object.entries(block).sort(([left], [right]) => left.localeCompare(right))));
function propertyValue(property: string, value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'number' && ['x', 'y', 'width', 'height'].includes(property)) return `${Number((value * 100).toFixed(2))}%`;
  if (typeof value === 'string') return value.length > 100 ? `${value.slice(0, 100)}…` : value;
  return String(value);
}

/** Direction is selected historical revision → current published revision. */
export function compareHeaderFooterFormats(selected: readonly HeaderFooterVariant[], current: readonly HeaderFooterVariant[]): HeaderFooterFormatDiff[] {
  const before = new Map(selected.map((variant) => [formatKey(variant), variant])), after = new Map(current.map((variant) => [formatKey(variant), variant]));
  return [...new Set([...before.keys(), ...after.keys()])].map((key) => {
    const left = before.get(key), right = after.get(key), geometry = right ?? left!;
    const oldBlocks = new Map((left?.blocks ?? []).map((block) => [block.id, block])), newBlocks = new Map((right?.blocks ?? []).map((block) => [block.id, block]));
    const changed = [...newBlocks.entries()].filter(([id, block]) => oldBlocks.has(id) && blockValue(oldBlocks.get(id)!) !== blockValue(block));
    const changedBlockDetails = changed.map(([id, block]) => {
      const old = oldBlocks.get(id)!;
      const leftValues = old as unknown as Record<string, unknown>, rightValues = block as unknown as Record<string, unknown>;
      return { id, kind: block.kind, region: block.region, changes: [...new Set([...Object.keys(old), ...Object.keys(block)])].filter((property) => leftValues[property] !== rightValues[property]).map((property) => ({ property, selected: propertyValue(property, leftValues[property]), current: propertyValue(property, rightValues[property]) })) };
    });
    return { name: geometry.name, widthMm: geometry.pageWidthMm, heightMm: geometry.pageHeightMm,
      selectedHeaderMm: left?.headerHeightMm ?? null, currentHeaderMm: right?.headerHeightMm ?? null,
      selectedFooterMm: left?.footerHeightMm ?? null, currentFooterMm: right?.footerHeightMm ?? null,
      addedBlocks: [...newBlocks.keys()].filter((id) => !oldBlocks.has(id)).length,
      removedBlocks: [...oldBlocks.keys()].filter((id) => !newBlocks.has(id)).length,
      changedBlocks: changed.length, changedBlockDetails };
  });
}
