// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentOverviewReading } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { BlockoutBackgroundRead } from '../../src/components/blockout/BlockoutBackgroundRead';
import { fetchDocumentOverviewReading } from '../../src/providers/document-overview-reading';

vi.mock('../../src/providers/document-overview-reading', () => ({ fetchDocumentOverviewReading: vi.fn() }));
const fetchReading = vi.mocked(fetchDocumentOverviewReading);
function reading(status: DocumentOverviewReading['status']): DocumentOverviewReading {
  return { version: 1, id: 'read-1', status, fingerprint: 'context-1', model: 'gpt-6-luna', sourceScope: 'saved-quick-scan-excerpts',
    message: 'Saved context only', coverage: 'Two saved excerpts; source documents were not read in full.', sources: [],
    workers: status === 'not-ready' ? [] : [{ id: 'rules', status: status === 'complete' ? 'complete' : status === 'failed' ? 'failed' : status === 'queued' ? 'queued' : 'reading', sourceIds: [] }],
    warnings: [], createdAt: '2026-10-23T12:00:00Z', updatedAt: '2026-10-23T12:00:00Z' };
}
const view = (projectId = 'project') => <I18nProvider initial="en"><BlockoutBackgroundRead projectId={projectId} /></I18nProvider>;
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
beforeEach(() => { vi.useFakeTimers(); fetchReading.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('nonblocking Blockout background read', () => {
  it('starts automatically, polls actual status at the boundary and stops on completion while edits remain usable', async () => {
    fetchReading.mockResolvedValueOnce(reading('queued')).mockResolvedValueOnce(reading('reading')).mockResolvedValue(reading('complete'));
    render(<><textarea aria-label="Page brief" />{view()}</>); await settle();
    expect(fetchReading).toHaveBeenCalledExactlyOnceWith('project', undefined, { retry: false }, expect.any(AbortSignal));
    expect(screen.getByText(/Preparing a quick read/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Page brief' }), { target: { value: 'Keep this page image-led.' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
    expect(fetchReading).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchReading).toHaveBeenLastCalledWith('project', undefined, undefined, expect.any(AbortSignal));
    expect(screen.getByText(/The agent is reading the document rules/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText('Context read complete')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Read context again' })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchReading).toHaveBeenCalledTimes(3);
    expect((screen.getByRole('textbox', { name: 'Page brief' }) as HTMLTextAreaElement).value).toBe('Keep this page image-led.');
    expect(document.querySelector('.icon-spin')).toBeNull();
  });

  it('keeps not-ready context settled and offers a deliberate retry rather than an endless spinner', async () => {
    fetchReading.mockResolvedValue(reading('not-ready'));
    render(view()); await settle();
    expect(screen.getByText('Confirm the project context first to enable a background read.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Read context again' })).toBeTruthy();
    expect(document.querySelector('.icon-spin')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchReading).toHaveBeenCalledTimes(1);
  });

  it('settles a missing background job into a recoverable state instead of showing an endless spinner', async () => {
    fetchReading.mockResolvedValue(null);
    render(view()); await settle();
    expect(document.querySelector('.icon-spin')).toBeNull();
    expect(screen.getByRole('button', { name: 'Read context again' })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchReading).toHaveBeenCalledTimes(1);
  });

  it('shows connection failure and retries explicitly through the start operation', async () => {
    fetchReading.mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue(reading('complete'));
    render(view()); await settle();
    expect(screen.getByText('Context read failed. Your blockout edits are safe.')).toBeTruthy();
    expect(document.querySelector('.icon-spin')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Read context again' })); await settle();
    expect(fetchReading).toHaveBeenLastCalledWith('project', undefined, { retry: true }, expect.any(AbortSignal));
    expect(screen.getByText('Context read complete')).toBeTruthy();
  });

  it('shows partial results with source citations and coverage without replacing the confirmed brief', async () => {
    const partial = reading('partial');
    partial.sources = [{ id: 'rules-1', root: 'C:/selected', path: 'disciplinare.pdf', title: 'Disciplinare', page: 8, role: 'rules', excerpt: 'Maximum four pages.', readable: true }];
    partial.workers = [{ id: 'rules', status: 'complete', sourceIds: ['rules-1'], result: {
      summary: 'Four-page maximum found in the saved excerpt.',
      notes: [{ text: 'Cover counting requires confirmation.', sourceIds: ['rules-1'], certainty: 'documented' }], questions: ['Does the cover count?'],
    } }, { id: 'material', status: 'failed', sourceIds: [], error: 'Material excerpt unavailable' }];
    partial.warnings = ['This read covers excerpts only.'];
    fetchReading.mockResolvedValue(partial);
    render(<><textarea aria-label="Confirmed brief" defaultValue="Four counted pages" />{view()}</>); await settle();
    expect(screen.getByText('Some context could not be read')).toBeTruthy();
    fireEvent.click(screen.getByText('Findings and gaps'));
    expect(screen.getByText('Two saved excerpts; source documents were not read in full.')).toBeTruthy();
    expect(screen.getByText('Cover counting requires confirmation.')).toBeTruthy();
    expect(screen.getByText(/Disciplinare, p. 8/)).toBeTruthy();
    expect(screen.getByText('Material excerpt unavailable')).toBeTruthy();
    expect(screen.getByText(/Your confirmed brief and document rules remain authoritative/)).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Confirmed brief' }) as HTMLTextAreaElement).value).toBe('Four counted pages');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchReading).toHaveBeenCalledTimes(1);
  });

  it('does not restart for parent renders and aborts polling when the overview closes', async () => {
    fetchReading.mockResolvedValue(reading('reading'));
    const rendered = render(view()); await settle();
    rendered.rerender(view()); await settle();
    expect(fetchReading).toHaveBeenCalledTimes(1);
    const signal = fetchReading.mock.calls[0]![3]!;
    rendered.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchReading).toHaveBeenCalledTimes(1);
  });
});
