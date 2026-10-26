// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentResearchRun } from '@open-design/contracts';
import { DOCUMENT_PREPARATION_STARTED_EVENT, DocumentResearchStatus } from '../../../src/components/chat/DocumentResearchStatus';
import { DocumentResearchNotReadyError, DocumentResearchUnavailableError, documentResearchRequest } from '../../../src/providers/document-research';
import { I18nProvider } from '../../../src/i18n';
vi.mock('../../../src/components/chat/ProjectCustodianStatus', () => ({ ProjectCustodianStatus: () => null }));

vi.mock('../../../src/providers/document-research', async (importOriginal) => ({ ...await importOriginal<typeof import('../../../src/providers/document-research')>(), documentResearchRequest: vi.fn() }));
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
const timestamp = '2026-10-23T12:00:00Z';
function research(status: DocumentResearchRun['status'] = 'quick'): DocumentResearchRun {
  return {
    version: 1, id: 'research', projectId: 'current', fingerprint: 'a'.repeat(64), status, stage: status === 'quick' ? 'quick' : 'full', model: 'gpt-6.1-sol', scope: 'selected-project-documents',
    sources: [{ id: 'source', title: 'Antro — Disciplinare.pdf', path: 'disciplinare.pdf', root: 'C:/Antro', sha256: 'b'.repeat(64), pagesTotal: 78 }],
    overview: [{ text: 'The tender describes the Antro project.', sourceId: 'source', pages: [1, 2], certainty: 'observed' }], findings: [], workers: [],
    coverage: { sourcesTotal: 1, sourcesAnalyzed: 0, pagesTotal: 78, pagesExtracted: 78, pagesAnalyzed: 0, pagesUnreadable: 0, pendingPages: 78,
      sources: [{ sourceId: 'source', pagesTotal: 78, extractedPages: Array.from({ length: 78 }, (_, i) => i + 1), analyzedPages: [], unreadablePages: [], pendingPages: [1, 2, 3] }], visual: 'not-performed' },
    warnings: ['Visual review not performed.'], createdAt: timestamp, updatedAt: timestamp,
  };
}
const view = (projectId = 'current') => <I18nProvider initial="en"><DocumentResearchStatus projectId={projectId} /></I18nProvider>;
async function flush() { await act(async () => undefined); }

describe('document research in chat', () => {
  it('keeps automatic preparation start and progress collapsed until the user opens the disclosure', async () => {
    vi.mocked(documentResearchRequest).mockResolvedValueOnce(null).mockResolvedValueOnce(research('queued')).mockResolvedValueOnce(research('full')).mockResolvedValue(research('complete'));
    render(view()); await flush();
    const toggle = screen.getByRole('button', { name: 'Document analysis' });
    const details = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    act(() => window.dispatchEvent(new CustomEvent(DOCUMENT_PREPARATION_STARTED_EVENT, { detail: { projectId: 'current' } })));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(details).not.toBeVisible();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByRole('status').textContent).toContain('Selected text analysed');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(details).not.toBeVisible();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(details).toBeVisible();
  });

  it('preserves a manually opened disclosure through automatic start, polling and failure, and a manually closed one through retry', async () => {
    vi.mocked(documentResearchRequest).mockResolvedValueOnce(null).mockResolvedValueOnce(research('queued')).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(research('complete'));
    render(view()); await flush();
    const toggle = screen.getByRole('button', { name: 'Document analysis' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    act(() => window.dispatchEvent(new CustomEvent(DOCUMENT_PREPARATION_STARTED_EVENT, { detail: { projectId: 'current' } })));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await flush();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not turn an explicit start or retry into a request to open findings', async () => {
    vi.mocked(documentResearchRequest).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(research('queued'));
    render(view()); await flush();
    const toggle = screen.getByRole('button', { name: 'Document analysis' });
    fireEvent.click(screen.getByRole('button', { name: 'Start analysis' })); await flush();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await flush();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the quick overview throughout full analysis, cites source physical pages, and stops polling on completion', async () => {
    const first = research(), full = research('full'), complete = research('complete');
    full.coverage.pagesAnalyzed = 12;
    full.findings = [{ text: 'Offer page limit is documented.', sourceId: 'source', pages: [27], certainty: 'inferred' }];
    complete.coverage.pagesAnalyzed = 78; complete.findings = full.findings;
    vi.mocked(documentResearchRequest).mockResolvedValueOnce(first).mockResolvedValueOnce(full).mockResolvedValue(complete);
    render(view()); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Document analysis' }));
    expect(screen.getByText('The tender describes the Antro project.')).toBeTruthy();
    expect(screen.getByText('Antro — Disciplinare.pdf · physical pages 1, 2')).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText('The tender describes the Antro project.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Full text analysis in progress · 12/78 pages analysed');
    expect(screen.getByText('Offer page limit is documented.')).toBeTruthy();
    expect(screen.getByText('Antro — Disciplinare.pdf · physical pages 27 · Inference')).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByRole('status').textContent).toContain('Selected text analysed · 78/78 pages analysed');
    const calls = vi.mocked(documentResearchRequest).mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(documentResearchRequest).toHaveBeenCalledTimes(calls);
  });

  it('starts only on demand and retries a failed start without sending a chat message', async () => {
    vi.mocked(documentResearchRequest).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('No text intake')).mockResolvedValue(research('queued'));
    render(view()); await flush();
    expect(documentResearchRequest).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Start analysis' })); await flush();
    expect(screen.getByRole('alert').textContent).toContain('Analysis could not be started');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await flush();
    expect(vi.mocked(documentResearchRequest).mock.calls.at(-1)?.[2]).toEqual({ retry: false });
    expect(screen.getByText('Quick overview')).toBeTruthy();
  });

  it('keeps partial findings and warnings visible after retry failure', async () => {
    const partial = research('partial');
    partial.coverage.sources[0]!.unreadablePages = [3];
    partial.workers = [{ id: 'failed', roleId: 'facts', sourceId: 'source', phase: 'full', status: 'failed', pageFrom: 3, pageTo: 3, error: 'No text' }];
    vi.mocked(documentResearchRequest).mockResolvedValueOnce(partial).mockRejectedValueOnce(new Error('Offline'));
    render(view()); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Document analysis' }));
    expect(screen.getByText('Visual review not performed.')).toBeTruthy();
    expect(screen.getByText('No readable native text: 3')).toBeTruthy();
    expect(screen.getByText(/1 reading batches failed/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry analysis' })); await flush();
    expect(vi.mocked(documentResearchRequest).mock.calls.at(-1)?.[2]).toEqual({ retry: true });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('The tender describes the Antro project.')).toBeTruthy();
  });

  it('aborts old project reads and ignores late results from the previous project', async () => {
    let finishOld!: (run: DocumentResearchRun) => void;
    vi.mocked(documentResearchRequest).mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; })).mockResolvedValueOnce(null);
    const rendered = render(view('old')); await flush();
    const oldSignal = vi.mocked(documentResearchRequest).mock.calls[0]?.[3];
    rendered.rerender(view('new')); await flush();
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => finishOld(research()));
    fireEvent.click(screen.getByRole('button', { name: 'Document analysis' }));
    expect(screen.queryByText('The tender describes the Antro project.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start analysis' })).toBeTruthy();
  });

  it('keeps host IDs, hashes and absolute paths out of the rendered findings', async () => {
    const run = research('complete');
    run.sources[0]!.id = 'doc-private-id';
    run.overview = [
      { text: 'Useful project facts', sourceId: 'doc-private-id', pages: [1], certainty: 'observed' },
      { text: 'Internal doc-private-id record', sourceId: 'doc-private-id', pages: [1], certainty: 'observed' },
      { text: `SHA256: ${'b'.repeat(64)}`, sourceId: 'doc-private-id', pages: [1], certainty: 'observed' },
      { text: 'Located in C:\\Antro', sourceId: 'doc-private-id', pages: [1], certainty: 'observed' },
    ];
    run.workers = [{ id: 'worker', roleId: 'facts', sourceId: 'doc-private-id', phase: 'full', status: 'failed', pageFrom: 1, pageTo: 1, error: 'C:/Secret/worker.log' }];
    vi.mocked(documentResearchRequest).mockResolvedValue(run);
    const { container } = render(view()); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Document analysis' }));
    expect(screen.getByText('Useful project facts')).toBeTruthy();
    expect(container.textContent).not.toContain('doc-private-id');
    expect(container.textContent).not.toContain('b'.repeat(64));
    expect(container.textContent).not.toContain('C:/Secret');
    expect(container.textContent).not.toContain('C:\\Antro');
  });

  it('quietly hides the optional surface when the daemon has not loaded its endpoint yet', async () => {
    vi.mocked(documentResearchRequest).mockRejectedValue(new DocumentResearchUnavailableError('Not installed'));
    render(view()); await flush();
    expect(screen.queryByTestId('document-research-status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('starts once after the current project Continue event and ignores events for another project', async () => {
    vi.mocked(documentResearchRequest).mockResolvedValueOnce(null).mockResolvedValue(research('queued'));
    render(view()); await flush();
    await act(async () => {
      window.dispatchEvent(new CustomEvent(DOCUMENT_PREPARATION_STARTED_EVENT, { detail: { projectId: 'another' } }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(documentResearchRequest).toHaveBeenCalledOnce();
    act(() => {
      window.dispatchEvent(new CustomEvent(DOCUMENT_PREPARATION_STARTED_EVENT, { detail: { projectId: 'current' } }));
      window.dispatchEvent(new CustomEvent(DOCUMENT_PREPARATION_STARTED_EVENT, { detail: { projectId: 'current' } }));
    });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(documentResearchRequest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(documentResearchRequest).mock.calls[1]?.[2]).toEqual({ retry: false });
    expect(screen.getByText('Quick overview')).toBeTruthy();
    act(() => window.dispatchEvent(new CustomEvent(DOCUMENT_PREPARATION_STARTED_EVENT, { detail: { projectId: 'current' } })));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(documentResearchRequest).toHaveBeenCalledTimes(2);
  });

  it('retains guided preparation across unavailable endpoints and missing text intake without a red failure', async () => {
    vi.mocked(documentResearchRequest).mockRejectedValueOnce(new DocumentResearchUnavailableError('Unavailable'))
      .mockRejectedValueOnce(new DocumentResearchUnavailableError('Unavailable'))
      .mockRejectedValueOnce(new DocumentResearchNotReadyError('Text cache pending'))
      .mockResolvedValue(research('queued'));
    render(view()); await flush();
    act(() => window.dispatchEvent(new CustomEvent(DOCUMENT_PREPARATION_STARTED_EVENT, { detail: { projectId: 'current' } })));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(documentResearchRequest).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(documentResearchRequest).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(4999));
    expect(documentResearchRequest).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(documentResearchRequest).toHaveBeenCalledTimes(4);
    expect(screen.getByText('Quick overview')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cancels pending guided starts on unmount', async () => {
    vi.mocked(documentResearchRequest).mockResolvedValueOnce(null).mockRejectedValue(new DocumentResearchUnavailableError('Unavailable'));
    const rendered = render(view()); await flush();
    act(() => window.dispatchEvent(new CustomEvent(DOCUMENT_PREPARATION_STARTED_EVENT, { detail: { projectId: 'current' } })));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    rendered.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(documentResearchRequest).toHaveBeenCalledTimes(2);
  });
});
