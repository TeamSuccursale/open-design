// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPreparationStatus } from '../../../src/components/chat/ProjectPreparationStatus';
import { I18nProvider } from '../../../src/i18n';
import { fetchProjectIntake, OPEN_PROJECT_GALLERY_EVENT, PROJECT_INTAKE_UPDATED_EVENT } from '../../../src/providers/project-intake';
import { documentResearchRequest } from '../../../src/providers/document-research';
import { readProjectCustodians, pulseProjectCustodians, readCustodianHistory } from '../../../src/providers/project-custodians';
import { custodianSnapshot, statusCatalog, statusResearch } from '../../helpers/project-status-fixtures';

vi.mock('../../../src/providers/project-intake', async (original) => ({ ...await original<typeof import('../../../src/providers/project-intake')>(), fetchProjectIntake: vi.fn() }));
vi.mock('../../../src/providers/document-research', async (original) => ({ ...await original<typeof import('../../../src/providers/document-research')>(), documentResearchRequest: vi.fn() }));
vi.mock('../../../src/providers/project-custodians', async (original) => ({ ...await original<typeof import('../../../src/providers/project-custodians')>(), readProjectCustodians: vi.fn(), pulseProjectCustodians: vi.fn(), readCustodianHistory: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers(); Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  const custody = custodianSnapshot();
  vi.mocked(fetchProjectIntake).mockResolvedValue(statusCatalog());
  vi.mocked(documentResearchRequest).mockResolvedValue(statusResearch());
  vi.mocked(readProjectCustodians).mockResolvedValue({ ledger: custody.ledger!, indexing: custody.indexing });
  vi.mocked(pulseProjectCustodians).mockResolvedValue(custody.indexing);
  vi.mocked(readCustodianHistory).mockResolvedValue({ events: [], revision: 'revision', verified: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
const view = (projectId = 'project') => <I18nProvider initial="en"><textarea aria-label="Chat draft" /><ProjectPreparationStatus projectId={projectId} /></I18nProvider>;
async function flush() { await act(async () => undefined); }

describe('one compact status row above chat', () => {
  it('has two accurate indicators and a closed drawer while each underlying stream is read once', async () => {
    render(view());
    expect(screen.getByTestId('project-status-text').textContent).toBe('Text: waiting');
    expect(screen.getByTestId('project-status-images').textContent).toBe('Images: waiting');
    await flush();
    const toggle = screen.getByRole('button', { name: 'Document intake status' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('project-status-text').textContent).toBe('Text: ready');
    expect(screen.getByTestId('project-status-images').textContent).toBe('Images: ready');
    expect(screen.queryByRole('button', { name: 'Document analysis' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Project custodians' })).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(fetchProjectIntake).toHaveBeenCalledOnce(); expect(documentResearchRequest).toHaveBeenCalledOnce(); expect(readProjectCustodians).toHaveBeenCalledOnce();
    fireEvent.click(toggle);
    const sources = screen.getByRole('table', { name: 'Source files · pages' });
    expect(sources.textContent).toContain('Survey.pdf');
    expect(sources.textContent).toContain('2 / 2');
    expect(screen.getByRole('button', { name: 'Document analysis' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Project custodians' })).toBeTruthy();
    const opened = vi.fn(); window.addEventListener(OPEN_PROJECT_GALLERY_EVENT, opened);
    try { fireEvent.click(screen.getByRole('button', { name: 'Gallery' })); expect(opened.mock.calls[0]?.[0].detail).toEqual({ projectId: 'project' }); }
    finally { window.removeEventListener(OPEN_PROJECT_GALLERY_EVENT, opened); }
    fireEvent.click(screen.getByRole('button', { name: 'Close status details' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(fetchProjectIntake).toHaveBeenCalledOnce(); expect(documentResearchRequest).toHaveBeenCalledOnce();
  });

  it('keeps the user’s drawer choice through progress and reports a later failure without reopening it', async () => {
    const active = statusCatalog(); active.documents[0]!.status = 'processing'; active.documents[0]!.completedPages = 1;
    vi.mocked(fetchProjectIntake).mockResolvedValueOnce(active).mockResolvedValue(statusCatalog());
    render(view()); await flush();
    const toggle = screen.getByRole('button', { name: 'Document intake status' });
    expect(screen.getByTestId('project-status-images').textContent).toBe('Images: in progress');
    fireEvent.click(toggle);
    await act(async () => vi.advanceTimersByTimeAsync(1800));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('project-status-images').textContent).toBe('Images: ready');
    fireEvent.click(toggle);
    vi.mocked(fetchProjectIntake).mockRejectedValueOnce(new Error('Disconnected'));
    fireEvent(window, new CustomEvent(PROJECT_INTAKE_UPDATED_EVENT, { detail: { projectId: 'project' } })); await flush();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('project-status-images').textContent).toBe('Images: needs attention');
    expect((screen.getByRole('textbox', { name: 'Chat draft' }) as HTMLTextAreaElement).disabled).toBe(false);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' })); await flush();
    expect(screen.getByTestId('project-status-images').textContent).toBe('Images: ready');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows stale source coverage as attention and resets disclosure state for another project', async () => {
    const custody = custodianSnapshot(); custody.ledger!.sources[0]!.status = 'changed';
    vi.mocked(readProjectCustodians).mockResolvedValue({ ledger: custody.ledger!, indexing: custody.indexing });
    const { rerender } = render(view()); await flush();
    expect(screen.getByTestId('project-status-text').textContent).toBe('Text: needs attention');
    expect(screen.getByTestId('project-status-images').textContent).toBe('Images: needs attention');
    fireEvent.click(screen.getByRole('button', { name: 'Document intake status' }));
    rerender(view('another')); await flush();
    expect(screen.getByRole('button', { name: 'Document intake status' }).getAttribute('aria-expanded')).toBe('false');
  });
});
