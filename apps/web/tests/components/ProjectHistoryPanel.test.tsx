// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { ProjectHistoryPanel } from '../../src/components/history/ProjectHistoryPanel';
import { compareProjectHistory, createProjectHistoryCheckpoint, ProjectHistoryError, readProjectHistory, readProjectHistoryVersion, restoreProjectHistory, reviewProjectOrganization } from '../../src/providers/project-history';
import { historyComparison, historyEntry, historyRestored, historyReview, historyVersion, projectHistory } from '../helpers/project-history-fixtures';

vi.mock('../../src/providers/project-history', async (original) => {
  const actual = await original<typeof import('../../src/providers/project-history')>();
  return { ...actual, readProjectHistory: vi.fn(), readProjectHistoryVersion: vi.fn(), compareProjectHistory: vi.fn(), createProjectHistoryCheckpoint: vi.fn(), restoreProjectHistory: vi.fn(), reviewProjectOrganization: vi.fn() };
});
beforeEach(() => {
  vi.mocked(readProjectHistory).mockResolvedValue(projectHistory());
  vi.mocked(readProjectHistoryVersion).mockImplementation(async (_project, id) => historyVersion(id));
  vi.mocked(compareProjectHistory).mockImplementation(async (_project, input) => ({ ...historyComparison(input.fromId), toId: input.toId ?? null }));
  vi.mocked(createProjectHistoryCheckpoint).mockResolvedValue({ entry: null });
  vi.mocked(restoreProjectHistory).mockResolvedValue(historyRestored());
  vi.mocked(reviewProjectOrganization).mockResolvedValue({ review: historyReview() });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function setup(workspaceContext?: WorkspaceCollabContext, locale: 'en' | 'it' = 'en') {
  const onClose = vi.fn(), onRestored = vi.fn();
  const view = render(<I18nProvider initial={locale}><ProjectHistoryPanel projectId="project" workspaceContext={workspaceContext} onClose={onClose} onRestored={onRestored} /></I18nProvider>);
  return { ...view, onClose, onRestored };
}
async function ready() { await screen.findByRole('button', { name: 'View report.html' }); }

describe('project history panel', () => {
  it('loads a version and current comparison, keeps saves collapsed and reveals each saved snapshot on request', async () => {
    const view = setup(); await ready();
    expect(screen.getByRole('dialog', { name: 'Project history' })).toBeTruthy();
    expect(readProjectHistoryVersion).toHaveBeenCalledWith('project', 'checkpoint-1', undefined, expect.any(AbortSignal));
    expect(compareProjectHistory).toHaveBeenCalledWith('project', { fromId: 'checkpoint-1' }, undefined, expect.any(AbortSignal));
    expect(screen.queryByText('Saved report')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show saved versions (1)' }));
    fireEvent.click(screen.getByRole('button', { name: /Saved report/ }));
    await waitFor(() => expect(readProjectHistoryVersion).toHaveBeenLastCalledWith('project', 'save-2', undefined, expect.any(AbortSignal)));
    expect(screen.queryByText(/"entries"|"baseRevision"/)).toBeNull();
    expect(view.container.querySelector('img')).toBeNull(); expect(restoreProjectHistory).not.toHaveBeenCalled();
  });

  it('shows escaped before/after text and binary metadata without loading images or executing saved HTML', async () => {
    const view = setup(); await ready();
    expect(screen.getByText('<h1>Earlier report</h1>')).toBeTruthy(); expect(screen.getByText('<h1>Current report</h1>')).toBeTruthy();
    expect(view.container.querySelector('h1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View figure.png' }));
    const binary = within(screen.getByRole('region', { name: 'figure.png' }));
    expect(binary.getByText('Binary file · metadata only')).toBeTruthy(); expect(binary.getByText('100 bytes')).toBeTruthy(); expect(binary.getByText('120 bytes')).toBeTruthy();
    expect(view.container.querySelector('img, iframe, picture')).toBeNull();
  });

  it('requires an explicit reviewed selection and uses the current revision for selected-file restore', async () => {
    let finish!: (value: ReturnType<typeof historyRestored>) => void;
    vi.mocked(restoreProjectHistory).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const after = projectHistory('revision-restored'); after.entries.unshift(historyRestored().entry, historyEntry('safety-1', { reason: 'before-restore', title: 'Safety checkpoint', createdAt: '2026-10-24T12:19:00Z' }));
    vi.mocked(readProjectHistory).mockResolvedValueOnce(projectHistory()).mockResolvedValue(after);
    const view = setup(); await ready();
    expect((screen.getByRole('button', { name: 'Restore selected files (0)' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select report.html for restore' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore selected files (1)' }));
    expect(restoreProjectHistory).not.toHaveBeenCalled();
    const confirmation = within(screen.getByRole('region', { name: 'Review the restore' }));
    expect(confirmation.getByText('report.html')).toBeTruthy(); expect(confirmation.queryByText('new.txt')).toBeNull();
    fireEvent.click(confirmation.getByRole('button', { name: 'Confirm restore' }));
    expect(restoreProjectHistory).toHaveBeenCalledExactlyOnceWith('project', { entryId: 'checkpoint-1', paths: ['report.html'], baseRevision: 'revision-current' }, undefined);
    expect((screen.getByRole('button', { name: 'Restoring…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Create checkpoint' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish(historyRestored()));
    expect(view.onRestored).toHaveBeenCalledWith(historyRestored());
    expect(await screen.findByText(/Restored 1 paths/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View the safety checkpoint' }));
    await waitFor(() => expect(readProjectHistoryVersion).toHaveBeenLastCalledWith('project', 'safety-1', undefined, expect.any(AbortSignal)));
  });

  it('reviews restore-to-absence before whole-version restore and never submits an empty path list', async () => {
    setup(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    const confirmation = within(screen.getByRole('region', { name: 'Review the restore' }));
    expect(confirmation.getByText('new.txt')).toBeTruthy(); expect(confirmation.getByText('Will be removed: it did not exist in this version.')).toBeTruthy();
    expect(restoreProjectHistory).not.toHaveBeenCalled(); fireEvent.click(confirmation.getByRole('button', { name: 'Confirm restore' }));
    expect(restoreProjectHistory).toHaveBeenCalledWith('project', { entryId: 'checkpoint-1', baseRevision: 'revision-current' }, undefined);
    expect(vi.mocked(restoreProjectHistory).mock.calls[0]![1]).not.toHaveProperty('paths');
  });

  it('keeps failed restore retryable and requires refreshed review after a revision conflict', async () => {
    vi.mocked(restoreProjectHistory).mockRejectedValueOnce(new ProjectHistoryError('conflict', 409));
    setup(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Restore this version' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
    expect(await screen.findByText('The project changed since this comparison. Refresh to review the latest changes before restoring.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Confirm restore' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'View report.html' })).toBeTruthy();
    vi.mocked(readProjectHistory).mockResolvedValue(projectHistory('revision-new'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]!);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Review the restore' })).toBeNull());
    await waitFor(() => expect((screen.getByRole('button', { name: 'Restore this version' }) as HTMLButtonElement).disabled).toBe(false));
    expect(restoreProjectHistory).toHaveBeenCalledOnce();
  });

  it('explains an active agent separately from stale files', async () => {
    vi.mocked(restoreProjectHistory).mockRejectedValueOnce(new ProjectHistoryError('agent-running', 409));
    setup(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Restore this version' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
    expect(await screen.findByText('The agent is still working. Wait for it to finish or stop it in chat before restoring files.')).toBeTruthy();
    expect(screen.queryByText(/The project changed since this comparison/)).toBeNull();
  });

  it('compares two saved versions and requires a current-project comparison before enabling restore', async () => {
    setup(); await ready(); fireEvent.change(screen.getByRole('combobox', { name: 'Compare with' }), { target: { value: 'initial-1' } });
    await waitFor(() => expect(compareProjectHistory).toHaveBeenLastCalledWith('project', { fromId: 'checkpoint-1', toId: 'initial-1' }, undefined, expect.any(AbortSignal)));
    await screen.findByText('Comparison between saved versions');
    expect((screen.getByRole('button', { name: 'Restore this version' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Select report.html for restore' }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Compare with the current project to restore' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Restore this version' }) as HTMLButtonElement).disabled).toBe(false));
    expect(restoreProjectHistory).not.toHaveBeenCalled();
  });

  it('exposes the organization review as read-only proposals and protected dependencies', async () => {
    const history = projectHistory(); history.status.organizationReview = historyReview(); vi.mocked(readProjectHistory).mockResolvedValue(history);
    setup(); await ready(); fireEvent.click(screen.getByText('File organization'));
    expect(screen.getByText('draft-old.html')).toBeTruthy(); expect(screen.getByText('Referenced by: report.html')).toBeTruthy();
    expect(screen.getByText('References must be checked before any move.')).toBeTruthy(); expect(screen.getByText('This is a review only. No files have been moved or deleted.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review file organization' }));
    expect(reviewProjectOrganization).toHaveBeenCalledWith('project', { action: 'review' }, undefined);
    expect(restoreProjectHistory).not.toHaveBeenCalled(); expect(createProjectHistoryCheckpoint).not.toHaveBeenCalled();
  });

  it('retries a failed initial read and reports an empty checkpoint without claiming a new version', async () => {
    vi.mocked(readProjectHistory).mockRejectedValueOnce(new Error('network')).mockResolvedValue(projectHistory());
    setup(); expect(await screen.findByText('History could not load. Retry to continue.')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await ready(); fireEvent.click(screen.getByRole('button', { name: 'Create checkpoint' }));
    expect(await screen.findByText('No new changes to checkpoint.')).toBeTruthy(); expect(createProjectHistoryCheckpoint).toHaveBeenCalledWith('project', {}, undefined);
  });

  it('renders Italian copy and keeps write controls disabled for a read-only workspace', async () => {
    const context = { permissions: { canWriteSyncedFiles: false } } as WorkspaceCollabContext;
    setup(context, 'it'); await screen.findByRole('button', { name: 'Vedi report.html' });
    expect(screen.getByRole('dialog', { name: 'Cronologia del progetto' })).toBeTruthy(); expect(screen.getByText('Accesso in sola lettura')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Crea punto di ripristino' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Ripristina questa versione' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('closes on Escape, restores focus and aborts outstanding reads on unmount', async () => {
    const opener = document.createElement('button'); document.body.appendChild(opener); opener.focus();
    const view = setup(); await ready(); const signal = vi.mocked(readProjectHistory).mock.calls[0]![2]!;
    fireEvent.keyDown(document, { key: 'Escape' }); expect(view.onClose).toHaveBeenCalledOnce();
    view.unmount(); expect(document.activeElement).toBe(opener); expect(signal.aborted).toBe(true); opener.remove();
  });

  it('reaches old checkpoints beyond 200 saves, deduplicates pages and preserves the current restore revision', async () => {
    const first = projectHistory();
    first.entries = Array.from({ length: 200 }, (_, index) => historyEntry(`save-${index}`, { kind: 'save', reason: 'save', title: `Saved ${index}`, createdAt: new Date(Date.UTC(2026, 9, 24, 12) - index * 1000).toISOString() }));
    first.nextCursor = 'save-199';
    const older = { ...projectHistory('revision-from-older-request'), entries: [first.entries[199]!, historyEntry('old-checkpoint', { title: 'Older checkpoint', createdAt: '2026-10-23T10:00:00Z' })], nextCursor: null };
    vi.mocked(readProjectHistory).mockResolvedValueOnce(first).mockResolvedValueOnce(older);
    setup(); await screen.findByRole('button', { name: 'Load older versions' });
    expect(readProjectHistoryVersion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Load older versions' }));
    await screen.findByRole('button', { name: /Older checkpoint/ }); await ready();
    expect(readProjectHistory).toHaveBeenLastCalledWith('project', undefined, expect.any(AbortSignal), { before: 'save-199', limit: 200 });
    expect(screen.getByRole('button', { name: 'Show saved versions (200)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load older versions' })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Timeline' })).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Restore this version' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
    expect(restoreProjectHistory).toHaveBeenCalledWith('project', { entryId: 'old-checkpoint', baseRevision: 'revision-current' }, undefined);
  });

  it('retries an older-page failure without discarding the active comparison or cursor', async () => {
    const first = { ...projectHistory(), nextCursor: 'initial-1' };
    vi.mocked(readProjectHistory).mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...projectHistory(), entries: [historyEntry('older', { title: 'Older recovery point' })], nextCursor: null });
    setup(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Load older versions' }));
    expect(await screen.findByText('Older versions could not load. Your current comparison is kept; retry below.')).toBeTruthy();
    expect(screen.getByText('<h1>Earlier report</h1>')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load older versions' })); await screen.findByRole('button', { name: /Older recovery point/ });
    expect(vi.mocked(readProjectHistory).mock.calls.slice(1).map((call) => call[3])).toEqual([{ before: 'initial-1', limit: 200 }, { before: 'initial-1', limit: 200 }]);
  });

  it('renders at most 80 timeline entries per window while older loaded entries remain navigable', async () => {
    const history = projectHistory(); history.entries = Array.from({ length: 200 }, (_, index) => historyEntry(`checkpoint-${index}`, { title: `Version ${index}`, createdAt: new Date(Date.UTC(2026, 9, 24, 12) - index * 1000).toISOString() })); history.nextCursor = 'checkpoint-199';
    vi.mocked(readProjectHistory).mockResolvedValue(history); setup(); await ready();
    const timeline = within(screen.getByRole('navigation', { name: 'Timeline' }));
    expect(timeline.getAllByRole('listitem')).toHaveLength(80); expect(timeline.queryByRole('button', { name: 'Load older versions' })).toBeNull();
    fireEvent.click(timeline.getByRole('button', { name: 'Show more versions' })); expect(timeline.getAllByRole('listitem')).toHaveLength(80);
    fireEvent.click(timeline.getByRole('button', { name: 'Show more versions' })); expect(timeline.getAllByRole('listitem')).toHaveLength(40);
    expect(timeline.getByRole('button', { name: 'Load older versions' })).toBeTruthy(); expect(readProjectHistory).toHaveBeenCalledOnce();
    fireEvent.click(timeline.getByRole('button', { name: 'Newer versions' })); expect(timeline.getAllByRole('listitem')).toHaveLength(80);
  });

  it('aborts in-flight older pages on project change and never appends them into the new scope', async () => {
    let finish!: (value: ReturnType<typeof projectHistory>) => void;
    vi.mocked(readProjectHistory).mockResolvedValueOnce({ ...projectHistory(), nextCursor: 'initial-1' }).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(projectHistory());
    const view = setup(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Load older versions' }));
    const olderSignal = vi.mocked(readProjectHistory).mock.calls[1]![2]!;
    expect((screen.getByRole('button', { name: 'Loading older versions…' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<I18nProvider initial="en"><ProjectHistoryPanel projectId="other-project" onClose={view.onClose} /></I18nProvider>);
    expect(olderSignal.aborted).toBe(true);
    await act(async () => finish({ ...projectHistory(), entries: [historyEntry('stale', { title: 'Stale other-scope version' })], nextCursor: null }));
    await waitFor(() => expect(readProjectHistory).toHaveBeenLastCalledWith('other-project', undefined, expect.any(AbortSignal)));
    expect(screen.queryByText('Stale other-scope version')).toBeNull();
  });
});
