// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentPresentation, type ProjectDocument, type WorkspaceCollabContext } from '@open-design/contracts';
import { createProjectDocument, listProjectDocuments, openProjectDocument, updateProjectDocument, PROJECT_DOCUMENTS_UPDATED_EVENT } from '../../src/providers/project-documents';

const document: ProjectDocument = { id:'report-b',projectId:'parent',workspaceProjectId:'child',name:'Relazione B',kind:'document',workingDirectory:'C:/report',folderMode:'linked',availability:'available',conversationIds:['chat'],createdAt:'2026-10-24T08:00:00.000Z',updatedAt:'2026-10-24T08:00:00.000Z',archivedAt:null };
const context = { workspaceId:'workspace',workspaceType:'personal',workspaceMemberId:'member',role:'owner',lifecycleState:'active',memberStatus:'active',permissions:{canShareProjects:true,canWriteSyncedFiles:true} } as WorkspaceCollabContext;
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('project documents HTTP boundary', () => {
  it('opens the document through the authorized endpoint and uses the returned editing conversation', async () => {
    const opened={...document,conversationIds:['own-document-chat']};
    const fetch=vi.fn().mockResolvedValue(Response.json({document:opened,selectedDocumentId:document.id}));vi.stubGlobal('fetch',fetch);
    expect(await openProjectDocument('parent','report-b',context)).toEqual(opened);
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/projects/parent/documents/report-b/open');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({method:'POST',headers:{'x-od-workspace-member-id':'member'}});
  });
  it('loads archived associations for recovery while retaining authority and abort signal', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ documents:[document],selectedDocumentId:document.id })); vi.stubGlobal('fetch',fetch);
    const signal = new AbortController().signal;
    expect((await listProjectDocuments('project with spaces',context,signal)).documents[0]?.workspaceProjectId).toBe('child');
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/projects/project%20with%20spaces/documents?includeArchived=true');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({method:'GET',cache:'no-store',signal,headers:{'x-od-workspace-member-id':'member'}});
  });
  it('creates a named linked document without attaching its images or moving files', async () => {
    const fetch=vi.fn().mockResolvedValue(Response.json({document}));vi.stubGlobal('fetch',fetch);
    const changed=vi.fn();window.addEventListener(PROJECT_DOCUMENTS_UPDATED_EVENT,changed);
    try {
      const input = {name:'Relazione B',kind:'document' as const,location:{mode:'link-existing' as const,path:'C:/report',authorized:true as const},presentation:createDocumentPresentation('Relazione B')};
      await createProjectDocument('parent',input,context);
      expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual(input);
      expect(changed).toHaveBeenCalledOnce();
      expect((changed.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({projectId:'parent',documentId:'report-b'});
    } finally {window.removeEventListener(PROJECT_DOCUMENTS_UPDATED_EVENT,changed);}
  });
  it('archives only the association and emits no success event on a rejected update', async () => {
    const fetch=vi.fn().mockResolvedValue(Response.json({error:{code:'PROJECT_DOCUMENT_CONFLICT'}},{status:409}));vi.stubGlobal('fetch',fetch);
    const changed=vi.fn();window.addEventListener(PROJECT_DOCUMENTS_UPDATED_EVENT,changed);
    try {
      await expect(updateProjectDocument('parent','report-b',{archived:true})).rejects.toMatchObject({status:409,code:'PROJECT_DOCUMENT_CONFLICT'});
      expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({archived:true});expect(changed).not.toHaveBeenCalled();
    } finally {window.removeEventListener(PROJECT_DOCUMENTS_UPDATED_EVENT,changed);}
  });
  it('rejects malformed document records instead of putting them into navigation', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({documents:[{name:'bad'}],selectedDocumentId:null})));
    await expect(listProjectDocuments('parent')).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
});
