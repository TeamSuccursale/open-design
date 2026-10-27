// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockoutHandoffSnapshot, createBlockoutDocument, createBlockoutPage, type BlockoutDocument, type IntakeAsset } from '@open-design/contracts';
import { BlockoutWorkspace } from '../../src/components/blockout/BlockoutWorkspace';
import { BlockoutQuestionBridge } from '../../src/components/blockout/BlockoutQuestionBridge';
import { BLOCKOUT_QUESTION_EVENT, type BlockoutQuestionEvent, type BlockoutQuestionRequest } from '../../src/components/blockout/events';
import { I18nProvider } from '../../src/i18n';
import { listBlockoutDocuments, loadBlockout, saveBlockout, saveBlockoutStartingPoint } from '../../src/providers/blockout';
import { fetchProjectIntake } from '../../src/providers/project-intake';
import { PROJECT_HISTORY_UPDATED_EVENT } from '../../src/providers/project-history';

vi.mock('../../src/providers/blockout', () => ({ listBlockoutDocuments: vi.fn(), loadBlockout: vi.fn(), saveBlockout: vi.fn(), saveBlockoutStartingPoint: vi.fn() }));
vi.mock('../../src/providers/blockout-design', () => ({ loadBlockoutDesign: async () => ({ projectId: 'project', state: { version: 1, documentId: 'document-1', applied: null, pending: [], sourceChanged: false, pendingChanges: false } }), loadBlockoutDesignUnderlay: vi.fn() }));
vi.mock('../../src/providers/project-intake', () => ({ fetchProjectIntake: vi.fn() }));
vi.mock('../../src/providers/registry', () => ({ projectRawUrl: (_id: string, path: string) => `/raw/${path}` }));
const image = (id: string): IntakeAsset => ({ id, documentId: 'doc', sourcePath: 'sources/test.pdf', sourceName: 'test.pdf', page: 4, box: [0, 0, 100, 100], imagePath: `images/${id}.png`, width: 800, height: 600, kind: 'image', title: id, description: 'Source description', tags: [], status: 'ready' });
beforeEach(() => {
  localStorage.clear();
  vi.mocked(listBlockoutDocuments).mockResolvedValue([{ id: 'document-1', title: '' }]);
  vi.mocked(loadBlockout).mockResolvedValue({ document: null, raw: null });
  vi.mocked(saveBlockout).mockResolvedValue('saved');
  vi.mocked(saveBlockoutStartingPoint).mockImplementation(async (_project, document) => ({
    path: `blockouts/${document.documentId}/handoffs/test-update.blockout-update.json`,
    handoff: { version: 1, type: 'blockout-update', id: 'test-update', action: document.approval ? 'develop-design' : 'request-proposals',
      createdAt: '2026-10-24', workspacePath: 'blockout/layout.json', workspaceRevision: 'saved', previousHandoffId: null, previousWorkspaceRevision: null,
      comparison: 'initial', snapshot: blockoutHandoffSnapshot(document), changes: [] },
  }));
  vi.mocked(fetchProjectIntake).mockResolvedValue({ version: 1, documents: [], assets: [image('figure'), image('reference-a'), image('reference-b')] });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function setup(question: BlockoutQuestionRequest | null = null) {
  const onUseBrief = vi.fn(), onClose = vi.fn();
  render(<I18nProvider initial="en"><BlockoutWorkspace projectId="project" question={question} onClose={onClose} onUseBrief={onUseBrief} /></I18nProvider>);
  return { onUseBrief, onClose };
}
async function addBlock() { fireEvent.click((await screen.findAllByRole('button', { name: 'Add block' }))[0]!); }
function openGeometry() { const summary = screen.getByText('Position, size and ratio'); if (!summary.closest('details')!.open) fireEvent.click(summary); }

describe('explicit AI alternatives and manual working copies', () => {
  it('initially selects the exact block supplied by the overview bridge', async () => {
    const doc=createBlockoutDocument();doc.variants[0]!.pages[0]!.blocks=[{id:'figure',label:'Target figure',kind:'drawing',box:{x:10,y:10,width:20,height:20,rotation:0},lockRatio:false,expectation:'',feedback:'',flexibility:'guided',images:[],references:[]}];
    vi.mocked(loadBlockout).mockResolvedValue({document:doc,raw:'saved'});
    render(<I18nProvider initial="en"><BlockoutWorkspace projectId="project" question={null} onClose={vi.fn()} onUseBrief={vi.fn()} initialPageId="page-1" initialBlockId="figure" /></I18nProvider>);
    expect(await screen.findByDisplayValue('Target figure')).toBeTruthy();
    expect(screen.getByRole('heading',{name:'Block details'})).toBeTruthy();
  });
  it('stages the current edited structure in chat without starting an alternative run', async () => {
    const send = vi.fn(), close = vi.fn(), onUseBrief = vi.fn();
    render(<I18nProvider initial="en"><BlockoutWorkspace projectId="project" question={null} onClose={close} onUseBrief={onUseBrief} onRequestAlternatives={send}/></I18nProvider>);
    await addBlock(); fireEvent.change(screen.getByRole('textbox',{name:'Feedback for the agent'}),{target:{value:'Preserve this edited block.'}});
    fireEvent.click(screen.getByRole('button',{name:'Edit in chat'}));
    await waitFor(() => expect(onUseBrief).toHaveBeenCalledOnce());
    expect(vi.mocked(saveBlockoutStartingPoint).mock.calls[0]![4]).toEqual({action:'request-proposals'});
    expect(vi.mocked(saveBlockoutStartingPoint).mock.calls[0]![1].variants[0]!.pages[0]!.blocks[0]?.feedback).toBe('Preserve this edited block.');
    expect(send).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
  });
  it('keeps a failed handoff open and allows retrying from the saved edited structure', async () => {
    const {onUseBrief,onClose}=setup(); await addBlock();
    vi.mocked(saveBlockoutStartingPoint).mockRejectedValueOnce(new Error('Handoff failed'));
    fireEvent.click(screen.getByRole('button',{name:'Edit in chat'}));
    await screen.findByRole('alert'); expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Edit in chat'}));
    await waitFor(() => expect(onUseBrief).toHaveBeenCalledOnce()); expect(onClose).toHaveBeenCalledOnce();
  });
  it('selects a manual working copy and persists it without requesting AI or approving it', async () => {
    const doc = createBlockoutDocument(); doc.selectedVariantId='brief'; doc.variants[0]!.label='Baseline';
    vi.mocked(loadBlockout).mockResolvedValue({document:doc,raw:'baseline'});
    const {onUseBrief,onClose} = setup();
    fireEvent.click(await screen.findByRole('button',{name:'Duplicate to edit'}));
    await waitForAutosave();
    await waitFor(() => expect(saveBlockout).toHaveBeenCalledOnce());
    const saved=vi.mocked(saveBlockout).mock.calls[0]![1];
    expect(saved.variants[0]).toEqual(doc.variants[0]);
    expect(saved.selectedVariantId).toBe(saved.activeVariantId); expect(saved.selectedVariantId).not.toBe('brief');
    expect(saved.approval).toBeUndefined(); expect(saved.variants[1]?.label).toBe('Copy of Baseline');
    expect(onUseBrief).not.toHaveBeenCalled(); expect(saveBlockoutStartingPoint).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Close editor'})); await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});

describe('editable blockout workspace', () => {
  it('reloads a clean editor after restore without choosing or approving a structure', async () => {
    const before = createBlockoutDocument(); before.variants[0]!.pages[0]!.label = 'Before restore';
    const after = structuredClone(before); after.variants[0]!.pages[0]!.label = 'Restored page';
    vi.mocked(loadBlockout).mockResolvedValueOnce({ document: before, raw: 'before' }).mockResolvedValue({ document: after, raw: 'after' });
    const view = setup(); await screen.findByDisplayValue('Before restore');
    fireEvent(window, new CustomEvent(PROJECT_HISTORY_UPDATED_EVENT, { detail: { projectId: 'other' } })); expect(loadBlockout).toHaveBeenCalledOnce();
    fireEvent(window, new CustomEvent(PROJECT_HISTORY_UPDATED_EVENT, { detail: { projectId: 'project', restoredPaths: ['blockout/layout.json'] } }));
    expect(await screen.findByDisplayValue('Restored page')).toBeTruthy(); expect(loadBlockout).toHaveBeenCalledTimes(2);
    expect(saveBlockout).not.toHaveBeenCalled(); expect(saveBlockoutStartingPoint).not.toHaveBeenCalled(); expect(view.onUseBrief).not.toHaveBeenCalled();
  });
  it('preserves unsaved edits and shows a conflict instead of replacing the draft after restore', async () => {
    setup(); await addBlock();
    fireEvent.change(screen.getByRole('textbox', { name: 'Feedback for the agent' }), { target: { value: 'Keep my unsaved block changes.' } });
    fireEvent(window, new CustomEvent(PROJECT_HISTORY_UPDATED_EVENT, { detail: { projectId: 'project', restoredPaths: ['blockout/layout.json'] } }));
    expect(screen.getByRole('alert').textContent).toContain('The layout changed outside this editor.');
    expect(screen.getByDisplayValue('Keep my unsaved block changes.')).toBeTruthy(); expect(loadBlockout).toHaveBeenCalledOnce(); expect(saveBlockout).not.toHaveBeenCalled();
  });
  it('saves a lower chosen target within the source cap with the loaded revision before closing', async () => {
    const document = createBlockoutDocument();
    document.pageBudget = { mode: 'exact', limit: 3, target: 3 };
    vi.mocked(loadBlockout).mockResolvedValue({ document, raw: 'saved exact-three revision' });
    const view = setup(); fireEvent.click(await screen.findByText('Adjust allowance'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Allowance rule' }), { target: { value: 'maximum' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Allowed pages' }), { target: { value: '4' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Planning target' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    await waitFor(() => expect(view.onClose).toHaveBeenCalledOnce());
    expect(saveBlockout).toHaveBeenCalledWith('project', expect.objectContaining({ pageBudget: { mode: 'maximum', limit: 4, target: 3 } }), 'saved exact-three revision', undefined);
    expect(saveBlockoutStartingPoint).not.toHaveBeenCalled(); expect(view.onUseBrief).not.toHaveBeenCalled();
  });
  it('chooses an editable proposal, navigates pages, and requires an explicit answer before design', async () => {
    const doc = createBlockoutDocument();
    const block = { id: 'figure', label: 'Drawing', kind: 'drawing' as const, box: { x: 10, y: 10, width: 60, height: 40, rotation: 0 }, lockRatio: true, images: [], references: [], expectation: '', feedback: '', flexibility: 'guided' as const };
    doc.variants.push({ id: 'proposal-a', label: 'Image first', pages: [{ ...createBlockoutPage('cover', 'Cover'), blocks: [block] }, createBlockoutPage('method', 'Method')] });
    vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'original' });
    const onUseBrief = vi.fn(), onPhaseChange = vi.fn();
    render(<I18nProvider initial="en"><BlockoutWorkspace projectId="project" question={null} onClose={vi.fn()} onUseBrief={onUseBrief} onPhaseChange={onPhaseChange} /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose and edit: Image first · Cover' }));
    fireEvent.change(await screen.findByLabelText('Proposal'), { target: { value: 'proposal-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Method' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Method');
    fireEvent.click(screen.getByRole('button', { name: 'Cover' }));
    expect(onUseBrief).not.toHaveBeenCalled();
    expect(saveBlockout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Move to design' }));
    expect(onPhaseChange).not.toHaveBeenCalledWith('design');
    expect(onUseBrief).not.toHaveBeenCalled();
    expect(saveBlockout).not.toHaveBeenCalled();
    expect(screen.getByTestId('blockout-paper').getAttribute('data-question-target')).toBe('true');
    expect(screen.getByText(/graphic design request opens in chat; press Send/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('What should go here?'), { target: { value: 'Include the current edits when starting graphic design.' } });
    fireEvent.click(screen.getByRole('button', { name: /accept.*graphic design/i }));
    await waitFor(() => expect(onPhaseChange).toHaveBeenCalledWith('design'));
    expect(vi.mocked(saveBlockout).mock.calls.at(-1)![1].approval?.variantId).toBe('proposal-a');
    expect(vi.mocked(saveBlockoutStartingPoint).mock.calls.at(-1)![1].variants[1]!.pages[0]!.expectation).toContain('current edits');
    expect(onUseBrief.mock.calls[0]![2]).toBe('design');
  });
  it('persists a new document immediately and keeps edits after graphic approval marked for adaptation', async () => {
    const doc = createBlockoutDocument(); doc.approval = { variantId: 'brief', acceptedAt: '2026-10-23' };
    vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'original' });
    setup(); await addBlock();
    await waitForAutosave();
    await waitFor(() => expect(saveBlockout).toHaveBeenCalled());
    expect(vi.mocked(saveBlockout).mock.calls[0]![1].needsReadaptation).toBe(true);
    fireEvent.click(screen.getByText('Document settings'));
    fireEvent.click(screen.getByRole('button', { name: 'New document' }));
    await waitFor(() => expect(saveBlockout).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveBlockout).mock.calls[1]![1].documentId).toMatch(/^document-/);
    expect(vi.mocked(saveBlockout).mock.calls[1]![1].documentId).not.toBe('document-1');
    expect(vi.mocked(saveBlockout).mock.calls[1]![2]).toBeNull();
  });
  it('edits content, rotation, proportions and page format, with undo', async () => {
    setup(); await addBlock();
    fireEvent.change(screen.getByLabelText('What should go here?'), { target: { value: 'Keep the source drawing and its 42 kN label.' } });
    openGeometry();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Rotation (°)' }), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: '4:3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Page' }));
    fireEvent.change(screen.getByLabelText('Paper format'), { target: { value: 'a3l' } });
    await waitForAutosave();
    await waitFor(() => expect(saveBlockout).toHaveBeenCalled());
    const saved = vi.mocked(saveBlockout).mock.calls[0]![1];
    expect(saved.variants[0]!.pages[0]!.widthMm).toBe(420);
    expect(saved.variants[0]!.pages[0]!.blocks[0]!.box.rotation).toBe(15);
    expect(saved.variants[0]!.pages[0]!.blocks[0]!.expectation).toContain('42 kN');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect((screen.getByLabelText('Paper format') as HTMLSelectElement).value).toBe('a4p');
  });
  it('links real gallery content and multiple feedback images and saves the starting point before staging', async () => {
    const { onUseBrief } = setup(); await addBlock();
    fireEvent.change(screen.getByLabelText('What should go here?'), { target: { value: 'A source figure with its caption.' } });
    fireEvent.click(screen.getByText('Optional references for later graphic design'));
    fireEvent.click(screen.getByRole('button', { name: 'Assets for graphic design (0)' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /figure/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Feedback images (0)' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /reference-a/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /reference-b/ }));
    fireEvent.change(screen.getByLabelText('How freely can the agent change this layout?'), { target: { value: 'free' } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit in chat' }));
    await waitFor(() => expect(onUseBrief).toHaveBeenCalled());
    expect(saveBlockoutStartingPoint).toHaveBeenCalled();
    const starting = vi.mocked(saveBlockoutStartingPoint).mock.calls[0]![1];
    expect(starting.variants[0]!.pages[0]!.blocks[0]!.references).toHaveLength(2);
    expect(starting.variants[0]!.pages[0]!.blocks[0]!.flexibility).toBe('free');
    expect(onUseBrief.mock.calls[0]![1]).toEqual([{ path: 'blockouts/document-1/handoffs/test-update.blockout-update.json', name: 'Blockout · Document', kind: 'file' }]);
    expect(onUseBrief.mock.calls[0]![0]).not.toContain('.json');
    expect(onUseBrief.mock.calls[0]![0]).not.toContain('sources/test.pdf');
    expect(onUseBrief.mock.calls[0]![0]).not.toContain('{');
    expect(onUseBrief.mock.calls[0]![2]).toBe('blockout');
  });
  it('saves the latest geometry before opening a request draft, while ordinary Save only persists', async () => {
    const { onUseBrief, onClose } = setup(); await addBlock();
    openGeometry();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'X (%)' }), { target: { value: '23.5' } });
    fireEvent.change(screen.getByLabelText('Feedback for the agent'), { target: { value: 'Keep this edited alignment.' } });
    expect(screen.getByRole('status').textContent).toContain('Autosave pending');
    await waitForAutosave();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('All changes saved'));
    expect(onUseBrief).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    expect(saveBlockoutStartingPoint).not.toHaveBeenCalled();
    openGeometry();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Width (%)' }), { target: { value: '42' } });
    let finishSave!: (value: string) => void;
    vi.mocked(saveBlockout).mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit in chat' }));
    expect(onUseBrief).not.toHaveBeenCalled(); expect(saveBlockoutStartingPoint).not.toHaveBeenCalled();
    await waitFor(() => expect(finishSave).toBeTypeOf('function')); finishSave('latest revision');
    await waitFor(() => expect(onUseBrief).toHaveBeenCalledOnce());
    const snapshot = vi.mocked(saveBlockoutStartingPoint).mock.calls[0]![1];
    expect(snapshot.variants[0]!.pages[0]!.blocks[0]).toMatchObject({ box: { x: 23.5, width: 42 }, feedback: 'Keep this edited alignment.' });
    expect(vi.mocked(saveBlockoutStartingPoint).mock.invocationCallOrder[0]).toBeLessThan(onUseBrief.mock.invocationCallOrder[0]!);
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('keeps approval explicit when changing proposals and stages approved edits as a graphic update', async () => {
    const doc = createBlockoutDocument();
    const block = { id: 'figure', label: 'Drawing', kind: 'drawing' as const, box: { x: 10, y: 10, width: 60, height: 40, rotation: 0 }, lockRatio: false, images: [], references: [], expectation: '', feedback: '', flexibility: 'guided' as const };
    doc.variants[0]!.pages[0]!.blocks.push(block);
    doc.variants.push({ id: 'proposal-a', label: 'Image first', pages: [{ ...createBlockoutPage('cover', 'Cover'), blocks: [block] }] });
    vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'original' });
    const { onUseBrief } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Move to design' }));
    fireEvent.change(screen.getByLabelText('Proposal'), { target: { value: 'proposal-a' } });
    expect(screen.queryByRole('button', { name: /accept.*graphic design/i })).toBeNull();
    expect(onUseBrief).not.toHaveBeenCalled(); expect(saveBlockout).not.toHaveBeenCalled();
    cleanup();
    localStorage.clear();
    doc.approval = { variantId: 'brief', acceptedAt: '2026-10-23' };
    const updated = setup();
    fireEvent.focus(await screen.findByTestId('blockout-block-figure'));
    openGeometry();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'X (%)' }), { target: { value: '19' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move to design' }));
    fireEvent.click(screen.getByRole('button', { name: /accept.*graphic design/i }));
    await waitFor(() => expect(saveBlockoutStartingPoint).toHaveBeenCalled());
    expect(vi.mocked(saveBlockoutStartingPoint).mock.calls[0]![1]).toMatchObject({ needsReadaptation: false, approval: {variantId:'brief'} });
    expect(vi.mocked(saveBlockoutStartingPoint).mock.calls[0]![1].variants[0]!.pages[0]!.blocks[0]!.box.x).toBe(19);
    await waitFor(() => expect(updated.onUseBrief).toHaveBeenCalledWith(expect.any(String), [expect.objectContaining({ kind: 'file', path: expect.stringContaining('.blockout-update.json') })], 'design'));
  });
  it('keeps the draft open when persistence fails', async () => {
    vi.mocked(saveBlockout).mockRejectedValue(new Error('blockout.conflict'));
    const { onUseBrief, onClose } = setup(); await addBlock();
    fireEvent.click(screen.getByRole('button', { name: 'Edit in chat' }));
    expect((await screen.findByRole('alert')).textContent).toContain('changed outside this editor');
    expect(onUseBrief).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  });
  it('keeps edits and the editor open when Close editor fails', async () => {
    vi.mocked(saveBlockout).mockRejectedValue(new Error('blockout.conflict'));
    const { onUseBrief, onClose } = setup(); await addBlock();
    openGeometry();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'X (%)' }), { target: { value: '31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    await screen.findByRole('alert');
    expect(onUseBrief).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('spinbutton', { name: 'X (%)' }) as HTMLInputElement).value).toBe('31');
    fireEvent.click(screen.getAllByRole('button', { name: 'Close, keep draft' }).at(-1)!);
    expect(onClose).toHaveBeenCalledOnce();
    const recovery = JSON.parse(localStorage.getItem('melillodesign:blockout-draft:project:document-1')!);
    expect(recovery.document.variants[0].pages[0].blocks[0].box.x).toBe(31);
    expect(saveBlockout).toHaveBeenCalledOnce();
  });
  it('closes after selecting a different proposal without treating navigation as a document edit', async () => {
    const doc = createBlockoutDocument();
    doc.variants.push({ id: 'proposal-b', label: 'Alternative B', pages: [createBlockoutPage('cover', 'Cover')] });
    vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'original' });
    const { onClose, onUseBrief } = setup();
    fireEvent.change(await screen.findByLabelText('Proposal'), { target: { value: 'proposal-b' } });
    expect(screen.getByRole('status').textContent).toContain('All changes saved');
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    expect(onClose).toHaveBeenCalledOnce(); expect(saveBlockout).not.toHaveBeenCalled(); expect(onUseBrief).not.toHaveBeenCalled();
    expect(doc.approval).toBeUndefined();
  });
  it('does not trap a recovered selection-only draft behind a failing save', async () => {
    const doc = createBlockoutDocument();
    doc.variants.push({ id: 'proposal-b', label: 'Alternative B', pages: [createBlockoutPage('cover', 'Cover')] });
    vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'original' });
    localStorage.setItem('melillodesign:blockout-draft:project:document-1', JSON.stringify({ baseRaw: 'original', document: { ...doc, activeVariantId: 'proposal-b' } }));
    vi.mocked(saveBlockout).mockRejectedValue(new Error('blockout.loadFailed'));
    const { onClose } = setup();
    expect((await screen.findByLabelText('Proposal') as HTMLSelectElement).value).toBe('proposal-b');
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    expect(onClose).toHaveBeenCalledOnce(); expect(saveBlockout).not.toHaveBeenCalled();
  });
  it('approves with one button, since Move to design already says what the engineer wants', async () => {
    const { onUseBrief } = setup(); await addBlock();
    fireEvent.click(screen.getByRole('button', { name: 'Move to design' }));
    const panel = screen.getByRole('region', { name: 'Use this structure for graphic design' });
    expect(within(panel).queryAllByRole('radio')).toEqual([]);
    expect(within(panel).queryByRole('textbox')).toBeNull();
    expect(within(panel).getAllByRole('button').map((button) => button.textContent)).toEqual(['Accept and move to graphic design', 'Keep refining the blockout']);
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept and move to graphic design' }));
    await waitFor(() => expect(onUseBrief).toHaveBeenCalledOnce());
    expect(onUseBrief.mock.calls[0]![2]).toBe('design');
  });
  it('keeps refinement in Blockout when approval is declined', async () => {
    const { onUseBrief, onClose } = setup(); await addBlock();
    fireEvent.click(screen.getByRole('button', { name: 'Move to design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep refining the blockout' }));
    expect(screen.queryByRole('button', { name: 'Keep refining the blockout' })).toBeNull();
    expect(onUseBrief).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled(); expect(saveBlockout).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit in chat' })).toBeTruthy();
  });
  it('keeps the approval question open if its starting brief cannot be saved', async () => {
    vi.mocked(saveBlockoutStartingPoint).mockRejectedValue(new Error('Brief write failed'));
    const { onUseBrief, onClose } = setup(); await addBlock();
    fireEvent.click(screen.getByRole('button', { name: 'Move to design' }));
    fireEvent.click(screen.getByRole('button', { name: /accept.*graphic design/i }));
    expect((await screen.findByRole('alert')).textContent).toContain('Brief write failed');
    expect(onUseBrief).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /accept.*graphic design/i })).toBeTruthy();
    expect(screen.getByTestId('blockout-paper').getAttribute('data-question-target')).toBe('true');
  });
  it('opens the scoped block question and saves flexibility and answers through the existing form callback', async () => {
    const doc: BlockoutDocument = createBlockoutDocument();
    doc.variants[0]!.pages[0]!.blocks = [{ id: 'figure', label: 'Main drawing', kind: 'drawing', box: { x: 10, y: 10, width: 60, height: 40, rotation: 0 }, lockRatio: true, images: [], references: [], expectation: '', feedback: '', flexibility: 'guided' }];
    vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'original' });
    const onSubmit = vi.fn();
    setup({ key: 'q1', projectId: 'project', conversationId: null, target: { variantId: 'brief', pageId: 'page-1', blockId: 'figure' }, props: {
      form: { id: 'clarify', title: 'Drawing treatment', questions: [{ id: 'caption', label: 'Which caption?', type: 'text' }] }, interactive: true, onSubmit,
    } });
    expect((await screen.findByTestId('blockout-block-figure')).getAttribute('data-question-target')).toBe('true');
    fireEvent.change(await screen.findByLabelText('Which caption?'), { target: { value: 'Keep the original caption.' } });
    fireEvent.change(screen.getByLabelText('How freely can the agent change this layout?'), { target: { value: 'fixed' } });
    fireEvent.click(screen.getByRole('button', { name: /^(submit|send|continue|next)$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const snapshot = vi.mocked(saveBlockoutStartingPoint).mock.calls[0]![1];
    expect(snapshot.answers[0]!.target.blockId).toBe('figure');
    expect(snapshot.variants[0]!.pages[0]!.blocks[0]!.flexibility).toBe('fixed');
    expect(onSubmit.mock.calls[0]![0]).toContain('Keep the original caption.');
  });
  it('publishes a targeted question without inventing a second answer transport', async () => {
    const receive = vi.fn(); window.addEventListener(BLOCKOUT_QUESTION_EVENT, receive);
    const onSubmit = vi.fn();
    render(<I18nProvider initial="en"><BlockoutQuestionBridge projectId="project" occurrenceKey="bridge-test" interactive form={{ id: 'q', title: 'Figure', blockoutTarget: { pageId: 'page-1', blockId: 'figure' }, questions: [{ id: 'q1', type: 'text', label: 'Caption?' }] }} onSubmit={onSubmit} /></I18nProvider>);
    await waitFor(() => expect(receive).toHaveBeenCalled());
    const detail = (receive.mock.calls[0]![0] as CustomEvent<BlockoutQuestionEvent>).detail;
    expect(detail.request.target.blockId).toBe('figure'); expect(detail.request.props.onSubmit).toBe(onSubmit);
    window.removeEventListener(BLOCKOUT_QUESTION_EVENT, receive);
  });
  it('reports a stale question target without highlighting a different page', async () => {
    setup({ key: 'missing', projectId: 'project', conversationId: null, target: { pageId: 'missing-page' }, props: { form: { id: 'missing', title: 'Missing page', questions: [{ id: 'q', type: 'text', label: 'Content?' }] }, interactive: true } });
    expect((await screen.findByRole('alert')).textContent).toContain('missing from the saved layout');
    expect(screen.getByTestId('blockout-paper').hasAttribute('data-question-target')).toBe(false);
  });
});

async function waitForAutosave() { await waitFor(() => expect(screen.getByText('All changes saved')).toBeTruthy(), { timeout: 2500 }); }
