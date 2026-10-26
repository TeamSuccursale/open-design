// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentPresentation, type ProjectDocument } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { ProjectDocumentsPanel } from '../../src/components/project-documents/ProjectDocumentsPanel';
import { createProjectDocument, listProjectDocuments, openProjectDocument, updateProjectDocument } from '../../src/providers/project-documents';

vi.mock('../../src/providers/project-documents', async (original) => ({ ...await original<typeof import('../../src/providers/project-documents')>(),createProjectDocument:vi.fn(),listProjectDocuments:vi.fn(),openProjectDocument:vi.fn(),updateProjectDocument:vi.fn() }));
vi.mock('../../src/providers/registry', () => ({openFolderDialog:vi.fn()}));
const report:ProjectDocument={id:'report',projectId:'parent',workspaceProjectId:'child',name:'Relazione B',kind:'document',workingDirectory:'C:/report',folderMode:'linked',availability:'available',conversationIds:['conversation'],createdAt:'now',updatedAt:'now',archivedAt:null};
beforeEach(() => { vi.mocked(listProjectDocuments).mockResolvedValue({documents:[report],selectedDocumentId:report.id});vi.mocked(updateProjectDocument).mockResolvedValue(report);vi.mocked(openProjectDocument).mockResolvedValue(report);vi.mocked(createProjectDocument).mockResolvedValue(report); });
afterEach(() => {cleanup();vi.resetAllMocks();});
function setup(readOnly=false) { const onOpen=vi.fn().mockResolvedValue(undefined),onClose=vi.fn();render(<I18nProvider initial="en"><ProjectDocumentsPanel projectId="parent" projectName="Antro" onOpen={onOpen} onClose={onClose} readOnly={readOnly}/></I18nProvider>);return {onOpen,onClose}; }

describe('project documents panel', () => {
  it('does not offer creation while the original document list is loading or failed, and retries the list', async () => {
    let fail!: (reason: Error) => void;
    vi.mocked(listProjectDocuments).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    setup();
    expect(screen.getByText('Loading documents…')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add document or design' }) as HTMLButtonElement).disabled).toBe(true);
    fail(new Error('temporary unavailable'));
    await screen.findByRole('button', { name: 'Retry' });
    expect((screen.getByRole('button', { name: 'Add document or design' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText(report.name);
    expect(createProjectDocument).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Add document or design' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('resumes a reserved creation instead of treating a pending save as an empty project', async () => {
    const request = { requestId: '727f708d-c5a5-46a8-bbaa-32de159fa399', name: 'Original request', kind: 'document' as const };
    vi.mocked(listProjectDocuments).mockResolvedValue({ documents: [], selectedDocumentId: null, pendingCreations: [{ requestId: request.requestId, documentId: 'reserved', name: request.name, startedAt: 'now', request }] });
    const view = setup();
    await screen.findByRole('button', { name: 'Resume creation' });
    expect((screen.getByRole('button', { name: 'Add document or design' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/Add the first one to begin/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resume creation' }));
    await waitFor(() => expect(view.onOpen).toHaveBeenCalledWith(report));
    expect(createProjectDocument).toHaveBeenCalledWith('parent', request, undefined);
  });
  it('does not create another document if opening the committed document fails', async () => {
    const view = setup(); view.onOpen.mockRejectedValueOnce(new Error('navigation failed'));
    fireEvent.click(await screen.findByRole('button', { name: 'Add document or design' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Keep this identity' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and open' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Create and open' }));
    await waitFor(() => expect(view.onOpen).toHaveBeenCalledTimes(2));
    expect(createProjectDocument).toHaveBeenCalledOnce();
    expect(vi.mocked(createProjectDocument).mock.calls[0]?.[1].requestId).toMatch(/^[a-f\d-]{36}$/);
  });
  it('shows pending registration instead of inviting a duplicate while the first Fast request runs', async () => {
    vi.mocked(listProjectDocuments).mockResolvedValue({ documents: [], selectedDocumentId: null });
    const onClose = vi.fn();
    const view = render(<I18nProvider initial="en"><ProjectDocumentsPanel projectId="parent" projectName="Fast" initialPreparationRunning onClose={onClose} onOpen={vi.fn()} /></I18nProvider>);
    await screen.findByText('Preparing the first document');
    expect(screen.queryByText(/Add the first one to begin/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Add document or design' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' })); expect(onClose).toHaveBeenCalledOnce();
    view.rerender(<I18nProvider initial="en"><ProjectDocumentsPanel projectId="parent" projectName="Fast" initialPreparationRunning={false} onClose={onClose} onOpen={vi.fn()} /></I18nProvider>);
    await screen.findByText(/Add the first one to begin/);
    expect((screen.getByRole('button', { name: 'Add document or design' }) as HTMLButtonElement).disabled).toBe(false);
    expect(createProjectDocument).not.toHaveBeenCalled();
  });
  it('enables intentional additional documents as soon as the first registration exists, even while the run continues', async () => {
    render(<I18nProvider initial="en"><ProjectDocumentsPanel projectId="parent" projectName="Fast" initialPreparationRunning onClose={vi.fn()} onOpen={vi.fn()} /></I18nProvider>);
    await screen.findByText(report.name);
    expect(screen.queryByText('Preparing the first document')).toBeNull();
    expect((screen.getByRole('button', { name: 'Add document or design' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('keeps first-document creation pending when the run settles with a required question, and releases it when no question remains', async () => {
    vi.mocked(listProjectDocuments).mockResolvedValue({ documents: [], selectedDocumentId: null });
    const props = { projectId:'parent',projectName:'Fast',onClose:vi.fn(),onOpen:vi.fn() };
    const view = render(<I18nProvider initial="en"><ProjectDocumentsPanel {...props} initialPreparationRunning /></I18nProvider>);
    await screen.findByText('Preparing the first document');
    view.rerender(<I18nProvider initial="en"><ProjectDocumentsPanel {...props} initialPreparationAwaitingAnswer /></I18nProvider>);
    await screen.findByText('Complete preparation in chat');
    expect(screen.queryByText(/Add the first one to begin/)).toBeNull();
    expect((screen.getByRole('button', { name:'Add document or design' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<I18nProvider initial="en"><ProjectDocumentsPanel {...props} /></I18nProvider>);
    await screen.findByText(/Add the first one to begin/);
    expect((screen.getByRole('button', { name:'Add document or design' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('opens the named document workspace and selects it explicitly', async () => {
    const view=setup();fireEvent.click(await screen.findByRole('button',{name:'Open document'}));
    await waitFor(() => expect(view.onOpen).toHaveBeenCalledWith(report));
    expect(openProjectDocument).toHaveBeenCalledWith('parent','report',undefined);expect(view.onClose).toHaveBeenCalledOnce();
  });
  it('opens read-only documents without mutating collection selection', async () => {
    const view=setup(true);fireEvent.click(await screen.findByRole('button',{name:'Open document'}));await waitFor(() => expect(view.onOpen).toHaveBeenCalled());expect(openProjectDocument).not.toHaveBeenCalled();expect(updateProjectDocument).not.toHaveBeenCalled();
  });
  it('routes to the document conversation returned by authorized open rather than its preparation chat', async () => {
    const prepared={...report,conversationIds:['editing-chat'],preparationConversationIds:['conversation']};
    vi.mocked(openProjectDocument).mockResolvedValue(prepared);
    const view=setup();fireEvent.click(await screen.findByRole('button',{name:'Open document'}));
    await waitFor(() => expect(view.onOpen).toHaveBeenCalledWith(prepared));
  });
  it('creates a technical document with a separate explicit folder and leaves editorial questions to chat', async () => {
    setup();fireEvent.click(await screen.findByRole('button',{name:'Add document or design'}));
    fireEvent.change(screen.getByRole('textbox',{name:'Name'}),{target:{value:'Graphic booklet B'}});
    fireEvent.click(screen.getByRole('radio',{name:'Link an existing folder'}));
    fireEvent.change(screen.getByRole('textbox',{name:'Document folder'}),{target:{value:'C:/booklet'}});
    fireEvent.click(screen.getByRole('button',{name:'Create and open'}));
    await waitFor(() => expect(createProjectDocument).toHaveBeenCalledWith('parent',expect.objectContaining({name:'Graphic booklet B',kind:'document',location:{mode:'link-existing',path:'C:/booklet',authorized:true},presentation:createDocumentPresentation('Graphic booklet B')}),undefined));
    expect(screen.queryByRole('combobox',{name:'Header'})).toBeNull();
  });
  it('validates every editorial choice with a single save and does not save an incomplete draft', async () => {
    setup();fireEvent.click(await screen.findByRole('button',{name:'Header, cover and page numbering'}));
    expect(screen.queryByRole('button',{name:'Confirm these settings'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Save changes'}));expect(screen.getByRole('alert')).toBeTruthy();expect(updateProjectDocument).not.toHaveBeenCalled();
    for(const name of ['Header','Footer','Cover page','Page numbers'])fireEvent.change(screen.getByRole('combobox',{name}),{target:{value:'no'}});
    fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
    await waitFor(() => expect(updateProjectDocument).toHaveBeenCalledWith('parent','report',{presentation:expect.objectContaining({status:'confirmed',header:false,footer:false,cover:false,pageNumbers:false})},undefined));
  });
  it('keeps already saved settings inactive until a choice changes', async () => {
    vi.mocked(listProjectDocuments).mockResolvedValue({documents:[{...report,presentation:{...createDocumentPresentation(report.name),status:'confirmed',header:false,footer:true,cover:false,pageNumbers:true,numberingStart:1,confirmedAt:'2026-10-24T00:00:00.000Z'}}],selectedDocumentId:report.id});
    setup();fireEvent.click(await screen.findByRole('button',{name:'Header, cover and page numbering'}));
    expect((screen.getByRole('button',{name:'Save changes'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('combobox',{name:'Header'}),{target:{value:'yes'}});
    expect((screen.getByRole('button',{name:'Save changes'}) as HTMLButtonElement).disabled).toBe(false);
    expect(updateProjectDocument).not.toHaveBeenCalled();
  });
  it('removes only a confirmed association and offers archived links for recovery', async () => {
    setup();fireEvent.click(await screen.findByRole('button',{name:'Remove from project'}));expect(updateProjectDocument).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Remove link'}));await waitFor(() => expect(updateProjectDocument).toHaveBeenCalledWith('parent','report',{archived:true},undefined));
  });
});
