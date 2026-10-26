// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockoutPageFiles, createBlockoutDocument, createBlockoutPage } from '@open-design/contracts';
import { BlockoutComparisonPreview, BlockoutFilePreview } from '../../src/components/blockout/BlockoutFilePreview';
import { BlockoutArtifactCard } from '../../src/components/blockout/BlockoutArtifactCard';
import { ArtifactCards } from '../../src/components/FileOpsSummary';
import { BLOCKOUT_OPEN_EVENT, OPEN_BLOCKOUT_PROPOSALS_EVENT, openBlockoutProposals } from '../../src/components/blockout/events';
import { I18nProvider } from '../../src/i18n';
import { listBlockoutDocuments, loadBlockout, registeredBlockoutComparisonDocument, saveBlockout } from '../../src/providers/blockout';
import { PROJECT_HISTORY_UPDATED_EVENT } from '../../src/providers/project-history';
vi.mock('../../src/providers/blockout', () => ({ loadBlockout: vi.fn(), saveBlockout: vi.fn(), listBlockoutDocuments: vi.fn(), registeredBlockoutComparisonDocument: vi.fn() }));
const editorOpened = vi.fn(), comparisonOpened = vi.fn();
beforeEach(() => { window.addEventListener(BLOCKOUT_OPEN_EVENT, editorOpened); window.addEventListener(OPEN_BLOCKOUT_PROPOSALS_EVENT, comparisonOpened); });
afterEach(() => { cleanup(); window.removeEventListener(BLOCKOUT_OPEN_EVENT, editorOpened); window.removeEventListener(OPEN_BLOCKOUT_PROPOSALS_EVENT, comparisonOpened); vi.resetAllMocks(); });

describe('visual Blockout deliverables', () => {
  it('waits for registration during generation and retries automatically on completion at the same HTML revision', async () => {
    const doc = createBlockoutDocument(); doc.documentId = 'registered-report'; doc.variants[0]!.label = 'Ready after registration';
    vi.mocked(registeredBlockoutComparisonDocument).mockRejectedValueOnce(new Error('blockout.invalidDocument')).mockResolvedValue('registered-report');
    vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'saved' });
    const view = (generating: boolean) => <I18nProvider initial="en"><BlockoutComparisonPreview projectId="parent" path="documents/registered-report/documents/report/blockout-comparison.html" revision={7} generating={generating} /></I18nProvider>;
    const { rerender } = render(view(true));
    await waitFor(() => expect(registeredBlockoutComparisonDocument).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('The agent is still preparing this document');
    expect(loadBlockout).not.toHaveBeenCalled();
    rerender(view(false));
    expect(await screen.findByRole('button', { name: 'Choose Ready after registration' })).toBeEnabled();
    expect(registeredBlockoutComparisonDocument).toHaveBeenCalledTimes(2);
    expect(saveBlockout).not.toHaveBeenCalled(); expect(editorOpened).not.toHaveBeenCalled();
  });
  it('keeps a genuine registration failure visible after generation ends', async () => {
    vi.mocked(registeredBlockoutComparisonDocument).mockRejectedValue(new Error('blockout.invalidDocument'));
    const view = (generating: boolean) => <I18nProvider initial="en"><BlockoutComparisonPreview projectId="parent" path="documents/child/documents/report/blockout-comparison.html" revision={7} generating={generating} /></I18nProvider>;
    const { rerender } = render(view(true));
    await waitFor(() => expect(registeredBlockoutComparisonDocument).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(view(false));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
  it('reloads a temporarily unavailable saved model when generation finishes without another file change', async () => {
    const doc = createBlockoutDocument(); doc.variants[0]!.label = 'Saved model ready';
    vi.mocked(loadBlockout).mockRejectedValueOnce(new Error('pending')).mockResolvedValue({ document: doc, raw: 'ready' });
    const view = (generating: boolean) => <I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockout/layout.json" revision={4} generating={generating} /></I18nProvider>;
    const { rerender } = render(view(true));
    await waitFor(() => expect(loadBlockout).toHaveBeenCalledOnce()); expect(screen.queryByRole('alert')).toBeNull();
    rerender(view(false));
    expect(await screen.findByRole('button', { name: 'Choose Saved model ready' })).toBeEnabled();
    expect(loadBlockout).toHaveBeenCalledTimes(2); expect(saveBlockout).not.toHaveBeenCalled();
  });
  it('shows appended alternatives beside the selected edited baseline without choosing them automatically', async () => {
    const doc=createBlockoutDocument(); doc.selectedVariantId='brief'; doc.variants[0]!.label='Edited baseline';
    doc.variants.push({...structuredClone(doc.variants[0]!),id:'new-variant',label:'New text-led alternative'});
    doc.alternativeBatches=[{requestId:'request',payloadDigest:'a'.repeat(64),baseVariantId:'brief',variantIds:['new-variant'],createdAt:'now'}];
    vi.mocked(loadBlockout).mockResolvedValue({document:doc,raw:'appended'});
    render(<I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockout/layout.json" /></I18nProvider>);
    expect(await screen.findByRole('region',{name:'New alternatives'})).toBeTruthy();
    expect(screen.getByRole('button',{name:'Choose New text-led alternative'})).toBeTruthy();
    expect(doc.selectedVariantId).toBe('brief'); expect(saveBlockout).not.toHaveBeenCalled();
  });
  it('shows new results from another base while preserving the chosen proposal until an explicit choice', async () => {
    const doc=createBlockoutDocument();doc.selectedVariantId='brief';doc.variants[0]!.label='Chosen original';
    doc.variants.push({...structuredClone(doc.variants[0]!),id:'other-base',label:'Other base'}, {...structuredClone(doc.variants[0]!),id:'new-result',label:'New result'});
    doc.alternativeBatches=[{requestId:'request',payloadDigest:'a'.repeat(64),baseVariantId:'other-base',variantIds:['new-result'],createdAt:'now'}];
    vi.mocked(loadBlockout).mockResolvedValue({document:doc,raw:'appended'});
    render(<I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockout/layout.json" /></I18nProvider>);
    const choose=await screen.findByRole('button',{name:'Choose New result'});
    expect(screen.getByText('Based on Other base')).toBeTruthy();expect(saveBlockout).not.toHaveBeenCalled();expect(doc.selectedVariantId).toBe('brief');
    fireEvent.click(choose);await waitFor(()=>expect(saveBlockout).toHaveBeenCalledOnce());
    expect(vi.mocked(saveBlockout).mock.calls[0]![1]).toMatchObject({selectedVariantId:'new-result',variants:doc.variants});
  });
  it('offers an actual editor action only after choosing, without implicitly approving or saving', async () => {
    const doc=createBlockoutDocument();doc.selectedVariantId='brief';
    vi.mocked(loadBlockout).mockResolvedValue({document:doc,raw:'saved'});
    render(<I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockout/layout.json" /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Edit or approve the structure'}));
    expect(editorOpened.mock.calls[0]![0].detail).toMatchObject({projectId:'p',documentId:'document-1',variantId:'brief',pageId:'page-1'});
    expect(saveBlockout).not.toHaveBeenCalled();expect(doc.approval).toBeUndefined();
    fireEvent.click(screen.getByRole('button',{name:'Compare all proposals'}));
    expect(screen.queryByRole('button',{name:'Edit or approve the structure'})).toBeNull();
  });
  it('opens the clicked overview block as the exact editor target', async () => {
    const doc=createBlockoutDocument();doc.selectedVariantId='brief';doc.variants[0]!.label='Baseline';
    doc.variants[0]!.pages[0]!.blocks=[{id:'figure',label:'Small figure',kind:'drawing',box:{x:10,y:10,width:20,height:20,rotation:0},lockRatio:false,expectation:'',feedback:'',flexibility:'guided',images:[],references:[]}];
    vi.mocked(loadBlockout).mockResolvedValue({document:doc,raw:'saved'});
    render(<I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockout/layout.json" /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button',{name:/Select Small figure/}));
    expect(editorOpened.mock.calls[0]![0].detail).toMatchObject({documentId:'document-1',variantId:'brief',pageId:'page-1',blockId:'figure'});
  });
  it('allows inspection but prevents selection and editing until native generation settles', async () => {
    const doc = createBlockoutDocument(); doc.variants[0]!.label = 'Draft structure';
    vi.mocked(loadBlockout).mockResolvedValue({document:doc,raw:'partial'});
    const view = render(<I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockout/layout.json" generating /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', {name:'Preview Page · Draft structure'}));
    expect(within(screen.getByRole('dialog')).getByRole('progressbar', { name: /Preview its pages now/ })).toBeTruthy();
    expect((within(screen.getByRole('dialog')).getByRole('button', {name:'Choose this structure'}) as HTMLButtonElement).disabled).toBe(true);
    expect((within(screen.getByRole('dialog')).getByRole('button', {name:'Edit this page’s composition'}) as HTMLButtonElement).disabled).toBe(true);
    expect(saveBlockout).not.toHaveBeenCalled();
    view.rerender(<I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockout/layout.json" generating={false} /></I18nProvider>);
    expect(within(screen.getByRole('dialog')).queryByRole('progressbar')).toBeNull();
    expect((within(screen.getByRole('dialog')).getByRole('button', {name:'Choose this structure'}) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name:'Choose this structure'}));
    await waitFor(() => expect(saveBlockout).toHaveBeenCalledOnce());
  });
  it('routes comparison document changes through the host before changing the viewed document', async () => {
    const doc = createBlockoutDocument(); doc.documentId = 'booklet'; doc.title = 'Graphic booklet';
    vi.mocked(listBlockoutDocuments).mockResolvedValue([{ id:'report',title:'Technical report' }, { id:'booklet',title:'Graphic booklet' }]);
    vi.mocked(loadBlockout).mockResolvedValue({ document:doc,raw:'booklet-revision' });
    const navigate = vi.fn();
    render(<I18nProvider initial="en"><BlockoutComparisonPreview projectId="p" path="documents/graphic-booklet/blockout-comparison.html" onOpenComparison={navigate} /></I18nProvider>);
    await screen.findByRole('combobox', { name:'Document' });
    await waitFor(() => expect(loadBlockout).toHaveBeenCalledWith('p', null, expect.any(AbortSignal), 'booklet'));
    fireEvent.change(screen.getByRole('combobox', { name:'Document' }), { target:{value:'report'} });
    expect(navigate).toHaveBeenCalledWith('documents/technical-report/blockout-comparison.html');
    // The host now owns navigation; do not render another document under the old file URL/edit target.
    expect(loadBlockout).toHaveBeenCalledTimes(1);
    expect(saveBlockout).not.toHaveBeenCalled();
  });
  it('opens the exact registered child comparison instead of the parent empty legacy seed', async () => {
    const doc = createBlockoutDocument(); doc.documentId = 'registered-report'; doc.variants[0]!.label = 'Real child structure';
    vi.mocked(registeredBlockoutComparisonDocument).mockResolvedValue('registered-report');
    vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'child-revision' });
    render(<I18nProvider initial="en"><BlockoutComparisonPreview projectId="parent" path="documents/registered-report/documents/report/blockout-comparison.html" /></I18nProvider>);
    await screen.findByRole('button', { name: 'Choose Real child structure' });
    expect(loadBlockout).toHaveBeenCalledWith('parent', null, expect.any(AbortSignal), 'registered-report');
    expect(listBlockoutDocuments).not.toHaveBeenCalled();
  });
  it('retries a pending registration after a generated comparison revision arrives instead of opening a legacy seed', async () => {
    const doc = createBlockoutDocument(); doc.documentId = 'registered-report'; doc.title = 'Child report'; doc.variants[0]!.label = 'Registered child structure';
    vi.mocked(registeredBlockoutComparisonDocument).mockResolvedValueOnce(null).mockResolvedValue('registered-report');
    vi.mocked(listBlockoutDocuments).mockResolvedValue([{ id: 'document-1', title: '' }]);
    vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'child' });
    const view = (revision: number) => <I18nProvider initial="en"><BlockoutComparisonPreview projectId="parent" path="documents/child-report/blockout-comparison.html" revision={revision} /></I18nProvider>;
    const { rerender } = render(view(1));
    await screen.findByRole('alert');
    expect(loadBlockout).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    rerender(view(2));
    await screen.findByRole('button', { name: 'Choose Registered child structure' });
    expect(loadBlockout).toHaveBeenCalledWith('parent', null, expect.any(AbortSignal), 'registered-report');
  });
  it('retries the same comparison after a transient read failure without creating or selecting a layout', async () => {
    const doc = createBlockoutDocument(); doc.documentId = 'report'; doc.variants[0]!.label = 'Saved structure';
    vi.mocked(loadBlockout).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue({ document: doc, raw: 'saved' });
    render(<I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockouts/report/page-1.blockout.json" /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: 'Choose Saved structure' });
    expect(saveBlockout).not.toHaveBeenCalled(); expect(editorOpened).not.toHaveBeenCalled();
    expect(vi.mocked(loadBlockout).mock.calls.map((call) => [call[0], call[3]])).toEqual([['p', 'report'], ['p', 'report']]);
  });
  it('reloads restored Blockout metadata even when the comparison HTML revision stays unchanged', async () => {
    const before = createBlockoutDocument(); before.title = 'Before restore'; before.variants[0]!.label = 'Old structure';
    const after = structuredClone(before); after.title = 'After restore'; after.variants[0]!.label = 'Restored structure';
    vi.mocked(loadBlockout).mockResolvedValueOnce({ document: before, raw: 'before' }).mockResolvedValue({ document: after, raw: 'after' });
    render(<I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockout/layout.json" revision={7} /></I18nProvider>);
    await screen.findByRole('button', { name: 'Choose Old structure' });
    fireEvent(window, new CustomEvent(PROJECT_HISTORY_UPDATED_EVENT, { detail: { projectId: 'other', restoredPaths: ['blockout/layout.json'] } }));
    expect(loadBlockout).toHaveBeenCalledOnce();
    fireEvent(window, new CustomEvent(PROJECT_HISTORY_UPDATED_EVENT, { detail: { projectId: 'p', restoredPaths: ['blockout/layout.json'] } }));
    expect(await screen.findByRole('button', { name: 'Choose Restored structure' })).toBeTruthy();
    expect(loadBlockout).toHaveBeenCalledTimes(2); expect(screen.getByText('After restore')).toBeTruthy();
    expect(saveBlockout).not.toHaveBeenCalled(); expect(editorOpened).not.toHaveBeenCalled();
  });
  it('refreshes the registered comparison after a title restore without guessing its old path from the new title', async () => {
    const before = createBlockoutDocument(); before.documentId = 'report'; before.title = 'Before restore'; before.variants[0]!.label = 'Old structure';
    const after = structuredClone(before); after.title = 'After restore'; after.variants[0]!.label = 'Restored structure';
    vi.mocked(listBlockoutDocuments).mockResolvedValueOnce([{ id: 'report', title: 'Before restore' }]).mockResolvedValue([{ id: 'report', title: 'After restore' }]);
    vi.mocked(registeredBlockoutComparisonDocument).mockResolvedValue('report');
    vi.mocked(loadBlockout).mockResolvedValueOnce({ document: before, raw: 'before' }).mockResolvedValue({ document: after, raw: 'after' });
    render(<I18nProvider initial="en"><BlockoutComparisonPreview projectId="p" path="documents/before-restore/blockout-comparison.html" revision={7} /></I18nProvider>);
    await screen.findByRole('button', { name: 'Choose Old structure' });
    fireEvent(window, new CustomEvent(PROJECT_HISTORY_UPDATED_EVENT, { detail: { projectId: 'p', restoredPaths: ['blockouts/.documents.json'] } }));
    expect(await screen.findByRole('button', { name: 'Choose Restored structure' })).toBeTruthy();
    expect(registeredBlockoutComparisonDocument).toHaveBeenCalledTimes(2); expect(listBlockoutDocuments).not.toHaveBeenCalled(); expect(editorOpened).not.toHaveBeenCalled(); expect(saveBlockout).not.toHaveBeenCalled();
  });
  it('restores a saved selection on reopening without treating it as graphic approval', async () => {
    const doc = createBlockoutDocument(); doc.selectedVariantId = 'brief'; doc.variants[0]!.label = 'Text with notes';
    vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'saved' });
    render(<I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockout/layout.json" /></I18nProvider>);
    expect(await screen.findByRole('button', { name: 'Compare all proposals' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose Text with notes' })).toBeNull();
    expect(doc.approval).toBeUndefined(); expect(saveBlockout).not.toHaveBeenCalled(); expect(editorOpened).not.toHaveBeenCalled();
  });
  it('opens page three, navigates the whole proposal, and saves before opening that exact editor page', async () => {
    const doc = createBlockoutDocument(); doc.documentId = 'report';
    doc.variants[0]!.label = 'Continuous report';
    doc.variants[0]!.pages = [1, 2, 3, 4].map((n) => createBlockoutPage(`page-${n}`, `Section ${n}`));
    vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'saved' });
    render(<I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockouts/report/page-3.blockout.json" /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Preview Section 3 · Continuous report' }));
    const modal = screen.getByRole('dialog');
    expect(within(modal).getByRole('img', { name: '3. Section 3' })).toBeTruthy();
    expect(within(modal).getAllByRole('option')).toHaveLength(4);
    expect(editorOpened).not.toHaveBeenCalled(); expect(saveBlockout).not.toHaveBeenCalled();
    fireEvent.click(within(modal).getByRole('button', { name: 'Next page' }));
    expect(within(modal).getByRole('img', { name: '4. Section 4' })).toBeTruthy();
    fireEvent.click(within(modal).getByRole('button', { name: 'Edit this page’s composition' }));
    await waitFor(() => expect(editorOpened).toHaveBeenCalledOnce());
    expect(saveBlockout).toHaveBeenCalledOnce();
    expect(editorOpened.mock.calls[0]![0].detail).toMatchObject({ documentId: 'report', variantId: 'brief', pageId: 'page-4' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('keeps the modal open with no edit action applied when saving fails', async () => {
    const doc = createBlockoutDocument(); doc.variants[0]!.label = 'Text with notes';
    vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'saved' });
    vi.mocked(saveBlockout).mockRejectedValue(new Error('blockout.conflict'));
    render(<I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockout/layout.json" /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Preview Page · Text with notes' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Edit this page’s composition' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeTruthy());
    expect(editorOpened).not.toHaveBeenCalled();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Choose this structure' }).hasAttribute('disabled')).toBe(false);
  });
  it('does not keep an empty comparison catalogue loading forever', async () => {
    vi.mocked(listBlockoutDocuments).mockResolvedValue([]);
    render(<I18nProvider initial="en"><BlockoutComparisonPreview projectId="p" path="documents/report/blockout-comparison.html" /></I18nProvider>);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('requires a proposal choice before exposing page edit controls and opens the exact selected target', async () => {
    const doc = createBlockoutDocument(); doc.documentId = 'report'; doc.title = 'Report';
    doc.variants.push({ ...structuredClone(doc.variants[0]!), id: 'proposal-b', label: 'Drawing first' });
    vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'saved' });
    render(<I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockouts/report/page-1.blockout.json" /></I18nProvider>);
    const choose = await screen.findByRole('button', { name: 'Choose Drawing first' });
    expect(screen.queryByRole('button', { name: /Edit page|Choose and edit|Open Blockout editor/ })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Drawing first' })).getAllByRole('button', { name: /^Preview / })).toHaveLength(1);
    expect(editorOpened).not.toHaveBeenCalled(); fireEvent.click(choose);
    expect(editorOpened).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /Edit page: Drawing first/i }));
    expect(saveBlockout).toHaveBeenCalledWith('p', expect.objectContaining({ activeVariantId: 'proposal-b', selectedVariantId: 'proposal-b' }), 'saved', null);
    expect(vi.mocked(saveBlockout).mock.calls[0]![1].approval).toBeUndefined();
    expect(editorOpened.mock.calls[0]![0].detail).toMatchObject({ projectId: 'p', documentId: 'report', pageId: 'page-1', variantId: 'proposal-b' });
    fireEvent.click(screen.getByRole('button', { name: 'Compare all proposals' }));
    expect(screen.getByRole('button', { name: 'Choose Drawing first' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Edit page:/ })).toBeNull(); expect(editorOpened).toHaveBeenCalledOnce();
    expect(screen.queryByText(/"variants"/)).toBeNull();
  });

  it('routes recognized Blockout cards to comparison while ordinary JSON keeps the normal artifact callback', async () => {
    const document = createBlockoutDocument(); document.variants.push({ ...structuredClone(document.variants[0]!), id: 'alternative', label: 'Alternative' });
    vi.mocked(loadBlockout).mockResolvedValue({ document, raw: 'saved' });
    const onOpen = vi.fn();
    render(<I18nProvider initial="en"><ArtifactCards projectId="p" onOpen={onOpen} items={[
      { name: 'blockout/proposal-a.json', kind: 'doc' }, { name: 'blockout/proposal-b.json', kind: 'doc' },
      { name: 'blockout/starting-point.json', kind: 'doc' }, { name: 'data/results.json', kind: 'doc' },
    ]} /></I18nProvider>);
    expect(await screen.findByText('Document blockout')).toBeTruthy(); expect(screen.getAllByTestId(/^blockout-artifact-/)).toHaveLength(1);
    expect(screen.getByTestId('artifact-card-data/results.json')).toBeTruthy(); expect(screen.queryByText('blockout/starting-point.json')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Compare all proposals' }));
    expect(comparisonOpened).toHaveBeenCalledOnce(); expect(comparisonOpened.mock.calls[0]![0].detail).toEqual({ projectId: 'p', documentId: 'document-1' });
    expect(editorOpened).not.toHaveBeenCalled(); expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('artifact-card-data/results.json').querySelector('button')!);
    expect(onOpen).toHaveBeenCalledWith('data/results.json');
  });

  it('keeps comparison navigation separate from editor navigation', () => {
    openBlockoutProposals({ projectId: 'p', documentId: 'report' });
    expect(comparisonOpened.mock.calls[0]![0].detail).toEqual({ projectId: 'p', documentId: 'report' });
    expect(editorOpened).not.toHaveBeenCalled();
  });

  it('shows the correct saved page number, names and alternative geometry on each per-page chat card', async () => {
    const doc = createBlockoutDocument(); doc.documentId = 'report'; doc.title = 'Survey report';
    const block = (id: string, x: number) => ({ id, label: id, kind: 'text' as const, box: { x, y: 10, width: 20, height: 20, rotation: 0 }, lockRatio: false, expectation: '', flexibility: 'guided' as const, feedback: '', images: [], references: [] });
    doc.variants = ['a', 'b'].map((id, index) => ({ id, label: `Option ${id.toUpperCase()}`, pages: [
      { ...createBlockoutPage(`${id}-cover`, 'Cover'), blocks: [block(`${id}-cover-block`, 5)] },
      { ...createBlockoutPage(`${id}-methods`, 'Methods'), blocks: [block(`${id}-methods-block`, 35 + index * 10)] },
    ] })); doc.activeVariantId = 'a';
    const pageFile = blockoutPageFiles(doc)[1]!;
    const stored = JSON.parse(pageFile.content);
    expect(stored.pageNumber).toBe(2); expect(stored.variants.map((variant: { page: { id: string } }) => variant.page.id)).toEqual(['a-methods', 'b-methods']);
    vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'saved' });
    render(<I18nProvider initial="en"><BlockoutArtifactCard projectId="p" path={pageFile.path} /></I18nProvider>);
    expect(await screen.findByText('Blockout page 2 · Methods · Survey report')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Option A · Methods' }).querySelector('i')!.style.left).toBe('35%');
    expect(screen.getByRole('img', { name: 'Option B · Methods' }).querySelector('i')!.style.left).toBe('45%');
    expect(screen.queryByRole('img', { name: /Cover/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Compare this page' }));
    expect(comparisonOpened.mock.calls[0]![0].detail).toEqual({ projectId: 'p', documentId: 'report', pageId: stored.pageId });
    expect(editorOpened).not.toHaveBeenCalled();
  });

  it('limits a per-page file preview to that logical page and opens the chosen proposal’s actual scoped ID', async () => {
    const doc = createBlockoutDocument(); doc.documentId = 'report'; doc.title = 'Survey report'; doc.activeVariantId = 'a';
    doc.variants = ['a', 'b'].map((id) => ({ id, label: `Option ${id.toUpperCase()}`, pages: [createBlockoutPage(`${id}-cover`, 'Cover'), createBlockoutPage(`${id}-methods`, 'Methods')] }));
    const pageFile = blockoutPageFiles(doc)[1]!;
    vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'saved' });
    render(<I18nProvider initial="en"><BlockoutFilePreview projectId="p" path={pageFile.path} /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Option B' }));
    expect(screen.queryByTestId('overview-page-b-b-cover')).toBeNull();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Choose Option B' })).toBeNull());
    expect(screen.getByTestId('overview-page-b-b-methods')).toBeTruthy();
    expect(screen.getByText('2. Methods')).toBeTruthy();
    expect(screen.getByText('2 pages · allowance not set')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit page: Option B · Methods' }));
    expect(editorOpened.mock.calls[0]![0].detail).toEqual({ projectId: 'p', documentId: 'report', variantId: 'b', pageId: 'b-methods' });
  });
});
