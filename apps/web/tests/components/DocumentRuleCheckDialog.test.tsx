// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessDocumentRules, createBlockoutPage, type DocumentLayoutMeasurement, type DocumentRuleCheck } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { DocumentRuleCheckDialog } from '../../src/components/DocumentRuleCheckDialog';
import { checkDocumentRules } from '../../src/runtime/document-rule-check';

vi.mock('../../src/runtime/document-rule-check', () => ({ checkDocumentRules: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

// The run 2 plates: one detail photo sits 10.6 mm past the Blockout's 24 mm safe margin.
const measurement: DocumentLayoutMeasurement = { documentId: 'tavole', unreadStylesheets: 0, pages: [{ index: 1, widthMm: 420, heightMm: 297, blockoutPageId: 'page-1',
  fonts: [{ pt: 11, family: 'Arial', chars: 120, text: 'Tavola', recurring: false }],
  margins: { right: { mm: 13.4, kind: 'box', blockId: 'detail-2', text: 'Fotografia 2' }, left: { mm: 24, kind: 'text', text: 'Tavola' } } }] };
const plate = Object.assign(createBlockoutPage('page-1', 'Tavola 1'), { widthMm: 420, heightMm: 297, safeMarginMm: 24, blocks: [{ id: 'detail-2', label: 'Dettaglio inferiore', kind: 'image' as const,
  box: { x: 72, y: 58, width: 22, height: 18, rotation: 0 }, images: [], references: [], lockRatio: false, expectation: '', feedback: '', flexibility: 'guided' as const }] });
const check: DocumentRuleCheck = assessDocumentRules({
  fileName: 'documents/tavole/tavole.html', measurement, blockoutPages: [plate],
  constraints: [{ id: 'limit', kind: 'page-limit', value: 'Tavole: massimo 4 pagine A3. Disciplinare p. 37, tabella 9.', status: 'confirmed', sourceIds: ['source-37'] }],
  sources: [{ id: 'source-37', path: 'Disciplinare - estratto.pdf', page: 1 }],
});
const open = (onExport = vi.fn()) => render(<I18nProvider initial="it">
  <DocumentRuleCheckDialog projectId="p" fileName="documents/tavole/tavole.html" onExport={onExport} onClose={vi.fn()} />
</I18nProvider>);

describe('the rule check before a PDF export', () => {
  it('lets the engineer export while the pages are still being measured', async () => {
    vi.mocked(checkDocumentRules).mockReturnValue(new Promise(() => {}));
    const onExport = vi.fn();
    open(onExport);
    expect(screen.getByText('Misuro le pagine nel browser…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Esporta PDF' }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('shows each row against its rule, quoted with the file and page it came from', async () => {
    vi.mocked(checkDocumentRules).mockResolvedValue({ ok: true, check });
    await act(async () => { open(); });
    expect(checkDocumentRules).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p', fileName: 'documents/tavole/tavole.html' }));
    const pages = screen.getByRole('listitem', { name: 'Pagine' });
    expect(pages.textContent).toContain('1 su 4 ammesse');
    expect(pages.textContent).toContain('«Tavole: massimo 4 pagine A3. Disciplinare p. 37, tabella 9.»');
    expect(pages.textContent).toContain('Disciplinare - estratto.pdf, p. 1');
    const margins = screen.getByRole('listitem', { name: 'Margini' });
    expect(margins.textContent).toContain('Da verificare');
    expect(margins.textContent).toContain('pagina 1, a destra: 13,4 mm, minimo 24 mm · Dettaglio inferiore');
    expect(margins.textContent).toContain('Margine di sicurezza del Blockout');
    expect(screen.getByRole('listitem', { name: 'Orientamento' }).textContent).toContain('Nessuna regola nei vincoli del documento');
    expect(screen.getByText('Da verificare: Margini. Gli avvisi non fermano l’esportazione.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Esporta PDF' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('names a finding tied to no block and no text by what it is', async () => {
    const unlabeled = assessDocumentRules({ fileName: 'a.html', sources: [],
      measurement: { documentId: null, unreadStylesheets: 0, pages: [{ index: 1, widthMm: 210, heightMm: 297, fonts: [], margins: { bottom: { mm: 8, kind: 'image', text: '' } } }] },
      constraints: [{ id: 'm', kind: 'margins', value: 'Margini di 20 mm', status: 'confirmed', sourceIds: [] }] });
    vi.mocked(checkDocumentRules).mockResolvedValue({ ok: true, check: unlabeled });
    await act(async () => { open(); });
    expect(screen.getByRole('listitem', { name: 'Margini' }).textContent).toContain('pagina 1, in basso: 8 mm, minimo 20 mm · immagine');
  });

  it('says in the engineer’s language why the check could not run, never the daemon’s technical text, and still exports', async () => {
    vi.mocked(checkDocumentRules).mockResolvedValue({ ok: false, reason: 'no-browser', detail: 'no Chrome or Edge on this PC to measure the document with' });
    const onExport = vi.fn();
    await act(async () => { open(onExport); });
    expect(screen.getByRole('alert').textContent).toBe('Su questo PC non c’è Chrome o Edge con cui misurare le pagine. Puoi esportare comunque.');
    cleanup();
    vi.mocked(checkDocumentRules).mockResolvedValue({ ok: false, reason: 'failed', detail: 'the browser did not finish measuring within 60 s' });
    await act(async () => { open(onExport); });
    expect(screen.getByRole('alert').textContent).toBe('Il controllo non è riuscito. Puoi ricontrollare o esportare comunque.');
    fireEvent.click(screen.getByRole('button', { name: 'Esporta PDF' }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
