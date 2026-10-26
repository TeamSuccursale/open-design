// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectCustodianStatus } from '../../../src/components/chat/ProjectCustodianStatus';
import { I18nProvider } from '../../../src/i18n';
import { askProjectCustodian, ProjectCustodiansUnavailableError, pulseProjectCustodians, readCustodianHistory, readProjectCustodians } from '../../../src/providers/project-custodians';
import { OPEN_PROJECT_GALLERY_EVENT } from '../../../src/providers/project-intake';

vi.mock('../../../src/providers/project-custodians', async (original) => ({ ...await original<typeof import('../../../src/providers/project-custodians')>(),
  askProjectCustodian: vi.fn(), pulseProjectCustodians: vi.fn(), readCustodianHistory: vi.fn(), readProjectCustodians: vi.fn(),
}));
const indexing = { indexing: true, phase: 'images' as const, queuedChanges: ['private-source'], pendingDomains: ['images' as const], message: 'C:/Secret/internal' };
function snapshot(consent = true) {
  return { ledger: { version: 1 as const, snapshotRevision: 'a'.repeat(64), textStatus: 'complete', imagesStatus: 'indexed', imageConsent: consent,
    gaps: ['Review cell values visually.'], sources: [{ sourceId: 'private-source', title: 'Antro.pdf', path: 'C:/Secret/Antro.pdf', sha256: 'b'.repeat(64), pagesTotal: 78, textAnalyzedPages: [1, 2, 3], visualIndexedPages: [1, 2], assetIds: ['private-asset'], status: 'current' as const }] }, indexing };
}
const view = (projectId = 'current') => <I18nProvider initial="en"><ProjectCustodianStatus projectId={projectId} /></I18nProvider>;
const flush = async () => { await act(async () => undefined); };
beforeEach(() => {
  vi.useFakeTimers(); Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.mocked(readProjectCustodians).mockResolvedValue(snapshot()); vi.mocked(pulseProjectCustodians).mockResolvedValue(indexing);
  vi.mocked(readCustodianHistory).mockResolvedValue({ events: [{ seq: 1, at: '2026-10-23T12:00:00Z', parentRevision: null, revision: 'c'.repeat(64), domain: 'project', type: 'sources-changed', summary: 'One new PDF found.' }], revision: 'c'.repeat(64), verified: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

describe('project custodian status', () => {
  it('shows a compact indexing state and source order, coverage and diary only when opened', async () => {
    const { container } = render(view()); await flush();
    expect(screen.getByRole('status').textContent).toContain('Analysing pages and crops… · 1 sources waiting');
    expect(readCustodianHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Project custodians' })); await flush();
    expect(screen.getByText('Antro.pdf')).toBeTruthy(); expect(screen.getByText('Text 3/78 pages · visual intake 2/78 pages')).toBeTruthy();
    expect(screen.getByText('One new PDF found.')).toBeTruthy();
    expect(container.textContent).not.toContain('C:/Secret'); expect(container.textContent).not.toContain('private-source'); expect(container.textContent).not.toContain('b'.repeat(64));
  });
  it('renews the active lease at 30 seconds, stops when hidden, and resumes on focus without duplicate pulses', async () => {
    render(view()); await flush(); expect(pulseProjectCustodians).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(29_999)); expect(pulseProjectCustodians).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(pulseProjectCustodians).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); fireEvent(document, new Event('visibilitychange'));
    await act(async () => vi.advanceTimersByTimeAsync(120_000)); expect(pulseProjectCustodians).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false }); fireEvent(window, new Event('focus')); await flush();
    expect(pulseProjectCustodians).toHaveBeenCalledTimes(3);
    fireEvent(window, new Event('focus')); await flush(); expect(pulseProjectCustodians).toHaveBeenCalledTimes(3);
  });
  it('does not activate indexing in a hidden page and quietly retries an old daemon with bounded backoff', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    vi.mocked(readProjectCustodians).mockRejectedValue(new ProjectCustodiansUnavailableError('Not yet loaded'));
    render(view()); await flush(); expect(readProjectCustodians).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false }); fireEvent(document, new Event('visibilitychange')); await flush();
    expect(screen.queryByTestId('project-custodian-status')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(59_999)); expect(readProjectCustodians).toHaveBeenCalledTimes(1);
    vi.mocked(readProjectCustodians).mockResolvedValue(snapshot());
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(screen.getByTestId('project-custodian-status')).toBeTruthy();
  });
  it('shows an initial status failure without leaking its details, and recovers on the next automatic check', async () => {
    vi.mocked(readProjectCustodians).mockRejectedValueOnce(new Error('Read failed at C:/Secret/internal.json')).mockResolvedValue(snapshot());
    const { container } = render(view()); await flush();
    expect(screen.getByTestId('project-custodian-status')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Project custodians could not be loaded. Checks will retry automatically.');
    expect(container.textContent).not.toContain('C:/Secret'); expect(pulseProjectCustodians).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(screen.queryByText('Project custodians could not be loaded. Checks will retry automatically.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Project custodians' })).toBeTruthy();
    expect(pulseProjectCustodians).toHaveBeenCalledOnce();
  });
  it('cancels a previous project request and never shows its late evidence', async () => {
    let resolveOld!: (value: ReturnType<typeof snapshot>) => void;
    vi.mocked(readProjectCustodians).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { rerender } = render(view('old')); await flush(); const signal = vi.mocked(readProjectCustodians).mock.calls[0]?.[2];
    rerender(view('new')); await flush(); expect(signal?.aborted).toBe(true);
    const old = snapshot(); old.ledger.sources[0]!.title = 'Old secret source'; await act(async () => resolveOld(old));
    fireEvent.click(screen.getByRole('button', { name: 'Project custodians' })); await flush();
    expect(screen.queryByText('Old secret source')).toBeNull(); expect(screen.getByText('Antro.pdf')).toBeTruthy();
  });
  it('consults the chosen custodian, shows source-page citations and offers the actual gallery for returned assets', async () => {
    vi.mocked(askProjectCustodian).mockResolvedValue({ domain: 'images', answer: 'A keymap is available.', citations: [{ sourceId: 'private-source', title: 'Antro.pdf', page: 6, assetId: 'private-asset' }], assetIds: ['private-asset'], gaps: [], snapshotRevision: 'revision', receiptId: 'receipt' });
    const gallery = vi.fn(); window.addEventListener(OPEN_PROJECT_GALLERY_EVENT, gallery);
    render(view()); await flush(); fireEvent.click(screen.getByRole('button', { name: 'Project custodians' })); await flush();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'images' } }); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Find a keymap' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' })); await flush();
    expect(vi.mocked(askProjectCustodian).mock.calls[0]?.[1]).toEqual({ domain: 'images', question: 'Find a keymap', limit: 6 });
    expect(screen.getByText('A keymap is available.')).toBeTruthy(); expect(screen.getByText('Antro.pdf · physical page 6')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open image gallery' })); expect(gallery).toHaveBeenCalledOnce();
    window.removeEventListener(OPEN_PROJECT_GALLERY_EVENT, gallery);
  });
  it('keeps image consultation gated by persisted consent and retains a failed text question for retry', async () => {
    vi.mocked(readProjectCustodians).mockResolvedValue(snapshot(false)); vi.mocked(askProjectCustodian).mockRejectedValue(new Error('Unavailable'));
    render(view()); await flush(); fireEvent.click(screen.getByRole('button', { name: 'Project custodians' })); await flush();
    expect((screen.getByRole('option', { name: 'Images and tables' }) as HTMLOptionElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'What is the page limit?' } }); fireEvent.click(screen.getByRole('button', { name: 'Ask' })); await flush();
    expect(screen.getByRole('alert').textContent).toContain('could not answer'); expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('What is the page limit?');
    expect(screen.getByRole('button', { name: 'Ask' }).hasAttribute('disabled')).toBe(false);
  });
});
