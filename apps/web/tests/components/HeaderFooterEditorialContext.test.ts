import { describe, expect, it } from 'vitest';
import { createDocumentPresentation, HeaderFooterDraftSchema } from '@open-design/contracts';
import { recurringBrief, recurringPreviewPages } from '../../src/components/header-footer/editorial-context';
describe('confirmed recurring document context', () => {
  it('previews the actual unnumbered cover followed by report numbers 1–7', () => {
    const presentation = { ...createDocumentPresentation('Relazione'), cover: true, pageNumbers: true, numberOnCover: false, coverCountsInNumbering: false };
    const pages = recurringPreviewPages(presentation, 8, true);
    expect(pages.map((page) => page.visibleNumber)).toEqual([null, 1, 2, 3, 4, 5, 6, 7]); expect(pages[0]!.isCover).toBe(true);
    expect(recurringBrief(presentation, 'Antro', 8, true)).toEqual(expect.arrayContaining(['Progetto: Antro', 'Documento: Relazione', 'Pagine: 8', 'La copertina non fa avanzare la numerazione']));
  });
  it('previews all four no-cover booklet numbers and never invents a missing total', () => {
    const presentation = { ...createDocumentPresentation('Fascicolo'), cover: false, pageNumbers: true };
    expect(recurringPreviewPages(presentation, 4, false).map((page) => page.visibleNumber)).toEqual([1, 2, 3, 4]);
    expect(recurringBrief(presentation, undefined, undefined, false).some((line) => line.startsWith('Pages:'))).toBe(false);
  });
  it('persists an explicit optional-logo decision through the shared draft parser', () => {
    const draft = { version: 1, name: 'Design', guidance: '', stage: 'structural', variants: [{ id: 'a4', name: 'A4', pageWidthMm: 210, pageHeightMm: 297, headerHeightMm: 20, footerHeightMm: 20, blocks: [] }] };
    for (const logoPlan of ['provided', 'later', 'none']) expect(HeaderFooterDraftSchema.parse({ ...draft, logoPlan }).logoPlan).toBe(logoPlan);
    expect(HeaderFooterDraftSchema.safeParse({ ...draft, logoPlan: 'unknown' }).success).toBe(false);
  });
});
