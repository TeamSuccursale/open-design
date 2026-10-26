// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockoutHandoffSnapshot, createBlockoutDocument, createBlockoutPage, type BlockoutDocument } from '@open-design/contracts';
import { BlockoutWorkspace } from '../../src/components/blockout/BlockoutWorkspace';
import { I18nProvider } from '../../src/i18n';
import { listBlockoutDocuments, loadBlockout, saveBlockout, saveBlockoutStartingPoint } from '../../src/providers/blockout';
import { fetchDocumentOverviewReading } from '../../src/providers/document-overview-reading';
import { fetchProjectIntake } from '../../src/providers/project-intake';

vi.mock('../../src/providers/blockout', () => ({ listBlockoutDocuments: vi.fn(), loadBlockout: vi.fn(), saveBlockout: vi.fn(), saveBlockoutStartingPoint: vi.fn() }));
vi.mock('../../src/providers/blockout-design', () => ({ loadBlockoutDesign: async () => ({ projectId: 'project', state: { version: 1, documentId: 'document-1', applied: null, pending: [], sourceChanged: false, pendingChanges: false } }), loadBlockoutDesignUnderlay: vi.fn() }));
vi.mock('../../src/providers/document-overview-reading', () => ({ fetchDocumentOverviewReading: vi.fn() }));
vi.mock('../../src/providers/project-intake', () => ({ fetchProjectIntake: vi.fn() }));
vi.mock('../../src/providers/registry', () => ({ projectRawUrl: (_project: string, file: string) => `/raw/${file}` }));

let stored: BlockoutDocument;
let revision: string;
function documentFixture(pageCount = 4): BlockoutDocument {
  const document = createBlockoutDocument();
  document.title = 'Four-page engineering report';
  document.activeVariantId = 'proposal-a';
  document.pageBudget = { mode: 'maximum', limit: 4, target: 4, source: 'Disciplinare, p. 8' };
  document.variants = ['a', 'b', 'c'].map((letter) => ({
    id: `proposal-${letter}`, label: `Proposal ${letter.toUpperCase()}`,
    pages: Array.from({ length: pageCount }, (_, index) => ({
      ...createBlockoutPage(`${letter}-${index + 1}`, `Page ${index + 1}`), expectation: `Existing material group ${index + 1}`,
    })),
  }));
  document.variants[0]!.pages[0]!.blocks = [{
    id: 'drawing', label: 'Structural drawing', kind: 'drawing', box: { x: 10, y: 15, width: 60, height: 40, rotation: 0 },
    lockRatio: false, images: [], references: [], expectation: 'Preserve the engineer’s annotations', feedback: 'Keep this original legend', flexibility: 'guided',
  }];
  return document;
}
function setup() {
  const onClose = vi.fn(), onUseBrief = vi.fn();
  const rendered = render(<I18nProvider initial="en"><BlockoutWorkspace projectId="project" question={null} onClose={onClose} onUseBrief={onUseBrief} /></I18nProvider>);
  return { ...rendered, onClose, onUseBrief };
}
function pageControlsAbsent() {
  expect(screen.queryByRole('button', { name: 'Add block' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Duplicate block' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete block' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: 'Auto snap' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Zoom' })).toBeNull();
  expect(screen.queryByTestId('blockout-paper')).toBeNull();
}
beforeEach(() => {
  localStorage.clear(); stored = documentFixture(); revision = 'revision-1';
  vi.mocked(listBlockoutDocuments).mockImplementation(async () => [{ id: stored.documentId, title: stored.title }]);
  vi.mocked(loadBlockout).mockImplementation(async () => ({ document: structuredClone(stored), raw: revision }));
  vi.mocked(saveBlockout).mockImplementation(async (_projectId, document, baseRaw) => {
    if (baseRaw !== revision) throw new Error('blockout.conflict');
    stored = structuredClone(document); revision = `${revision}-saved`; return revision;
  });
  vi.mocked(saveBlockoutStartingPoint).mockImplementation(async (_project, document) => ({
    path: `blockouts/${document.documentId}/handoffs/updated.blockout-update.json`,
    handoff: { version: 1, type: 'blockout-update', id: 'updated', action: document.approval ? 'develop-design' : 'request-proposals', createdAt: '2026-10-24', workspacePath: 'blockout/layout.json', workspaceRevision: revision, previousHandoffId: null, previousWorkspaceRevision: null, comparison: 'initial', snapshot: blockoutHandoffSnapshot(document), changes: [] },
  }));
  vi.mocked(fetchProjectIntake).mockResolvedValue({ version: 1, documents: [], assets: [] });
  vi.mocked(fetchDocumentOverviewReading).mockResolvedValue({
    version: 1, id: 'read-1', status: 'complete', fingerprint: 'context', model: 'gpt-6-luna', sourceScope: 'saved-quick-scan-excerpts',
    message: 'Saved excerpts read', coverage: 'Two selected source excerpts', sources: [], workers: [], warnings: [],
    createdAt: '2026-10-23T12:00:00Z', updatedAt: '2026-10-23T12:00:00Z',
  });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('Blockout overview to page-editing flow', () => {
  it('retains the edited original when inspecting another proposal and returning', async () => {
    setup(); fireEvent.click(await screen.findByRole('button', { name: 'Edit Page 1 · Proposal A' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'What should go here?' }), { target: { value: 'Keep this page feedback on proposal A.' } });
    const picker = screen.getByRole('combobox', { name: 'Proposal' });
    fireEvent.change(picker, { target: { value: 'proposal-b' } });
    await waitForAutosave();
    await waitFor(() => expect(saveBlockout).toHaveBeenCalled());
    expect(stored.variants[0]!.pages[0]!.expectation).toBe('Keep this page feedback on proposal A.');
    fireEvent.change(picker, { target: { value: 'proposal-a' } });
    expect((screen.getByRole('textbox', { name: 'What should go here?' }) as HTMLTextAreaElement).value).toBe('Keep this page feedback on proposal A.');
  });
  it('keeps page actions outside the scrollable thumbnails, preserves paper size, and undoes a deletion', async () => {
    for (const variant of stored.variants) for (const page of variant.pages) { page.widthMm = 420; page.heightMm = 297; }
    const originals = structuredClone(stored.variants.slice(1));
    setup(); fireEvent.click(await screen.findByRole('button', { name: 'Edit Page 1 · Proposal A' }));
    const actions = screen.getByRole('toolbar', { name: 'Page controls' });
    expect(actions.parentElement).toBe(screen.getByRole('toolbar', { name: 'Block controls' }).parentElement);
    expect(within(actions).getByRole('button', { name: 'Duplicate page' }).getAttribute('title')).toBe('Duplicate page');
    expect(screen.getByRole('navigation', { name: 'Pages' }).contains(within(actions).getByRole('button', { name: 'Delete page' }))).toBe(false);
    fireEvent.change(screen.getByRole('combobox', { name: 'Go to page' }), { target: { value: 'a-4' } });
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Page 4');
    expect(screen.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(actions).getByRole('button', { name: 'Add page' }));
    expect((screen.getByRole('spinbutton', { name: 'Width (mm)' }) as HTMLInputElement).value).toBe('420');
    expect((screen.getByRole('spinbutton', { name: 'Height (mm)' }) as HTMLInputElement).value).toBe('297');
    const addedId = (screen.getByRole('combobox', { name: 'Go to page' }) as HTMLSelectElement).value;
    fireEvent.click(within(actions).getByRole('button', { name: 'Delete page' }));
    expect((screen.getByRole('combobox', { name: 'Go to page' }) as HTMLSelectElement).value).toBe('a-4');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(screen.getByRole('combobox', { name: 'Go to page' })).getAllByRole('option')).toHaveLength(5);
    fireEvent.change(screen.getByRole('combobox', { name: 'Go to page' }), { target: { value: addedId } });
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(within(screen.getByRole('combobox', { name: 'Go to page' })).getAllByRole('option')).toHaveLength(4);
    await waitForAutosave();
    await waitFor(() => expect(saveBlockout).toHaveBeenCalled());
    expect(stored.variants[0]!.pages).toHaveLength(4); expect(stored.variants.slice(1)).toEqual(originals);
  });

  it('opens a named alternative, keeps its source intact, and sends the edited copy as the starting point', async () => {
    const original = structuredClone(stored.variants[0]);
    const view = setup(); fireEvent.click(await screen.findByRole('button', { name: 'Edit Page 1 · Proposal A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate to edit' }));
    const picker = screen.getByRole('combobox', { name: 'Proposal' }) as HTMLSelectElement, copiedId = picker.value;
    expect(copiedId).not.toBe(original!.id);
    expect(within(picker).getByRole('option', { name: 'Copy of Proposal A' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'What should go here?' }), { target: { value: 'Test the copied page with a larger drawing.' } });
    fireEvent.change(picker, { target: { value: original!.id } });
    expect((screen.getByRole('textbox', { name: 'What should go here?' }) as HTMLTextAreaElement).value).toBe(original!.pages[0]!.expectation);
    fireEvent.change(picker, { target: { value: copiedId } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit in chat' }));
    await waitFor(() => expect(view.onUseBrief).toHaveBeenCalledOnce());
    const startingPoint = vi.mocked(saveBlockoutStartingPoint).mock.calls.at(-1)![1];
    expect(startingPoint.activeVariantId).toBe(copiedId);
    expect(startingPoint.variants.find((item) => item.id === copiedId)!.pages[0]!.expectation).toContain('larger drawing');
    expect(startingPoint.variants[0]).toEqual(original); expect(startingPoint.approval).toBeUndefined();
    expect(view.onUseBrief.mock.calls[0]![2]).toBe('blockout');
  });

  it('approves only the copied proposal for the graphic-design handoff', async () => {
    const view = setup(); fireEvent.click(await screen.findByRole('button', { name: 'Edit Page 1 · Proposal A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate to edit' }));
    const copyId = (screen.getByRole('combobox', { name: 'Proposal' }) as HTMLSelectElement).value;
    fireEvent.click(screen.getByRole('button', { name: 'Move to design' }));
    expect(view.onUseBrief).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: /accept.*graphic design/i }));
    fireEvent.click(screen.getByRole('button', { name: /^(next|submit|continue)$/i }));
    await waitFor(() => expect(view.onUseBrief).toHaveBeenCalledOnce());
    expect(stored.approval?.variantId).toBe(copyId);
    expect(vi.mocked(saveBlockoutStartingPoint).mock.calls.at(-1)![1].activeVariantId).toBe(copyId);
    expect(view.onUseBrief.mock.calls[0]![2]).toBe('design');
  });

  it('opens a multipage document in the overview and reveals page tools only after opening a page', async () => {
    setup();
    await screen.findByRole('region', { name: 'Proposal A' });
    expect(screen.getAllByRole('article')).toHaveLength(12);
    pageControlsAbsent();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Page 3 · Proposal B' }));
    expect(screen.getByTestId('blockout-paper')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Page 3');
    expect(screen.getAllByRole('button', { name: 'Add block' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Duplicate block' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete block' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Auto snap' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Zoom' })).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Proposal' }) as HTMLSelectElement).value).toBe('proposal-b');
    fireEvent.click(screen.getByRole('button', { name: 'All proposals' }));
    expect(screen.getByRole('region', { name: 'Proposal C' })).toBeTruthy();
    pageControlsAbsent();
  });

  it('keeps document management and allowance controls behind explicit disclosures while the count stays visible', async () => {
    setup(); await screen.findByRole('region', { name: 'Proposal A' });
    // jsdom exposes descendants of closed details to role queries. The native
    // open state is the browser's disclosure/visibility contract here.
    const documentSettings = screen.getByText('Document settings').closest('details')!;
    expect(documentSettings.open).toBe(false);
    expect(documentSettings.contains(screen.getByRole('textbox', { name: 'Document name' }))).toBe(true);
    expect(documentSettings.contains(screen.getByRole('button', { name: 'New document' }))).toBe(true);
    const allowance = screen.getByRole('region', { name: 'Page allowance' });
    expect(within(screen.getByLabelText('Proposal controls')).getByText('4 / 4 counted pages').closest('details')).toBeNull();
    expect(documentSettings.contains(allowance)).toBe(true);
    const allowanceSettings = within(allowance).getByText('Adjust allowance').closest('details')!;
    expect(allowanceSettings.open).toBe(true);
    expect(allowanceSettings.contains(within(allowance).getByRole('combobox', { name: 'Allowance rule' }))).toBe(true);
    expect(allowanceSettings.contains(within(allowance).getByRole('spinbutton', { name: 'Allowed pages' }))).toBe(true);
    fireEvent.click(screen.getByText('Document settings'));
    expect(documentSettings.open).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Document name' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New document' })).toBeTruthy();
    fireEvent.click(screen.getByText('Document settings'));
    expect(documentSettings.open).toBe(false);
    fireEvent.click(screen.getByText('Document settings'));
    expect(documentSettings.open).toBe(true);
    expect(within(allowance).getByRole('combobox', { name: 'Allowance rule' })).toBeTruthy();
    expect((within(allowance).getByRole('spinbutton', { name: 'Allowed pages' }) as HTMLInputElement).value).toBe('4');
    expect((within(allowance).getByRole('spinbutton', { name: 'Planning target' }) as HTMLInputElement).value).toBe('4');
  });

  it('moves a block, edits its geometry, saves and reopens the same edited document', async () => {
    const first = setup(); await screen.findByRole('region', { name: 'Proposal A' });
    fireEvent.click(screen.getByRole('button', { name: 'Select Structural drawing on Page 1 · Proposal A' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Destination page' }), { target: { value: 'a-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move block' }));
    expect(within(screen.getByTestId('overview-page-proposal-a-a-1')).queryByRole('button', { name: /Select Structural drawing/ })).toBeNull();
    expect(within(screen.getByTestId('overview-page-proposal-a-a-2')).getByRole('button', { name: /Select Structural drawing/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Page 2 · Proposal A' }));
    fireEvent.focus(screen.getByTestId('blockout-block-drawing'));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'X (%)' }), { target: { value: '23.5' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Width (%)' }), { target: { value: '42' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Feedback for the agent' }), { target: { value: 'Keep this edited alignment and original legend.' } });
    await waitForAutosave();
    await waitFor(() => expect(saveBlockout).toHaveBeenCalledTimes(1));
    await waitForAutosave();
    expect(stored.variants[0]!.pages[0]!.blocks).toHaveLength(0);
    expect(stored.variants[0]!.pages[1]!.blocks[0]).toMatchObject({ id: 'drawing', box: { x: 23.5, width: 42 }, feedback: 'Keep this edited alignment and original legend.' });
    expect(saveBlockoutStartingPoint).not.toHaveBeenCalled(); expect(first.onUseBrief).not.toHaveBeenCalled();
    first.unmount(); setup();
    await screen.findByRole('region', { name: 'Proposal A' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Page 2 · Proposal A' }));
    fireEvent.focus(screen.getByTestId('blockout-block-drawing'));
    expect((screen.getByRole('spinbutton', { name: 'X (%)' }) as HTMLInputElement).value).toBe('23.5');
    expect((screen.getByRole('spinbutton', { name: 'Width (%)' }) as HTMLInputElement).value).toBe('42');
    expect((screen.getByRole('textbox', { name: 'Feedback for the agent' }) as HTMLTextAreaElement).value).toBe('Keep this edited alignment and original legend.');
  });

  it.each([{ count: 2, warning: '2 pages still to allocate' }, { count: 5, warning: '1 pages over the allowance' }])('blocks formal acceptance at $count counted pages but permits saving the draft', async ({ count, warning }) => {
    stored = documentFixture(count);
    const props = setup(); await screen.findByRole('region', { name: 'Proposal A' });
    expect(screen.getByText(warning)).toBeTruthy();
    const accept = screen.getByRole('button', { name: 'Move to design' }) as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    expect(accept.title).toBe('Resolve the page allowance warning before accepting this structure.');
    fireEvent.click(accept);
    expect(screen.queryByRole('radio', { name: /accept.*graphic design/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Page 1 · Proposal A' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Feedback for the agent' }), { target: { value: 'Retain this draft while the page allowance is resolved.' } });
    await waitForAutosave();
    await waitFor(() => expect(saveBlockout).toHaveBeenCalledTimes(1));
    expect(stored.variants[0]!.pages).toHaveLength(count);
    expect(stored.pageBudget).toMatchObject({ mode: 'maximum', limit: 4, target: 4 });
    expect(stored.approval).toBeUndefined();
    expect(props.onUseBrief).not.toHaveBeenCalled(); expect(props.onClose).not.toHaveBeenCalled();
    expect(saveBlockoutStartingPoint).not.toHaveBeenCalled();
  });
});

async function waitForAutosave() { await waitFor(() => expect(screen.getByText('All changes saved')).toBeTruthy(), { timeout: 2500 }); }
