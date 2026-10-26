import type { HeaderFooterVariant } from '@open-design/contracts';

/** The same conservative text fit check for literal drafts and resolved document fields. */
export function headerFooterTextOverflow(variants: HeaderFooterVariant[], fields: Partial<Record<'projectName' | 'documentName' | 'pageNumber' | 'totalPages' | 'date' | 'revision', string>> = {}, regions = { header: true, footer: true }): { value: string; variantName: string } | null {
  for (const variant of variants) for (const block of variant.blocks) {
    if (!regions[block.region] || block.kind !== 'text' && block.kind !== 'field') continue;
    const value = block.kind === 'field' ? fields[block.field ?? 'documentName'] : block.text ?? '';
    if (value === undefined) continue; // Document-local fields are checked once their context is known.
    const lines = value.split(/\r?\n/), fontMm = (block.fontSize ?? 9) * 25.4 / 72;
    const regionMm = block.region === 'header' ? variant.headerHeightMm : variant.footerHeightMm;
    const lineWidth = Math.max(...lines.map((line) => [...line].reduce((width, char) => width + (/[ilI1.,:; ]/.test(char) ? .3 : /[WM@]/.test(char) ? .9 : .55), 0))) * fontMm;
    if (lines.length > 12 || lines.length * fontMm * 1.25 > block.height * regionMm + .5 || lineWidth > block.width * variant.pageWidthMm * 1.1) return { value, variantName: variant.name };
  }
  return null;
}
