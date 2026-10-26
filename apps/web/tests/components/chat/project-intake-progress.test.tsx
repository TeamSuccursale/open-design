// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntakeDocument, ProjectIntakeCatalog } from '@open-design/contracts';
import { I18nProvider } from '../../../src/i18n';
import { ProjectIntakeProgress } from '../../../src/components/chat/ProjectIntakeProgress';
import { fetchProjectIntake, OPEN_PROJECT_GALLERY_EVENT, PROJECT_INTAKE_UPDATED_EVENT, PROJECT_INTAKE_RETRY_EVENT } from '../../../src/providers/project-intake';

vi.mock('../../../src/providers/project-intake', () => ({
  fetchProjectIntake: vi.fn(),
  OPEN_PROJECT_GALLERY_EVENT: 'melillodesign:open-project-gallery',
  PROJECT_INTAKE_UPDATED_EVENT: 'melillodesign:project-intake-updated',
  PROJECT_INTAKE_RETRY_EVENT: 'melillodesign:retry-project-intake',
}));
const fetchIntake = vi.mocked(fetchProjectIntake);
const document = (id: string, status: IntakeDocument['status'], pageCount = 10, completedPages = 0): IntakeDocument => ({ id, status, pageCount, completedPages, name: `${id}.pdf`, sourcePath: `sources/${id}.pdf`, indexedPages: [], updatedAt: '2026-10-23T12:00:00Z' });
const catalog = (...documents: IntakeDocument[]): ProjectIntakeCatalog => ({ version: 1, documents, assets: [] });
const view = () => <I18nProvider initial="en"><ProjectIntakeProgress projectId="p1" /></I18nProvider>;
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
beforeEach(() => { vi.useFakeTimers(); fetchIntake.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('nonblocking project intake bar', () => {
  it('stays absent for a project without intake and never starts an intake job itself', async () => {
    fetchIntake.mockResolvedValue(catalog());
    render(view()); await settle();
    expect(screen.queryByTestId('project-intake-progress')).toBeNull();
    expect(fetchIntake).toHaveBeenCalledWith('p1', undefined, undefined, expect.any(AbortSignal));
    expect(fetchIntake.mock.calls.every((call) => call[2] === undefined)).toBe(true);
  });
  it('shows exact page counts above usable chat, then backs off after jobs finish', async () => {
    fetchIntake.mockResolvedValueOnce(catalog(document('one', 'processing', 10, 3))).mockResolvedValue(catalog(document('one', 'ready', 10, 10)));
    render(<><textarea aria-label="Chat draft" />{view()}</>); await settle();
    expect(screen.getByText('3 / 10 pages indexed')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('30');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Chat draft' }).hasAttribute('disabled')).toBe(false);
    fireEvent.change(screen.getByRole('textbox', { name: 'Chat draft' }), { target: { value: 'Keep writing' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(screen.getByText('Gallery updated')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('100');
    const calls = fetchIntake.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchIntake).toHaveBeenCalledTimes(calls);
    expect((screen.getByRole('textbox', { name: 'Chat draft' }) as HTMLTextAreaElement).value).toBe('Keep writing');
  });
  it('uses an indeterminate bar while discovering totals and only refreshes matching projects', async () => {
    fetchIntake.mockResolvedValue(catalog(document('new', 'queued', 0)));
    render(view()); await settle();
    expect(screen.getByRole('progressbar').hasAttribute('value')).toBe(false);
    expect(screen.getByText('0 pages indexed · finding total')).toBeTruthy();
    fireEvent(window, new CustomEvent(PROJECT_INTAKE_UPDATED_EVENT, { detail: { projectId: 'other' } }));
    await settle(); expect(fetchIntake).toHaveBeenCalledTimes(1);
    fireEvent(window, new CustomEvent(PROJECT_INTAKE_UPDATED_EVENT, { detail: { projectId: 'p1' } }));
    await settle(); expect(fetchIntake).toHaveBeenCalledTimes(2);
  });
  it('retains document failures, explicitly retries only failed sources, and opens this project gallery', async () => {
    fetchIntake.mockResolvedValue(catalog(document('good', 'ready', 2, 2), { ...document('bad', 'failed', 8, 6), error: 'CLI analysis timed out' }));
    render(view()); await settle();
    expect(screen.getByText('Intake needs attention')).toBeTruthy();
    expect(screen.getByText('1 documents need retry')).toBeTruthy();
    expect(screen.getByText('CLI analysis timed out')).toBeTruthy();
    fetchIntake.mockResolvedValue(catalog(document('good', 'ready', 2, 2), document('bad', 'queued', 8, 6)));
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed documents' })); await settle();
    expect(fetchIntake).toHaveBeenLastCalledWith('p1', undefined, { paths: ['sources/bad.pdf'], retry: true });
    const opened = vi.fn(); window.addEventListener(OPEN_PROJECT_GALLERY_EVENT, opened);
    fireEvent.click(screen.getByRole('button', { name: 'Gallery' }));
    expect(opened.mock.calls[0]?.[0].detail).toEqual({ projectId: 'p1' });
    window.removeEventListener(OPEN_PROJECT_GALLERY_EVENT, opened);
  });
  it('shows connection failure with recovery without blocking the chat or silently hiding prior counts', async () => {
    fetchIntake.mockRejectedValue(new Error('Connection lost'));
    render(view()); await settle();
    expect(screen.getByRole('alert').textContent).toContain('Connection lost');
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retains a consented-start failure across catalog refresh and hands deliberate retry to its configuration owner', async () => {
    fetchIntake.mockResolvedValue(catalog());
    render(view()); await settle();
    fireEvent(window, new CustomEvent(PROJECT_INTAKE_UPDATED_EVENT, { detail: { projectId: 'p1', launchError: 'Source folder is unavailable' } }));
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('Source folder is unavailable');
    const retry = vi.fn(); window.addEventListener(PROJECT_INTAKE_RETRY_EVENT, retry);
    fireEvent.click(screen.getByRole('button', { name: 'Retry intake' }));
    expect(retry.mock.calls[0]?.[0].detail).toEqual({ projectId: 'p1' });
    expect(fetchIntake.mock.calls.every((call) => call[2] === undefined)).toBe(true);
    window.removeEventListener(PROJECT_INTAKE_RETRY_EVENT, retry);
    fetchIntake.mockResolvedValue(catalog(document('new', 'queued', 0)));
    fireEvent(window, new CustomEvent(PROJECT_INTAKE_UPDATED_EVENT, { detail: { projectId: 'p1' } }));
    await settle(); expect(screen.queryByRole('alert')).toBeNull();
  });
});
