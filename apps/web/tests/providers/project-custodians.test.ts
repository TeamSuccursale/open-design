// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { askProjectCustodian, custodianDisplayText, ProjectCustodiansUnavailableError, pulseProjectCustodians, readCustodianHistory, readProjectCustodians } from '../../src/providers/project-custodians';

afterEach(() => vi.unstubAllGlobals());
const indexing = { indexing: false, phase: 'idle', queuedChanges: [], pendingDomains: [], message: '' };
const ledger = { version: 1, snapshotRevision: 'a'.repeat(64), sources: [], textStatus: 'complete', imagesStatus: 'indexed', imageConsent: true, gaps: [] };
const context = { workspaceId: 'space', workspaceType: 'team', workspaceMemberId: 'member', role: 'owner', lifecycleState: 'active', memberStatus: 'active', permissions: { canShareProjects: true, canWriteSyncedFiles: true } } as WorkspaceCollabContext;

describe('project custodian provider', () => {
  it('uses the shared authorized API for status, activity and bounded history, with cancellation', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ledger, indexing })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ indexing })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ history: { events: [], revision: null, verified: true } })));
    vi.stubGlobal('fetch', fetcher); const signal = new AbortController().signal;
    expect((await readProjectCustodians('Antro project', context, signal)).ledger).toEqual(ledger);
    await pulseProjectCustodians('Antro project', true, context, signal); await readCustodianHistory('Antro project', context, signal);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/projects/Antro%20project/custodians');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', signal, headers: { 'x-od-workspace-id': 'space', 'x-od-workspace-member-id': 'member' } });
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: '{"active":true}', signal });
    expect(fetcher.mock.calls[2]?.[0]).toContain('/history?limit=10');
  });
  it('validates consultation requests and preserves citations without inventing asset paths', async () => {
    const answer = { domain: 'images', answer: 'A plan is available.', citations: [{ sourceId: 'source', title: 'Antro.pdf', page: 6, assetId: 'asset' }], assetIds: ['asset'], gaps: [], snapshotRevision: 'revision', receiptId: 'receipt' };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: answer }))); vi.stubGlobal('fetch', fetcher);
    expect(await askProjectCustodian('project', { domain: 'images', question: 'Where is the plan?', limit: 6 })).toEqual(answer);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ domain: 'images', question: 'Where is the plan?', limit: 6 }) });
    await expect(askProjectCustodian('project', { domain: 'text', question: ' ', limit: 6 })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('recognizes old daemons quietly, but rejects malformed persisted results and access errors', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('{"ledger":{}}'))
      .mockResolvedValueOnce(new Response('{"error":{"message":"Access denied"}}', { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(readProjectCustodians('project')).rejects.toBeInstanceOf(ProjectCustodiansUnavailableError);
    await expect(readProjectCustodians('project')).rejects.toThrow();
    await expect(readProjectCustodians('project')).rejects.toThrow('Access denied');
  });
  it('keeps source identities, absolute host paths and index hashes outside human-facing evidence', () => {
    const snapshot = { snapshotRevision: 'a'.repeat(64), sources: [{ sourceId: 'private-source', sha256: 'b'.repeat(64) }] };
    const result = custodianDisplayText(`Plan page 6: private-source, ${'a'.repeat(64)}, C:\\Secret\\Antro.pdf ${'b'.repeat(64)}`, snapshot, '[reference]');
    expect(result).toContain('Plan page 6'); expect(result).not.toContain('private-source'); expect(result).not.toContain('Secret'); expect(result).not.toContain('a'.repeat(64));
  });
});
