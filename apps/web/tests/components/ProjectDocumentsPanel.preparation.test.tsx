// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentPresentation, type ProjectDocument } from '@open-design/contracts';
import { ProjectDocumentsPanel } from '../../src/components/project-documents/ProjectDocumentsPanel';
import { useProjectDocuments } from '../../src/components/project-documents/useProjectDocuments';
import { openProjectDocument } from '../../src/providers/project-documents';
import { I18nProvider } from '../../src/i18n';

vi.mock('../../src/components/project-documents/useProjectDocuments', () => ({ useProjectDocuments: vi.fn() }));
vi.mock('../../src/providers/project-documents', () => ({ openProjectDocument: vi.fn(), createProjectDocument: vi.fn(), updateProjectDocument: vi.fn() }));
vi.mock('../../src/providers/registry', () => ({ openFolderDialog: vi.fn() }));
const draft: ProjectDocument = { id: 'report', projectId: 'project', workspaceProjectId: 'project', name: 'Relazione', kind: 'document', workingDirectory: 'C:/demo', folderMode: 'linked', availability: 'available', conversationIds: ['editing-chat'], preparationConversationIds: ['preparation-chat'], presentation: createDocumentPresentation('Relazione'), createdAt: '2026-10-24T08:00:00Z', updatedAt: '2026-10-24T08:00:00Z', archivedAt: null };
let document: ProjectDocument;
beforeEach(() => {
  document = structuredClone(draft);
  vi.mocked(useProjectDocuments).mockImplementation(() => ({ documents: [document], selectedDocumentId: document.id, loading: false, error: false, refresh: vi.fn() }));
  vi.mocked(openProjectDocument).mockImplementation(async () => structuredClone(document));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function openPanel() {
  const onOpen = vi.fn().mockResolvedValue(undefined);
  render(<I18nProvider initial="en"><ProjectDocumentsPanel projectId="project" projectName="Project" onClose={vi.fn()} onOpen={onOpen} /></I18nProvider>);
  return onOpen;
}

describe('opening a document at its current preparation stage', () => {
  it('returns an unfinished brief to its existing preparation conversation, without presenting a header/footer asset as its page', async () => {
    document.entryFile = 'header-footer/report/preview.html';
    const onOpen = openPanel();
    expect(screen.getByText('Brief in preparation')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue the brief' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce());
    expect(onOpen.mock.calls[0]![0]).toMatchObject({ conversationIds: ['preparation-chat'], entryFile: undefined });
    expect(openProjectDocument).toHaveBeenCalledWith('project', 'report', undefined);
  });

  it('opens the own editing conversation and artifact once the document brief is confirmed', async () => {
    document.presentation = { ...document.presentation!, status: 'confirmed', header: false, footer: false, cover: false, pageNumbers: false };
    document.entryFile = 'documents/report/blockout-comparison.html';
    const onOpen = openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce());
    expect(onOpen.mock.calls[0]![0]).toMatchObject({ conversationIds: ['editing-chat'], entryFile: 'documents/report/blockout-comparison.html' });
  });

  it('keeps an independently linked document in its own workspace even when the parent has a preparation chat', async () => {
    document.workspaceProjectId = 'independent-workspace';
    const onOpen = openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce());
    expect(onOpen.mock.calls[0]![0]).toMatchObject({ workspaceProjectId: 'independent-workspace', conversationIds: ['editing-chat'] });
  });
});
