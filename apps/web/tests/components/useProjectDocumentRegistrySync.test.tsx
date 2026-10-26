// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentPresentation, type ProjectDocument } from '@open-design/contracts';
import { useProjectDocuments } from '../../src/components/project-documents/useProjectDocuments';
import { useProjectDocumentRegistrySync } from '../../src/components/project-documents/useProjectDocumentRegistrySync';
import { listProjectDocuments } from '../../src/providers/project-documents';
vi.mock('../../src/providers/project-documents', () => ({ listProjectDocuments: vi.fn(), PROJECT_DOCUMENTS_UPDATED_EVENT:'registry-updated' }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
const document: ProjectDocument = { id:'report',projectId:'p',workspaceProjectId:'p',name:'Report',kind:'document',folderMode:'managed',workingDirectory:'C:/report',availability:'available',conversationIds:['chat'],createdAt:'now',updatedAt:'now',archivedAt:null,presentation:createDocumentPresentation('Report') };

describe('native document registry synchronization outside the drawer', () => {
  it('discovers the first CLI-created document and its confirmed presentation at settlement without a browser registration event', async () => {
    vi.useFakeTimers();
    let documents: ProjectDocument[] = [];
    vi.mocked(listProjectDocuments).mockImplementation(async () => ({ documents,selectedDocumentId:documents[0]?.id ?? null }));
    const view = renderHook(({ running }) => {
      const library = useProjectDocuments('p');
      useProjectDocumentRegistrySync('p:chat',running,!library.documents.length,library.refresh);
      return library;
    }, { initialProps:{running:true} });
    await act(async () => {});
    expect(view.result.current.documents).toEqual([]);
    documents = [document];
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(view.result.current.documents).toHaveLength(1);
    expect(view.result.current.documents[0]?.presentation?.status).toBe('draft');
    documents = [{...document,presentation:{...document.presentation!,status:'confirmed',header:true,footer:true,cover:false,pageNumbers:true,confirmedAt:'now'}}];
    view.rerender({running:false});
    await act(async () => {});
    expect(view.result.current.documents[0]?.presentation?.status).toBe('confirmed');
    expect(view.result.current.documents[0]?.presentation?.header).toBe(true);
  });
  it('bounds empty active polling and stops when a document exists, the run settles, or authority changes', () => {
    vi.useFakeTimers(); const refresh = vi.fn();
    const view = renderHook(({scope,running,empty}) => useProjectDocumentRegistrySync(scope,running,empty,refresh), {initialProps:{scope:'p:chat',running:true,empty:true}});
    act(() => vi.advanceTimersByTime(600_000));
    expect(refresh).toHaveBeenCalledTimes(73);
    view.rerender({scope:'p:chat',running:true,empty:false});
    const count = refresh.mock.calls.length; act(() => vi.advanceTimersByTime(20_000)); expect(refresh).toHaveBeenCalledTimes(count);
    view.rerender({scope:'p:chat',running:false,empty:false});
    expect(refresh).toHaveBeenCalledTimes(count+1);
    view.rerender({scope:'other:chat',running:false,empty:true});
    act(() => vi.advanceTimersByTime(20_000)); expect(refresh).toHaveBeenCalledTimes(count+1);
  });
  it('does not poll an idle required-question phase or disabled read scope', () => {
    vi.useFakeTimers(); const refresh = vi.fn();
    const view = renderHook(({enabled}) => useProjectDocumentRegistrySync('p:chat',false,true,refresh,enabled), {initialProps:{enabled:true}});
    act(() => vi.advanceTimersByTime(600_000)); expect(refresh).not.toHaveBeenCalled();
    view.rerender({enabled:false}); expect(refresh).not.toHaveBeenCalled();
  });
  it('refreshes a terminal run discovered on reattachment once per stable identity', () => {
    const refresh = vi.fn();
    const view = renderHook(({runId}) => useProjectDocumentRegistrySync('p:chat',false,true,refresh,true,runId), {initialProps:{runId:'completed-run'}});
    expect(refresh).toHaveBeenCalledOnce();
    view.rerender({runId:'completed-run'}); expect(refresh).toHaveBeenCalledOnce();
    view.rerender({runId:'next-completed-run'}); expect(refresh).toHaveBeenCalledTimes(2);
  });
});
