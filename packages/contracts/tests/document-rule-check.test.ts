import { describe, expect, it } from 'vitest';
import { createBlockoutPage, type BlockoutPage } from '../src/api/blockout.js';
import { createDocumentPresentation } from '../src/api/document-presentation.js';
import type { DocumentContextSource, DocumentLayoutConstraint } from '../src/api/document-setup.js';
import {
  DOCUMENT_LAYOUT_MEASURE_SCRIPT, DocumentRuleCheckSchema, assessDocumentRules, parseDocumentRule,
  type DocumentLayoutMeasurement,
} from '../src/api/document-rule-check.js';

// The tender rules are the engineer-confirmed sentences of the setup, so the check reads them as written in run 2 and run 3.
describe('reading a tender rule', () => {
  it('finds the page cap, the paper, the orientation and the type size in the sentences the setup saved', () => {
    expect(parseDocumentRule('page-limit', 'Relazione tecnica — componente descrittiva del criterio B: massimo 8 pagine A4 di contenuto, incluse tabelle; Disciplinare Antro, p.37, tabella 9, riga B.')).toEqual({ maxPages: 8 });
    expect(parseDocumentRule('page-limit', 'Fascicolo grafico B — elaborato grafico B: massimo 4 pagine A3. Disciplinare Antro p. stampata 37, tabella 9.')).toEqual({ maxPages: 4 });
    expect(parseDocumentRule('paper', 'Fascicolo grafico B: formato A3. La relativa cella della tabella 9 non prescrive carattere, corpo o interlinea.')).toEqual({ paper: { name: 'A3', widthMm: 297, heightMm: 420 } });
    expect(parseDocumentRule('orientation', 'Fascicolo grafico B: orizzontale (420 × 297 mm), scelta grafica dimostrativa.')).toEqual({ orientation: 'landscape' });
    expect(parseDocumentRule('typography', 'Relazione tecnica: Arial, corpo 11, interlinea 1,5.')).toEqual({ minPt: 11, family: 'Arial' });
    expect(parseDocumentRule('typography', 'Font size not below 10 pt')).toEqual({ minPt: 10 });
  });
  it('reads margins as one value or side by side, in millimetres or centimetres', () => {
    expect(parseDocumentRule('margins', 'Margini di 2 cm su tutti i lati')).toEqual({ margins: { left: 20, right: 20, top: 20, bottom: 20 } });
    expect(parseDocumentRule('margins', 'Margine superiore 3 cm, inferiore 2 cm, laterali 2,5 cm')).toEqual({ margins: { left: 25, right: 25, top: 30, bottom: 20 } });
  });
  it('reads nothing it cannot be sure of', () => {
    expect(parseDocumentRule('page-limit', 'Il numero di pagine sarà concordato con il RUP')).toEqual({});
    expect(parseDocumentRule('paper', 'Formato A4 per la relazione, A3 per le tavole')).toEqual({});
    expect(parseDocumentRule('orientation', 'Verticale o orizzontale a scelta')).toEqual({});
  });
});

const sources: DocumentContextSource[] = [
  { id: 'source-p37', path: 'Disciplinare Antro - estratto pagine 37-38.pdf', root: 'C:\\gara', page: 1, title: 'Disciplinare', excerpt: '', readable: true, role: 'rules' },
];
const rule = (kind: DocumentLayoutConstraint['kind'], value: string): DocumentLayoutConstraint => ({ id: `rule-${kind}`, kind, value, status: 'confirmed', sourceIds: ['source-p37'] });
const fonts = (pt = 11) => [{ pt, family: 'Arial', chars: 300, text: 'Testo', recurring: false }];
const plate = (index: number, right = 24): DocumentLayoutMeasurement['pages'][number] => ({
  index, widthMm: 420, heightMm: 297, blockoutPageId: `page-${index}`, fonts: fonts(),
  margins: { left: { mm: 24, kind: 'text', text: 'B.1' }, right: { mm: right, kind: 'box', blockId: 'detail-2', text: 'Fotografia 2 Segnaposto' },
    top: { mm: 47.7, kind: 'text', text: 'B.1' }, bottom: { mm: 61, kind: 'box', text: 'Didascalia' } },
});
const blockoutPage = (index: number): BlockoutPage => ({ ...createBlockoutPage(`page-${index}`, `Tavola ${index}`), widthMm: 420, heightMm: 297, safeMarginMm: 24, reservedHeaderMm: 24, reservedFooterMm: 24,
  blocks: [{ id: 'detail-2', label: 'Dettaglio inferiore', kind: 'image', box: { x: 72, y: 58, width: 22, height: 18, rotation: 0 }, images: [], references: [], lockRatio: false, expectation: '', feedback: '', flexibility: 'guided' }] });

describe('checking a designed document against its rules', () => {
  // Run 2's A3 plate 1: «Fotografia 2» ends 13.4 mm from the right edge, inside the 24 mm Blockout margin.
  it('flags run 2 plate 1 against the Blockout margin and cites each tender rule with its file and page', () => {
    const check = assessDocumentRules({
      fileName: 'documents/fascicolo-grafico-b/index.html',
      measurement: { documentId: 'fascicolo-grafico-b', unreadStylesheets: 0, pages: [plate(1, 13.4), plate(2), plate(3), plate(4)] },
      constraints: [rule('page-limit', 'massimo 4 pagine A3. Disciplinare Antro p. 37, tabella 9.'), rule('paper', 'Fascicolo grafico B: A3.'), rule('orientation', 'Fascicolo grafico B: orizzontale.')],
      sources, blockoutPages: [1, 2, 3, 4].map(blockoutPage),
    });
    expect(DocumentRuleCheckSchema.parse(check)).toEqual(check);
    const rows = Object.fromEntries(check.rows.map((row) => [row.kind, row]));
    expect(rows.pages).toMatchObject({ status: 'ok', expected: { maxPages: 4 }, measured: { total: 4, counted: 4 }, rule: { origin: 'tender', sources: [{ path: 'Disciplinare Antro - estratto pagine 37-38.pdf', page: 1 }] } });
    expect(rows.paper).toMatchObject({ status: 'ok', expected: { name: 'A3' } });
    expect(rows.orientation).toMatchObject({ status: 'ok', expected: 'landscape' });
    expect(rows.font).toMatchObject({ status: 'unchecked', rule: null, measured: { smallest: { pt: 11, page: 1 } } });
    expect(rows.margins).toMatchObject({ status: 'warning', rule: { origin: 'blockout' },
      findings: [{ page: 1, side: 'right', mm: 13.4, expectedMm: 24, blockId: 'detail-2', label: 'Dettaglio inferiore' }] });
    expect(check.status).toBe('warning');
  });
  it('warns about a page over the cap, a smaller type size and another family, and leaves a cover kept out of the count', () => {
    const page = (index: number): DocumentLayoutMeasurement['pages'][number] => ({ index, widthMm: 210, heightMm: 297, fonts: fonts(), margins: {} });
    const nine = { documentId: 'document-1', unreadStylesheets: 0, pages: Array.from({ length: 9 }, (_, index) => page(index + 1)) };
    nine.pages[2]!.fonts = [{ pt: 9, family: 'Bahnschrift', chars: 40, text: 'Didascalia della figura', blockId: 'caption', recurring: false }, ...fonts()];
    const constraints = [rule('page-limit', 'massimo 8 pagine A4 di contenuto. Copertine escluse.'), rule('typography', 'Arial, corpo 11, interlinea 1,5'), rule('margins', 'margini di 2 cm')];
    const over = assessDocumentRules({ fileName: 'relazione.html', measurement: nine, constraints, sources });
    const rows = Object.fromEntries(over.rows.map((row) => [row.kind, row]));
    expect(rows.pages).toMatchObject({ status: 'warning', expected: { maxPages: 8 }, measured: { total: 9, counted: 9 } });
    expect(rows.font).toMatchObject({ status: 'warning', expected: { minPt: 11, family: 'Arial' },
      findings: [{ page: 3, pt: 9, family: 'Bahnschrift', issue: 'size', text: 'Didascalia della figura' }, { page: 3, pt: 9, family: 'Bahnschrift', issue: 'family' }] });
    expect(rows.margins).toMatchObject({ status: 'ok', rule: { origin: 'tender', text: 'margini di 2 cm' }, expected: { left: 20, right: 20, top: 20, bottom: 20 } });
    const presentation = { ...createDocumentPresentation('Relazione'), cover: true, coverCountsTowardPageLimit: false };
    const withCover = assessDocumentRules({ fileName: 'relazione.html', measurement: nine, constraints, sources, presentation });
    expect(withCover.rows.find((row) => row.kind === 'pages')).toMatchObject({ status: 'ok', measured: { total: 9, counted: 8, covers: 1 } });
  });
  it('shows what it measured even when the setup has no rules', () => {
    const check = assessDocumentRules({ fileName: 'x.html', measurement: { documentId: null, unreadStylesheets: 0, pages: [plate(1)] }, constraints: [], sources: [] });
    expect(check.rows.map((row) => row.status)).toEqual(['unchecked', 'unchecked', 'unchecked', 'unchecked', 'unchecked']);
    expect(check.status).toBe('unchecked');
  });
});

describe('the measuring script', () => {
  it('is a self-contained script the browser can run', () => {
    expect(() => new Function(DOCUMENT_LAYOUT_MEASURE_SCRIPT)).not.toThrow();
    expect(DOCUMENT_LAYOUT_MEASURE_SCRIPT).toContain('md-layout-measure');
  });
});
