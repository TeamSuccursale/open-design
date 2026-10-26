import { afterEach, expect, it, vi } from 'vitest';
import { createBlockoutDocument } from '@open-design/contracts';
import { loadBlockoutDesign, loadBlockoutDesignUnderlay } from '../../src/providers/blockout-design';
import { registeredWorkspace } from '../../src/providers/blockout';
vi.mock('../../src/providers/blockout', () => ({ registeredWorkspace: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
it('resolves the owning document workspace for a collection chat and rejects mismatched identities', async () => {
  vi.mocked(registeredWorkspace).mockResolvedValue('child');
  const state = { version: 1, documentId: 'report', applied: null, pending: [], pendingChanges: false, sourceChanged: false };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(state))); vi.stubGlobal('fetch', fetcher);
  expect(await loadBlockoutDesign('parent', 'report')).toEqual({ projectId: 'child', state });
  expect(fetcher.mock.calls[0]![0]).toBe('/api/projects/child/blockout-documents/report/design');
  fetcher.mockResolvedValue(new Response(JSON.stringify({ ...state, documentId: createBlockoutDocument().documentId })));
  await expect(loadBlockoutDesign('parent', 'report')).rejects.toThrow('invalidDocument');
});
it('requests only the selected page reference and reports missing/invalid references', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 404 })); vi.stubGlobal('fetch', fetcher);
  await expect(loadBlockoutDesignUnderlay('child', 'report', 'page-3')).rejects.toThrow('underlayUnavailable');
  expect(fetcher.mock.calls[0]![0]).toContain('/report/design/pages/page-3');
  fetcher.mockResolvedValue(new Response(JSON.stringify({ revisionId: 'revision', pageId: 'page-1', html: '<p>wrong page</p>', filePath: 'report.html', widthPx: 794, heightPx: 1123 })));
  await expect(loadBlockoutDesignUnderlay('child', 'report', 'page-3')).rejects.toThrow('invalidDocument');
});
