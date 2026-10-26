import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockoutHandoffSnapshot, createBlockoutDocument, createDocumentPresentation, type WorkspaceCollabContext } from '@open-design/contracts';
import { listBlockoutDocuments, loadBlockout, registeredBlockoutComparisonDocument, saveBlockout, saveBlockoutStartingPoint } from '../../src/providers/blockout';
import { invalidateProjectFilesCache } from '../../src/providers/registry';
vi.mock('../../src/providers/registry', () => ({ invalidateProjectFilesCache: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
describe('blockout project persistence', () => {
  it('resolves a nested comparison only from an exact authorized registry entry', async () => {
    const registration = { id: 'report', projectId: 'parent', workspaceProjectId: 'child', name: 'Report', workingDirectory: 'C:/work/report', kind: 'document', folderMode: 'linked', availability: 'available', conversationIds: [], entryFile: 'documents/report-title/blockout-comparison.html', createdAt: 'today', updatedAt: 'today', archivedAt: null };
    const fetch = vi.fn().mockImplementation(async () => Response.json({ document: registration })); vi.stubGlobal('fetch', fetch);
    expect(await registeredBlockoutComparisonDocument('parent', 'documents/report/documents/report-title/blockout-comparison.html')).toBe('report');
    expect(fetch.mock.calls[0]![0]).toBe('/api/projects/parent/documents/report');
    await expect(registeredBlockoutComparisonDocument('parent', 'documents/report/documents/wrong-title/blockout-comparison.html')).rejects.toThrow('blockout.invalidDocument');
    expect(await registeredBlockoutComparisonDocument('parent', 'index.html')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('resolves a Fast working-chat output through the exact registry entryFile and reads its child revision', async () => {
    const doc = createBlockoutDocument(); doc.documentId = 'registered-report'; doc.title = 'Report';
    const registration = { id: doc.documentId, blockoutDocumentId: doc.documentId, projectId: 'parent', workspaceProjectId: 'child', name: 'Report', workingDirectory: 'C:/work/report', kind: 'document', folderMode: 'managed', availability: 'available', conversationIds: [], entryFile: 'documents/report/blockout-comparison.html', createdAt: 'today', updatedAt: 'today', archivedAt: null };
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/projects/parent/documents') return Response.json({ documents: [registration], selectedDocumentId: registration.id });
      if (url === `/api/projects/parent/documents/${registration.id}`) return Response.json({ document: registration });
      if (url === `/api/projects/parent/blockout-documents/${doc.documentId}`) return Response.json({ document: null, raw: null });
      if (url === `/api/projects/child/blockout-documents/${doc.documentId}`) return Response.json({ document: doc, raw: 'actual-child-revision' });
      throw new Error(`Unexpected request ${url}`);
    }); vi.stubGlobal('fetch', fetch);
    const id = await registeredBlockoutComparisonDocument('parent', registration.entryFile);
    expect(id).toBe(doc.documentId);
    expect(await loadBlockout('parent', undefined, undefined, id!)).toMatchObject({ document: { documentId: doc.documentId }, raw: 'actual-child-revision' });
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/blockout-documents/document-1'))).toBe(false);
  });
  it('refuses ambiguous, unavailable and unrelated direct registry comparison paths', async () => {
    const entry = { id: 'report', projectId: 'parent', workspaceProjectId: 'child', name: 'Report', workingDirectory: 'C:/work/report', kind: 'document', folderMode: 'managed', availability: 'available', conversationIds: [], entryFile: 'documents/report/blockout-comparison.html', createdAt: 'today', updatedAt: 'today', archivedAt: null };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ documents: [entry, { ...entry, id: 'other', workspaceProjectId: 'other-child' }] }))
      .mockResolvedValueOnce(Response.json({ documents: [{ ...entry, availability: 'unavailable' }] }))
      .mockResolvedValueOnce(Response.json({ documents: [{ ...entry, projectId: 'unrelated' }] }));
    vi.stubGlobal('fetch', fetch);
    await expect(registeredBlockoutComparisonDocument('parent', entry.entryFile)).rejects.toThrow('blockout.invalidDocument');
    expect(await registeredBlockoutComparisonDocument('parent', entry.entryFile)).toBeNull();
    await expect(registeredBlockoutComparisonDocument('parent', entry.entryFile)).rejects.toThrow('blockout.invalidDocument');
    expect(await registeredBlockoutComparisonDocument('parent', 'documents/../report/blockout-comparison.html')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('opens and saves a registered child Blockout from a parent chat without copying files into the parent', async () => {
    const doc = createBlockoutDocument(); doc.documentId = 'report'; doc.title = 'Report';
    const registration = { id: 'report', projectId: 'parent', workspaceProjectId: 'child', name: 'Report', workingDirectory: 'C:/work/report', kind: 'document', folderMode: 'linked', availability: 'available', conversationIds: [], presentation: createDocumentPresentation('Report'), createdAt: 'today', updatedAt: 'today', archivedAt: null };
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/projects/parent/documents/report') return Response.json({ document: registration });
      if (url === '/api/projects/parent/blockout-documents/report') return init?.method === 'PUT'
        ? Response.json({ error: { code: 'DOCUMENT_WORKSPACE_REQUIRED' } }, { status: 409 }) : Response.json({ document: null, raw: null });
      if (url === '/api/projects/child/blockout-documents/report') return Response.json({ document: doc, raw: 'canonical-child-revision' });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    expect((await loadBlockout('parent', undefined, undefined, 'report')).document?.title).toBe('Report');
    expect(await saveBlockout('parent', doc, 'canonical-child-revision')).toBe('canonical-child-revision');
    expect(fetch.mock.calls.filter(([url, init]) => url === '/api/projects/child/blockout-documents/report' && init?.method === 'PUT')).toHaveLength(1);
    expect(invalidateProjectFilesCache).toHaveBeenCalledWith('child', undefined);
    expect(invalidateProjectFilesCache).toHaveBeenCalledWith('parent', undefined);
  });
  it('routes a parent-chat handoff to the same registered child and preserves its child revision fence', async () => {
    const doc = createBlockoutDocument(); doc.documentId = 'report';
    const registration = { id: 'report', projectId: 'parent', workspaceProjectId: 'child', name: 'Report', workingDirectory: 'C:/work/report', kind: 'document', folderMode: 'linked', availability: 'available', conversationIds: [], createdAt: 'today', updatedAt: 'today', archivedAt: null };
    const handoff = { version: 1, type: 'blockout-update', id: 'update', action: 'request-proposals', createdAt: 'today', workspacePath: 'blockouts/report/.workspace.json', workspaceRevision: 'child-revision', previousHandoffId: null, previousWorkspaceRevision: null, comparison: 'initial', snapshot: blockoutHandoffSnapshot(doc), changes: [] };
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/projects/parent/documents/report') return Response.json({ document: registration });
      if (url === '/api/projects/parent/blockout-documents/report/starting-point') return Response.json({ error: { code: 'DOCUMENT_WORKSPACE_REQUIRED' } }, { status: 409 });
      expect(url).toBe('/api/projects/child/blockout-documents/report/starting-point');
      expect(JSON.parse(String(init?.body)).baseRaw).toBe('child-base');
      return Response.json({ handoff, path: 'blockouts/report/handoffs/update.blockout-update.json' });
    });
    vi.stubGlobal('fetch', fetch);
    const result = await saveBlockoutStartingPoint('parent', doc, undefined, 'child-base');
    expect(result.handoff.workspaceRevision).toBe('child-revision');
    expect(result.path).toBe('documents/report/blockouts/report/handoffs/update.blockout-update.json');
  });
  it('rejects an unrelated registry association rather than following a workspace identity from file content', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ document: null, raw: null })).mockResolvedValueOnce(Response.json({ document: { id: 'report', projectId: 'unrelated', workspaceProjectId: 'other' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(loadBlockout('parent', undefined, undefined, 'report')).rejects.toThrow('blockout.invalidDocument');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('resolves an explicit workspace read conflict but never redirects a normal revision conflict', async () => {
    const doc = createBlockoutDocument(); doc.documentId = 'report';
    const registration = { id: 'report', projectId: 'parent', workspaceProjectId: 'child', name: 'Report', workingDirectory: 'C:/work/report', kind: 'document', folderMode: 'linked', availability: 'available', conversationIds: [], createdAt: 'today', updatedAt: 'today', archivedAt: null };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 'DOCUMENT_WORKSPACE_REQUIRED' } }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ document: registration })).mockResolvedValueOnce(Response.json({ document: doc, raw: 'child' }))
      .mockResolvedValueOnce(Response.json({ error: { code: 'BLOCKOUT_CONFLICT' } }, { status: 409 }));
    vi.stubGlobal('fetch', fetch);
    expect((await loadBlockout('parent', undefined, undefined, 'report')).raw).toBe('child');
    await expect(loadBlockout('parent', undefined, undefined, 'report')).rejects.toThrow('blockout.conflict');
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[2]![0]).toBe('/api/projects/child/blockout-documents/report');
  });
  it('creates an empty editor only for a missing file, preserving unreadable files', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ document: null, raw: null })).mockResolvedValueOnce(new Response('', { status: 500 })).mockResolvedValueOnce(new Response('{broken'));
    vi.stubGlobal('fetch', fetch);
    expect(await loadBlockout('project')).toEqual({ document: null, raw: null });
    await expect(loadBlockout('project')).rejects.toThrow('blockout.loadFailed');
    await expect(loadBlockout('project')).rejects.toThrow('blockout.invalidDocument');
  });
  it('refuses to overwrite an external revision', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'BLOCKOUT_CONFLICT' } }, { status: 409 })));
    await expect(saveBlockout('project', createBlockoutDocument(), 'older revision')).rejects.toThrow('blockout.conflict');
    expect(invalidateProjectFilesCache).not.toHaveBeenCalled();
  });
  it('reports the save failure instead of claiming an already visible document could not load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'BLOCKOUT_FAILED', message: 'The document folder is unavailable' } }, { status: 400 })));
    await expect(saveBlockout('project', createBlockoutDocument(), null)).rejects.toThrow('The document folder is unavailable');
    expect(invalidateProjectFilesCache).not.toHaveBeenCalled();
  });
  it('preserves JSON, workspace authority and the loaded revision through object-merging fetch instrumentation', async () => {
    const doc = createBlockoutDocument(); doc.pageBudget = { mode: 'exact', limit: 3, target: 3 };
    const raw = `${JSON.stringify(doc, null, 2)}\n`;
    const context = { workspaceId: 'space', workspaceType: 'team', workspaceMemberId: 'member', role: 'owner', lifecycleState: 'active', memberStatus: 'active', permissions: { canShareProjects: true, canWriteSyncedFiles: true } } as WorkspaceCollabContext;
    const wire = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(`http://localhost${input}`, init);
      expect(request.headers.get('x-od-workspace-id')).toBe('space');
      expect(request.headers.get('x-od-workspace-member-id')).toBe('member');
      if (request.method === 'GET') return Response.json({ document: doc, raw });
      // Express parses this body only when the header survives the live wrapper.
      expect(request.headers.get('content-type')).toBe('application/json');
      const body = await request.json();
      expect(body).toMatchObject({ baseRaw: raw, startingPoint: false, document: { pageBudget: { mode: 'maximum', limit: 4, target: 3 } } });
      return Response.json({ document: body.document, raw: `${JSON.stringify(body.document)}\n` });
    });
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => wire(input, { ...init, headers: { 'x-od-analytics-session-id': 'session', ...init?.headers } }));
    const loaded = await loadBlockout('project', context);
    const edited = { ...loaded.document!, pageBudget: { mode: 'maximum' as const, limit: 4, target: 3 } };
    await expect(saveBlockout('project', edited, loaded.raw, context)).resolves.toContain('"target":3');
    expect(wire).toHaveBeenCalledTimes(2);
    expect(invalidateProjectFilesCache).toHaveBeenCalledWith('project', context);
  });
  it('uses the owned metadata API so imported folders never need hidden file access', async () => {
    const doc = createBlockoutDocument();
    const raw = JSON.stringify(doc);
    const handoff = { version: 1, type: 'blockout-update', id: 'update', action: 'request-proposals', createdAt: '2026-10-24', workspacePath: 'blockout/layout.json', workspaceRevision: 'revision', previousHandoffId: null, previousWorkspaceRevision: null, comparison: 'initial', snapshot: blockoutHandoffSnapshot(doc), changes: [] };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ document: doc, raw })).mockResolvedValueOnce(Response.json({ ok: true, handoff, path: 'blockouts/document-1/handoffs/update.blockout-update.json' })).mockResolvedValueOnce(Response.json({ version: 1, documents: [{ id: 'document-1', title: '' }] }));
    vi.stubGlobal('fetch', fetch);
    expect(await saveBlockout('project', doc, null)).toBe(raw);
    await saveBlockoutStartingPoint('project', doc, undefined, raw, { requestId: 'stable-intent', variantId: doc.activeVariantId, operation: { type: 'append-alternatives', count: 1, instruction: 'More room for text' } });
    expect(await listBlockoutDocuments('project')).toEqual([{ id: 'document-1', title: '' }]);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual(['/api/projects/project/blockout-documents/document-1', '/api/projects/project/blockout-documents/document-1/starting-point', '/api/projects/project/blockout-documents']);
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ document: doc, baseRaw: null });
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toMatchObject({ document: doc, baseRaw: raw, requestId: 'stable-intent', variantId: doc.activeVariantId, operation: { type: 'append-alternatives', count: 1, instruction: 'More room for text' } });
    expect(invalidateProjectFilesCache).toHaveBeenCalledWith('project', undefined);
  });
});
