// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { compareProjectHistory, createProjectHistoryCheckpoint, ProjectHistoryError, readProjectHistory, readProjectHistoryVersion, recordProjectHistoryActivity, restoreProjectHistory, reviewProjectOrganization, PROJECT_HISTORY_UPDATED_EVENT } from '../../src/providers/project-history';
import { invalidateProjectFilesCache } from '../../src/providers/registry';
import { historyComparison, historyRestored, historyReview, historyVersion, projectHistory } from '../helpers/project-history-fixtures';

vi.mock('../../src/providers/registry', () => ({ invalidateProjectFilesCache: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const context = { workspaceId: 'workspace', workspaceType: 'personal', workspaceMemberId: 'member', role: 'owner', lifecycleState: 'active', memberStatus: 'active', permissions: { canShareProjects: true, canWriteSyncedFiles: true } } as WorkspaceCollabContext;

describe('project history HTTP boundary', () => {
  it('reads encoded project/version endpoints with authority and the read abort signal', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(projectHistory())).mockResolvedValueOnce(Response.json(historyVersion())); vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await readProjectHistory('project with spaces', context, signal); await readProjectHistoryVersion('project with spaces', 'checkpoint-1', context, signal);
    expect(fetch.mock.calls[0]![0]).toBe('/api/projects/project%20with%20spaces/history?limit=200'); expect(fetch.mock.calls[1]![0]).toBe('/api/projects/project%20with%20spaces/history/entries/checkpoint-1');
    for (const [, init] of fetch.mock.calls) { expect(init.method).toBe('GET'); expect(init.signal).toBe(signal); expect(init.headers['x-od-workspace-member-id']).toBe('member'); }
  });
  it('requests older pages by exclusive cursor and validates the next cursor advances', async () => {
    const history = projectHistory(); history.nextCursor = history.entries.at(-1)!.id;
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(history)).mockResolvedValueOnce(Response.json({ ...history, nextCursor: 'previous-page' })); vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    expect((await readProjectHistory('project', context, signal, { before: 'previous-page', limit: 2 })).nextCursor).toBe('initial-1');
    expect(fetch.mock.calls[0]![0]).toBe('/api/projects/project/history?limit=2&before=previous-page');
    expect(fetch.mock.calls[0]![1].signal).toBe(signal); expect(fetch.mock.calls[0]![1].headers['x-od-workspace-member-id']).toBe('member');
    await expect(readProjectHistory('project', undefined, undefined, { before: 'previous-page' })).rejects.toMatchObject({ code: 'invalid-response' });
  });
  it('rejects invalid pagination rather than silently restarting or enlarging the page', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const pagination of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { before: '../cursor' }, { before: '' }]) await expect(readProjectHistory('project', undefined, undefined, pagination)).rejects.toMatchObject({ code: 'invalid-request' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('compares text and binary metadata without requesting raw file bytes', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(historyComparison())); vi.stubGlobal('fetch', fetch);
    const response = await compareProjectHistory('project', { fromId: 'checkpoint-1', path: 'figure.png' }, context);
    expect(response.changes[1]!.binary).toBe(true); expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![0]).toBe('/api/projects/project/history/compare'); expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ fromId: 'checkpoint-1', path: 'figure.png' });
    expect(fetch.mock.calls[0]![1].headers['content-type']).toBe('application/json');
  });
  it('restores explicit selected paths against the current revision and invalidates only after success', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(historyRestored())); vi.stubGlobal('fetch', fetch);
    const updated = vi.fn(); window.addEventListener(PROJECT_HISTORY_UPDATED_EVENT, updated);
    try {
      await restoreProjectHistory('project', { entryId: 'checkpoint-1', paths: ['report.html'], baseRevision: 'revision-current' }, context);
      expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ entryId: 'checkpoint-1', paths: ['report.html'], baseRevision: 'revision-current' });
      expect(invalidateProjectFilesCache).toHaveBeenCalledExactlyOnceWith('project', context); expect(updated).toHaveBeenCalledOnce();
    } finally { window.removeEventListener(PROJECT_HISTORY_UPDATED_EVENT, updated); }
  });
  it('never turns empty selections or unsafe/manual paths into an all-files restore', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const paths of [[], ['../outside'], ['C:/outside'], ['/absolute']]) await expect(restoreProjectHistory('project', { entryId: 'checkpoint-1', paths, baseRevision: 'revision-current' })).rejects.toBeInstanceOf(ProjectHistoryError);
    await expect(readProjectHistoryVersion('project', '../entry')).rejects.toBeInstanceOf(ProjectHistoryError);
    await expect(compareProjectHistory('project', { fromId: 'checkpoint-1', path: '../../outside' })).rejects.toBeInstanceOf(ProjectHistoryError);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('distinguishes revision conflict from an active agent without announcing a restore', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 'HISTORY_CONFLICT' } }, { status: 409 })).mockResolvedValueOnce(Response.json({ error: { code: 'HISTORY_AGENT_RUNNING' } }, { status: 409 })); vi.stubGlobal('fetch', fetch);
    const input = { entryId: 'checkpoint-1', baseRevision: 'revision-current' };
    await expect(restoreProjectHistory('project', input)).rejects.toMatchObject({ code: 'conflict' }); await expect(restoreProjectHistory('project', input)).rejects.toMatchObject({ code: 'agent-running' });
    expect(invalidateProjectFilesCache).not.toHaveBeenCalled();
  });
  it('keeps background preparation distinct from a stale revision', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'HISTORY_BACKGROUND_RUNNING' } }, { status: 409 })));
    await expect(restoreProjectHistory('project', { entryId: 'checkpoint-1', baseRevision: 'revision-current' })).rejects.toMatchObject({ code: 'background-running' });
    expect(invalidateProjectFilesCache).not.toHaveBeenCalled();
  });
  it('supports explicit checkpoint, real user activity and read-only organization review operations', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ entry: null })).mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json({ review: historyReview() })); vi.stubGlobal('fetch', fetch);
    expect((await createProjectHistoryCheckpoint('project')).entry).toBeNull(); await recordProjectHistoryActivity('project', context); await reviewProjectOrganization('project', { action: 'review' }, context);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/projects/project/history/checkpoint', '/api/projects/project/history/activity', '/api/projects/project/history/organization']);
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([{}, { kind: 'user' }, { action: 'review' }]);
    expect(invalidateProjectFilesCache).not.toHaveBeenCalled();
  });
  it('rejects malformed or unsafe server data and unavailable routes', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: {}, entries: [] })).mockResolvedValueOnce(Response.json({ entry: historyVersion().entry, files: [{ path: '../escape', size: 1, hash: 'x' }] })).mockResolvedValueOnce(Response.json({}, { status: 503 })); vi.stubGlobal('fetch', fetch);
    await expect(readProjectHistory('project')).rejects.toMatchObject({ code: 'invalid-response' }); await expect(readProjectHistoryVersion('project', 'checkpoint-1')).rejects.toMatchObject({ code: 'invalid-response' }); await expect(readProjectHistory('project')).rejects.toMatchObject({ code: 'unavailable' });
  });
});
