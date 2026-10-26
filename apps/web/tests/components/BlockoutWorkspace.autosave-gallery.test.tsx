// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blockoutHandoffSnapshot, createBlockoutDocument, type BlockoutDocument, type IntakeAsset } from '@open-design/contracts';
import { BlockoutWorkspace } from '../../src/components/blockout/BlockoutWorkspace';
import { BLOCKOUT_GALLERY_DRAG } from '../../src/components/blockout/BlockoutGalleryDrawer';
import { I18nProvider } from '../../src/i18n';
import { listBlockoutDocuments, loadBlockout, saveBlockout, saveBlockoutStartingPoint } from '../../src/providers/blockout';
import { fetchProjectIntake } from '../../src/providers/project-intake';
vi.mock('../../src/providers/blockout', () => ({ listBlockoutDocuments: vi.fn(), loadBlockout: vi.fn(), saveBlockout: vi.fn(), saveBlockoutStartingPoint: vi.fn() }));
vi.mock('../../src/providers/blockout-design', () => ({ loadBlockoutDesign: async () => ({ projectId: 'project', state: { version: 1, documentId: 'document-1', applied: null, pending: [], sourceChanged: false, pendingChanges: false } }), loadBlockoutDesignUnderlay: vi.fn() }));
vi.mock('../../src/providers/project-intake', () => ({ fetchProjectIntake: vi.fn() }));
vi.mock('../../src/providers/registry', () => ({ projectRawUrl: (_: string, path: string) => `/raw/${path}` }));
vi.mock('../../src/components/blockout/useBlockoutReadiness', () => ({ useBlockoutReadiness: () => ({ legacy: true }) }));
let stored: BlockoutDocument, revision: string, writes: number;
const asset = (id: string, width = 800, height = 600): IntakeAsset => ({ id, documentId: 'source', sourcePath: 'sources/test.pdf', sourceName: 'test.pdf', page: 1, box: [0,0,100,100], imagePath: `images/${id}.png`, width, height, kind: 'image', title: id, description: 'Drawing reference', tags: ['structure'], status: 'ready' });
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); writes = 0; revision = 'base'; stored = createBlockoutDocument(); stored.title = 'Report';
  stored.variants[0]!.pages[0]!.blocks = [{ id: 'target', label: 'Reference area', kind: 'image', box: { x: 10, y: 10, width: 70, height: 40, rotation: 0 }, lockRatio: false, images: [], references: [], expectation: '', feedback: '', flexibility: 'guided' }];
  vi.mocked(listBlockoutDocuments).mockResolvedValue([{ id: 'document-1', title: 'Report' }]);
  vi.mocked(loadBlockout).mockImplementation(async () => ({ document: structuredClone(stored), raw: revision }));
  vi.mocked(saveBlockout).mockImplementation(async (_project, document) => { stored = structuredClone(document); revision = `revision-${++writes}`; return revision; });
  vi.mocked(saveBlockoutStartingPoint).mockImplementation(async (_project, document) => ({ path: 'blockouts/document-1/handoffs/update.blockout-update.json', handoff: {
    version: 1, type: 'blockout-update', id: 'update', action: document.approval ? 'develop-design' : 'request-proposals', createdAt: '', workspacePath: '', workspaceRevision: revision,
    previousHandoffId: null, previousWorkspaceRevision: null, comparison: 'initial', snapshot: blockoutHandoffSnapshot(document), changes: [],
  } }));
  vi.mocked(fetchProjectIntake).mockResolvedValue({ version: 1, documents: [], assets: [asset('landscape', 1200, 400), asset('portrait', 400, 1000), asset('square', 600, 600)] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
async function mount() {
  const onUseBrief = vi.fn(), onClose = vi.fn(), onRequestAlternatives = vi.fn();
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<I18nProvider initial="en"><BlockoutWorkspace projectId="project" question={null} initialBlockId="target" onClose={onClose} onUseBrief={onUseBrief} onRequestAlternatives={onRequestAlternatives} /></I18nProvider>); });
  return { ...view, onUseBrief, onClose, onRequestAlternatives };
}
const tick = async (time = 750) => { await act(async () => { await vi.advanceTimersByTimeAsync(time); }); };
const change = (label: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } });
async function openGallery() { fireEvent.click(screen.getAllByRole('button', { name: 'Gallery' })[0]!); await act(async () => {}); }
function drop(...ids: string[]) { fireEvent.drop(screen.getByTestId('blockout-block-target'), { dataTransfer: { types: [BLOCKOUT_GALLERY_DRAG], getData: () => JSON.stringify(ids) } }); }

it('autosaves without a Save button, keeps editing during an in-flight save, and serializes current revisions', async () => {
  await mount(); expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  let finish!: (raw: string) => void;
  vi.mocked(saveBlockout).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  change('Name', 'First name'); await tick();
  expect(saveBlockout).toHaveBeenCalledTimes(1); expect(screen.getByRole('textbox', { name: 'Name' })).not.toBeDisabled();
  change('Name', 'Latest name'); await tick(); expect(saveBlockout).toHaveBeenCalledTimes(1);
  await act(async () => { finish('first-saved-revision'); });
  expect(saveBlockout).toHaveBeenCalledTimes(2);
  expect(vi.mocked(saveBlockout).mock.calls[1]![2]).toBe('first-saved-revision');
  expect(stored.variants[0]!.pages[0]!.blocks[0]!.label).toBe('Latest name');
  expect(screen.getByRole('status')).toHaveTextContent('All changes saved'); expect(saveBlockoutStartingPoint).not.toHaveBeenCalled();
});

it('retains edits after a failed autosave and retries without a handoff', async () => {
  const view = await mount(); vi.mocked(saveBlockout).mockRejectedValueOnce(new Error('blockout.conflict'));
  change('Name', 'Keep this name'); await tick();
  expect(screen.getByRole('alert')).toHaveTextContent('changed outside'); expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Keep this name');
  fireEvent.click(screen.getByRole('button', { name: 'Retry saving' })); await act(async () => {});
  expect(stored.variants[0]!.pages[0]!.blocks[0]!.label).toBe('Keep this name');
  expect(screen.getByRole('status')).toHaveTextContent('All changes saved'); expect(view.onUseBrief).not.toHaveBeenCalled();
});

it('undoes several autosaved operations, redoes them, and retains history on reopening the same revision', async () => {
  const view = await mount(); change('Name', 'Named area'); await tick(1100);
  change('Feedback for the agent', 'Keep the visual grouping'); await tick();
  fireEvent.click(screen.getByRole('button', { name: 'Edit history' }));
  fireEvent.click(within(screen.getByRole('region', { name: 'Edit history' })).getByRole('button', { name: /^Undo 2/ })); await tick();
  expect(stored.variants[0]!.pages[0]!.blocks[0]).toMatchObject({ label: 'Reference area', feedback: '' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit history' }));
  fireEvent.click(within(screen.getByRole('region', { name: 'Edit history' })).getByRole('button', { name: /^Redo 2/ })); await tick();
  expect(stored.variants[0]!.pages[0]!.blocks[0]).toMatchObject({ label: 'Named area', feedback: 'Keep the visual grouping' });
  view.unmount(); await mount(); fireEvent.click(screen.getByRole('button', { name: 'Edit history' }));
  expect(within(screen.getByRole('region', { name: 'Edit history' })).getByRole('button', { name: /^Undo 2/ })).toBeTruthy();
});

it('flushes the latest edit before closing even while an older autosave is pending', async () => {
  const view = await mount(); let finish!: (value: string) => void;
  vi.mocked(saveBlockout).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  change('Name', 'Earlier'); await tick(); change('Name', 'Before close');
  fireEvent.click(screen.getByRole('button', { name: 'Close editor' })); expect(view.onClose).not.toHaveBeenCalled();
  await act(async () => { finish('first'); });
  expect(stored.variants[0]!.pages[0]!.blocks[0]!.label).toBe('Before close'); expect(view.onClose).toHaveBeenCalledOnce();
});

it('drops references, asks before add/replace, and preserves natural proportions without changing block geometry', async () => {
  await mount(); const originalBox = structuredClone(stored.variants[0]!.pages[0]!.blocks[0]!.box); await openGallery();
  drop('landscape'); expect(screen.queryByRole('group', { name: 'Replace or add images' })).toBeNull(); await tick();
  expect(stored.variants[0]!.pages[0]!.blocks[0]).toMatchObject({ referencePreview: true, box: originalBox });
  expect(screen.getByTestId('blockout-reference-preview-target').querySelectorAll('img')).toHaveLength(1);
  drop('portrait'); expect(screen.getByRole('group', { name: 'Replace or add images' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Replace' })).toHaveFocus();
  expect(stored.variants[0]!.pages[0]!.blocks[0]!.images).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Add' })); await tick();
  expect(stored.variants[0]!.pages[0]!.blocks[0]!.images.map((image) => image.assetId)).toEqual(['landscape', 'portrait']);
  expect(screen.getByTestId('blockout-reference-preview-target').querySelectorAll('img')).toHaveLength(2);
  drop('square'); fireEvent.click(screen.getByRole('button', { name: 'Replace' })); await tick();
  expect(stored.variants[0]!.pages[0]!.blocks[0]!.images.map((image) => image.assetId)).toEqual(['square']);
  fireEvent.click(screen.getByRole('button', { name: 'Undo' })); await tick();
  expect(stored.variants[0]!.pages[0]!.blocks[0]!.images).toHaveLength(2);
});

it('supports keyboard selection across searches and sends only the saved Blockout handoff to chat', async () => {
  const view = await mount(); await openGallery();
  fireEvent.click(screen.getByRole('button', { name: 'Select image: landscape' }));
  change('Search the project gallery…', 'portrait'); fireEvent.click(screen.getByRole('button', { name: 'Select image: portrait' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use selected images (2)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit in chat' })); await act(async () => {});
  const snapshot = vi.mocked(saveBlockoutStartingPoint).mock.calls[0]![1];
  expect(snapshot.variants[0]!.pages[0]!.blocks[0]!.images).toHaveLength(2);
  expect(vi.mocked(saveBlockoutStartingPoint).mock.calls[0]![4]).toEqual({ action: 'request-proposals' });
  expect(view.onUseBrief).toHaveBeenCalledWith(expect.any(String), [{ path: 'blockouts/document-1/handoffs/update.blockout-update.json', name: 'Blockout · Report', kind: 'file' }], 'blockout');
  expect(view.onRequestAlternatives).not.toHaveBeenCalled(); expect(snapshot.approval).toBeUndefined();
});

it('does not replay local undo history over an externally changed saved revision', async () => {
  const view = await mount(); change('Name', 'My saved edit'); await tick(); view.unmount();
  revision = 'external-revision'; stored.variants[0]!.pages[0]!.blocks[0]!.label = 'External edit';
  await mount(); expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('External edit');
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

it('keeps the new document revision when an old document autosave completes late', async () => {
  const view = await mount(); let finish!: (value: string) => void;
  vi.mocked(saveBlockout).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  change('Name', 'Earlier project'); await tick();
  const other = structuredClone(stored); other.variants[0]!.pages[0]!.blocks[0]!.label = 'Other project';
  vi.mocked(loadBlockout).mockResolvedValueOnce({ document: other, raw: 'other-project-base' });
  await act(async () => { view.rerender(<I18nProvider initial="en"><BlockoutWorkspace projectId="other-project" question={null} initialBlockId="target" onClose={view.onClose} onUseBrief={view.onUseBrief} /></I18nProvider>); });
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Other project');
  change('Name', 'New project edit'); await tick();
  await act(async () => { finish('old-project-saved'); });
  expect(vi.mocked(saveBlockout).mock.calls[1]).toMatchObject({ 0: 'other-project', 2: 'other-project-base' });
  expect(stored.variants[0]!.pages[0]!.blocks[0]!.label).toBe('New project edit');
  expect(screen.getByRole('status')).toHaveTextContent('All changes saved');
});

it('paginates the gallery and retains selections while browsing and searching', async () => {
  vi.mocked(fetchProjectIntake).mockResolvedValue({ version: 1, documents: [], assets: Array.from({ length: 22 }, (_, index) => asset(`figure-${index + 1}`)) });
  await mount(); await openGallery(); const drawer = screen.getByRole('complementary', { name: 'Gallery' });
  fireEvent.click(within(drawer).getByRole('button', { name: 'Select image: figure-1' }));
  fireEvent.click(within(drawer).getByRole('button', { name: 'Next page' }));
  fireEvent.click(within(drawer).getByRole('button', { name: 'Select image: figure-22' }));
  change('Search the project gallery…', 'figure-5'); fireEvent.click(within(drawer).getByRole('button', { name: 'Select image: figure-5' }));
  expect(within(drawer).getByRole('button', { name: 'Use selected images (3)' })).toBeEnabled();
  fireEvent.click(within(drawer).getByRole('button', { name: 'Use selected images (3)' })); await tick();
  expect(stored.variants[0]!.pages[0]!.blocks[0]!.images.map((image) => image.assetId)).toEqual(['figure-1', 'figure-22', 'figure-5']);
});
