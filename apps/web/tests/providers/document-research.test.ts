// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentResearchFinding, WorkspaceCollabContext } from '@open-design/contracts';
import { DocumentResearchNotReadyError, DocumentResearchUnavailableError, documentResearchRequest, researchOverviewPreview } from '../../src/providers/document-research';

afterEach(() => { vi.unstubAllGlobals(); });
const context = {
  workspaceId: 'space', workspaceType: 'team', workspaceMemberId: 'member', role: 'owner', lifecycleState: 'active', memberStatus: 'active',
  permissions: { canShareProjects: true, canWriteSyncedFiles: true },
} as WorkspaceCollabContext;

describe('document research provider', () => {
  it('balances the short overview across sources instead of filling it with the first document', () => {
    const findings = ['a', 'b', 'c'].flatMap((sourceId) => Array.from({ length: 8 }, (_, index): DocumentResearchFinding => ({ text: `${sourceId}${index}`, sourceId, pages: [index + 1], certainty: 'observed' })));
    expect(researchOverviewPreview(findings).map((finding) => finding.text)).toEqual(['a0', 'b0', 'c0', 'a1', 'b1', 'c1']);
  });
  it('uses the same project API for reads and retries and carries complete workspace authority and cancellation', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response('{"research":null}', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    expect(await documentResearchRequest('project with spaces', context, undefined, controller.signal)).toBeNull();
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/projects/project%20with%20spaces/document-research');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', cache: 'no-store', signal: controller.signal,
      headers: { 'x-od-workspace-id': 'space', 'x-od-workspace-member-id': 'member', 'x-od-workspace-role': 'owner', 'x-od-workspace-can-write-synced-files': 'true' } });
    await documentResearchRequest('project', context, { retry: true }, controller.signal);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: '{"retry":true}', headers: { 'content-type': 'application/json' } });
  });

  it('rejects invalid persisted data and surfaces authorization errors', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"research":{"status":"complete"}}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"error":{"message":"Project access denied"}}', { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(documentResearchRequest('project')).rejects.toThrow();
    await expect(documentResearchRequest('project')).rejects.toThrow('Project access denied');
  });

  it('identifies unavailable endpoints for both initial reads and pending guided starts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{"error":{"message":"Not found"}}', { status: 404 })));
    await expect(documentResearchRequest('project')).rejects.toBeInstanceOf(DocumentResearchUnavailableError);
    await expect(documentResearchRequest('project', null, { retry: false })).rejects.toBeInstanceOf(DocumentResearchUnavailableError);
  });

  it('retries only the precise missing-text-cache condition, without classifying arbitrary 400 errors as not ready', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"error":{"code":"DOCUMENT_RESEARCH_FAILED","message":"Run the project text intake before research"}}', { status: 400 }))
      .mockResolvedValueOnce(new Response('{"error":{"code":"DOCUMENT_RESEARCH_FAILED","message":"Unauthorized source selection"}}', { status: 400 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(documentResearchRequest('project', null, { retry: false })).rejects.toBeInstanceOf(DocumentResearchNotReadyError);
    await expect(documentResearchRequest('project', null, { retry: false })).rejects.not.toBeInstanceOf(DocumentResearchNotReadyError);
  });
});
