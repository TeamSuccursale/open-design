import { describe, expect, it } from 'vitest';
import { createDocumentPresentation, DocumentPresentationSchema, documentPresentationPageState, documentPresentationPrintedTotal } from '../src/api/document-presentation.js';
import { BlockoutDocumentSchema, createBlockoutDocument, renderBlockoutBrief } from '../src/api/blockout.js';
import { blockoutHandoffSnapshot } from '../src/api/blockout-handoff.js';

const confirmed = () => DocumentPresentationSchema.parse({ name: 'Relazione B', status: 'confirmed', header: true, footer: false, cover: true, pageNumbers: true, numberOnCover: false, coverCountsTowardPageLimit: false, coverCountsInNumbering: true });
describe('per-document editorial presentation', () => {
  it('leaves unanswered choices unknown and refuses to confirm them', () => {
    const draft = createDocumentPresentation('Relazione B');
    expect(draft).toMatchObject({ status: 'draft', header: null, footer: null, cover: null, pageNumbers: null });
    expect(DocumentPresentationSchema.safeParse({ ...draft, status: 'confirmed' }).success).toBe(false);
    expect(DocumentPresentationSchema.safeParse({ ...draft, status: 'confirmed', header: false, footer: false, cover: false, pageNumbers: false }).success).toBe(true);
  });
  it('requires separate cover count and numbering choices and catches contradictory visible numbering', () => {
    expect(DocumentPresentationSchema.safeParse({ ...confirmed(), coverCountsTowardPageLimit: null }).success).toBe(false);
    expect(DocumentPresentationSchema.safeParse({ ...confirmed(), coverCountsInNumbering: null }).success).toBe(false);
    expect(DocumentPresentationSchema.safeParse({ ...confirmed(), numberOnCover: true, coverCountsInNumbering: false }).success).toBe(false);
  });
  it('advances a hidden cover number independently from excluding it from the page allowance', () => {
    expect(documentPresentationPageState(confirmed(), { index: 0 })).toMatchObject({ isCover: true, countsTowardPageLimit: false, sequenceNumber: 1, visibleNumber: null });
    expect(documentPresentationPageState(confirmed(), { index: 1 })).toMatchObject({ sequenceNumber: 2, visibleNumber: 2 });
    expect(documentPresentationPageState({ ...confirmed(), coverCountsInNumbering: false }, { index: 1 })).toMatchObject({ sequenceNumber: 1, visibleNumber: 1 });
    expect(documentPresentationPageState(createDocumentPresentation(), { index: 0 })).toMatchObject({ header: null, footer: null, visibleNumber: null });
  });
  it('prints the total that the last numbered page shows, so it never reads "7 di 8"', () => {
    // Flow run 27 Oct 2026: 8 A4 pages, cover excluded from the sequence; the footer read "Pagina 7 di 8" on the last page.
    expect(documentPresentationPrintedTotal({ ...confirmed(), coverCountsInNumbering: false }, 8)).toBe(7);
    expect(documentPresentationPrintedTotal(confirmed(), 8)).toBe(8);
    expect(documentPresentationPrintedTotal({ ...confirmed(), cover: false, coverCountsInNumbering: null, coverCountsTowardPageLimit: null, numberOnCover: null }, 4)).toBe(4);
    expect(documentPresentationPrintedTotal(createDocumentPresentation(), 3)).toBe(3);
    expect(documentPresentationPrintedTotal(undefined, 5)).toBe(5);
  });
  it('carries confirmed presentation into a saved blockout, readable brief and feedback snapshot', () => {
    const document = BlockoutDocumentSchema.parse({ ...createBlockoutDocument(), presentation: confirmed() });
    expect(blockoutHandoffSnapshot(document).presentation).toEqual(confirmed());
    expect(renderBlockoutBrief(document)).toContain('coverCountsInNumbering');
  });
});
