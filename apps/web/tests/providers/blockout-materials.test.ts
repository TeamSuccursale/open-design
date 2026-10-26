import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { assessBlockoutDocument, blockoutDocumentRevision, loadBlockoutMaterials } from '../../src/providers/blockout-materials';
import { materialAssessment, materialDocument, materialInventory } from '../helpers/blockout-materials-fixtures';

afterEach(() => { vi.unstubAllGlobals(); });
describe('material inventory and fit requests', () => {
  it('keeps workspace authority and an unsaved snapshot on the shared endpoints without saving it', async () => {
    const document = materialDocument(), assessment = materialAssessment(document);
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ inventory: materialInventory() })).mockResolvedValueOnce(Response.json({ assessment }));
    vi.stubGlobal('fetch', fetch);
    const context = { workspaceId: 'space', workspaceType: 'team', workspaceMemberId: 'engineer', role: 'owner', lifecycleState: 'active', memberStatus: 'active', permissions: { canShareProjects: true, canWriteSyncedFiles: true } } as WorkspaceCollabContext;
    await loadBlockoutMaterials('project', context);
    expect(await assessBlockoutDocument('project', document, context)).toEqual(assessment);
    expect(fetch.mock.calls[0]![0]).toBe('/api/projects/project/blockout-materials');
    const [url, init] = fetch.mock.calls[1]!;
    expect(url).toBe('/api/projects/project/blockout-documents/document-1/assessment');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json', 'x-od-workspace-id': 'space', 'x-od-workspace-member-id': 'engineer' });
    expect(JSON.parse(init.body)).toEqual({ document });
  });
  it('rejects another project inventory and malformed assessments, with an explicit refresh POST', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ inventory: { ...materialInventory(), projectId: 'other' } })).mockResolvedValueOnce(Response.json({ inventory: materialInventory() })).mockResolvedValueOnce(Response.json({ assessment: { status: 'ready' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(loadBlockoutMaterials('project')).rejects.toThrow('blockoutMaterials.loadFailed');
    await loadBlockoutMaterials('project', undefined, undefined, true);
    expect(fetch.mock.calls[1]![1]).toMatchObject({ method: 'POST', body: '{}' });
    await expect(assessBlockoutDocument('project', materialDocument())).rejects.toThrow('blockoutMaterials.checkFailed');
  });
  it('fences assessment readiness to canonical saved geometry, including after a manual resize', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const document = materialDocument();
    expect(await blockoutDocumentRevision(document)).toBe(materialAssessment(document).documentRevision);
    document.variants[0]!.pages[0]!.blocks[0]!.box.height = 10;
    expect(await blockoutDocumentRevision(document)).not.toBe(materialAssessment().documentRevision);
  });
});
