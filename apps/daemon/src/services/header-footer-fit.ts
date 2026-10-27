import { HEADER_FOOTER_FIELDS, fillHeaderFooterText, type HeaderFooterField, type HeaderFooterVariant } from '@open-design/contracts';

// A text block measures its placeholders at the widest value they usually take, so «Pagina {pageNumber} di
// {totalPages}» is checked in a draft before any document gives it real numbers.
const WIDEST_COUNTERS: Partial<Record<HeaderFooterField, string>> = { pageNumber: '999', totalPages: '999', date: '00/00/0000', revision: '99' };

/** The same conservative text fit check for literal drafts and resolved document fields. */
export function headerFooterTextOverflow(variants: HeaderFooterVariant[], fields: Partial<Record<HeaderFooterField, string>> = {}, regions = { header: true, footer: true }): { value: string; variantName: string } | null {
  const known = { ...WIDEST_COUNTERS, ...fields };
  for (const variant of variants) for (const block of variant.blocks) {
    if (!regions[block.region] || block.kind !== 'text' && block.kind !== 'field') continue;
    const text = block.text ?? '';
    const value = block.kind === 'field' ? fields[block.field ?? 'documentName']
      : HEADER_FOOTER_FIELDS.some((field) => known[field] === undefined && text.includes(`{${field}}`)) ? undefined : fillHeaderFooterText(text, known);
    if (value === undefined) continue; // Document-local fields are checked once their context is known.
    const lines = value.split(/\r?\n/), fontMm = (block.fontSize ?? 9) * 25.4 / 72;
    const regionMm = block.region === 'header' ? variant.headerHeightMm : variant.footerHeightMm;
    const lineWidth = Math.max(...lines.map((line) => [...line].reduce((width, char) => width + (/[ilI1.,:; ]/.test(char) ? .3 : /[WM@]/.test(char) ? .9 : .55), 0))) * fontMm;
    if (lines.length > 12 || lines.length * fontMm * 1.25 > block.height * regionMm + .5 || lineWidth > block.width * variant.pageWidthMm * 1.1) return { value, variantName: variant.name };
  }
  return null;
}
