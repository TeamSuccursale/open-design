// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createBlockoutDocument, createBlockoutPage } from '@open-design/contracts';
import { BlockoutComparisonPreview } from '../../src/components/blockout/BlockoutFilePreview';
import { ChatComposer } from '../../src/components/ChatComposer';
import { I18nProvider } from '../../src/i18n';
import { flushMounts } from '../helpers/lexical-composer';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

it('opens a Fast working-chat child comparison, edits its exact third page, saves to that child, and reopens without chat', async () => {
  let document = createBlockoutDocument(), revision = 'child-revision-1';
  document.documentId = 'registered-report'; document.title = 'Three-page report';
  document.variants[0]!.label = 'Continuous reading';
  document.variants[0]!.pages = [1, 2, 3].map((index) => ({ ...createBlockoutPage(`page-${index}`, `Page ${index}`), blocks: [{ id: `body-${index}`, label: `Body ${index}`, kind: 'text' as const, box: { x: 10, y: 15, width: 80, height: 60, rotation: 0 }, lockRatio: false, expectation: '', feedback: '', flexibility: 'guided' as const, images: [], references: [] }] }));
  const entryFile = 'documents/three-page-report/blockout-comparison.html';
  const registration = { id: document.documentId, blockoutDocumentId: document.documentId, projectId: 'fast-parent', workspaceProjectId: 'child', name: document.title, workingDirectory: 'C:/test/report', kind: 'document', folderMode: 'managed', availability: 'available', conversationIds: [], entryFile, createdAt: 'today', updatedAt: 'today', archivedAt: null };
  const writes: string[] = [], onSend = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/projects/fast-parent/documents') return Response.json({ documents: [registration], selectedDocumentId: registration.id });
    if (url === `/api/projects/fast-parent/documents/${registration.id}`) return Response.json({ document: registration });
    if (url === '/api/projects/fast-parent/blockout-documents') return Response.json({ version: 1, documents: [{ id: 'document-1', title: '' }] });
    if (url === `/api/projects/fast-parent/blockout-documents/${registration.id}`) return init?.method === 'PUT'
      ? Response.json({ error: { code: 'DOCUMENT_WORKSPACE_REQUIRED' } }, { status: 409 }) : Response.json({ document: null, raw: null });
    if (url === `/api/projects/child/blockout-documents/${registration.id}`) {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)); expect(body.baseRaw).toBe(revision);
        writes.push(url); document = structuredClone(body.document); revision += '-saved';
      }
      return Response.json({ document, raw: revision });
    }
    if (url.endsWith('/intake')) return Response.json({ version: 1, documents: [], assets: [] });
    if (url.endsWith('/references')) return Response.json({ references: [] });
    if (url === '/api/mcp/servers') return Response.json({ servers: [], templates: [] });
    if (url === '/api/plugins') return Response.json({ plugins: [] });
    if (url === '/api/skills') return Response.json({ skills: [] });
    return Response.json({});
  }));
  render(<I18nProvider initial="en"><BlockoutComparisonPreview projectId="fast-parent" path={entryFile} /><ChatComposer projectId="fast-parent" projectFiles={[]} streaming={false} documentPreparationPending blockoutNavigationAvailable onSend={onSend} onStop={vi.fn()} onEnsureProject={async () => 'fast-parent'} /></I18nProvider>);
  await flushMounts();
  fireEvent.click(await screen.findByRole('button', { name: 'Preview Page 3 · Continuous reading' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Edit this page’s composition' }));
  const paper = await screen.findByTestId('blockout-paper');
  expect(paper.getAttribute('aria-label')).toBe('Page 3');
  fireEvent.focus(screen.getByTestId('blockout-block-body-3'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Engineer closing notes' } });
  await waitForAutosave();
  await within(screen.getByRole('dialog', { name: 'Blockout workspace' })).findByText('All changes saved');
  expect(document.variants[0]!.pages[2]!.blocks[0]!.label).toBe('Engineer closing notes');
  expect(document.variants[0]!.pages[0]!.blocks[0]!.label).toBe('Body 1');
  fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
  await waitFor(() => expect(screen.queryByTestId('blockout-paper')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Edit page: Continuous reading · Page 3' }));
  await screen.findByTestId('blockout-block-body-3');
  fireEvent.focus(screen.getByTestId('blockout-block-body-3'));
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Engineer closing notes');
  expect(writes).toHaveLength(2); // Choosing the proposal and saving the edit.
  expect(onSend).not.toHaveBeenCalled();
  expect(document.approval).toBeUndefined();
});

async function waitForAutosave() { await waitFor(() => expect(screen.getByText('All changes saved')).toBeTruthy(), { timeout: 2500 }); }
