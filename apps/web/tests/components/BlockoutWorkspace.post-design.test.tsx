// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blockoutHandoffSnapshot, createBlockoutDocument, createDocumentPresentation, type BlockoutDesignState, type BlockoutDocument } from '@open-design/contracts';
import { BlockoutWorkspace } from '../../src/components/blockout/BlockoutWorkspace';
import { BlockoutCompositionAction, visibleDesignedPage } from '../../src/components/blockout/BlockoutCompositionAction';
import { isolateDesignedPage } from '../../src/components/blockout/BlockoutDesignUnderlay';
import { I18nProvider } from '../../src/i18n';
import { listBlockoutDocuments, loadBlockout, saveBlockout, saveBlockoutStartingPoint } from '../../src/providers/blockout';
import { loadBlockoutDesign, loadBlockoutDesignUnderlay } from '../../src/providers/blockout-design';
import { BLOCKOUT_OPEN_EVENT } from '../../src/components/blockout/events';
vi.mock('../../src/providers/blockout', () => ({ listBlockoutDocuments: vi.fn(), loadBlockout: vi.fn(), saveBlockout: vi.fn(), saveBlockoutStartingPoint: vi.fn() }));
vi.mock('../../src/providers/blockout-design', () => ({ loadBlockoutDesign: vi.fn(), loadBlockoutDesignUnderlay: vi.fn() }));
vi.mock('../../src/providers/registry', () => ({ projectRawUrl: (_: string, path: string) => `/raw/${path}` }));
vi.mock('../../src/components/blockout/useBlockoutReadiness', () => ({ useBlockoutReadiness: () => ({ legacy: true }) }));
let document: BlockoutDocument, state: BlockoutDesignState;
const html = '<html><head><style>.watermark{inset:0;position:absolute}</style></head><body><main><article data-blockout-document-id="document-1" data-blockout-page-id="page-1"><i class="watermark">Watermark</i><p data-blockout-id="body">Actual design</p></article><article data-blockout-page-id="page-3">Third page</article></main><script>bad()</script></body></html>';
beforeEach(() => {
  localStorage.clear(); document = createBlockoutDocument(); document.title = 'Designed report'; document.selectedVariantId = 'brief'; document.approval = { variantId: 'brief', acceptedAt: '2026-10-26' };
  document.variants[0]!.pages[0]!.blocks = [{ id: 'body', label: 'Text', kind: 'text', box: { x: 10, y: 10, width: 80, height: 60, rotation: 0 }, images: [], references: [], lockRatio: false, expectation: '', feedback: '', flexibility: 'guided' }];
  const snapshot = blockoutHandoffSnapshot(document);
  // Real receipts keep the submitted target separate from measured output geometry.
  state = { version: 1, documentId: document.documentId, sourceChanged: false, pendingChanges: false, pending: [], applied: { revisionId: 'revision', runId: 'real-run', handoffId: 'initial', entryFile: 'report.html', files: [], snapshot, requested: structuredClone(snapshot), pages: [{ pageId: 'page-1', filePath: 'report.html', widthPx: 794, heightPx: 1123, blocks: [] }], status: 'applied', createdAt: '2026-10-26', baseDesignRevisionId: null, inputDigest: 'digest' } };
  vi.mocked(listBlockoutDocuments).mockResolvedValue([{ id: document.documentId, title: document.title }]);
  vi.mocked(loadBlockout).mockImplementation(async () => ({ document: structuredClone(document), raw: 'base' })); vi.mocked(saveBlockout).mockResolvedValue('saved');
  vi.mocked(loadBlockoutDesign).mockImplementation(async () => ({ state, projectId: 'project' }));
  vi.mocked(loadBlockoutDesignUnderlay).mockResolvedValue({ revisionId: 'revision', pageId: 'page-1', filePath: 'report.html', html, widthPx: 794, heightPx: 1123 });
  vi.mocked(saveBlockoutStartingPoint).mockImplementation(async (_project, doc, _context, _raw, options) => ({ path: 'blockouts/document-1/handoffs/update.blockout-update.json', handoff: { version: 1, type: 'blockout-update', id: 'update', action: options!.action!, createdAt: 'now', workspacePath: 'blockout/layout.json', workspaceRevision: 'saved', previousHandoffId: 'initial', previousWorkspaceRevision: 'initial', comparison: 'same-proposal', snapshot: blockoutHandoffSnapshot(doc), changes: [], designBase: state.applied! } }));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const mount = async () => { const onUseBrief = vi.fn(), onClose = vi.fn(); render(<I18nProvider initial="en"><BlockoutWorkspace projectId="project" question={null} initialPageId="page-1" onClose={onClose} onUseBrief={onUseBrief} /></I18nProvider>); await screen.findByRole('button', { name: 'Update the design' }); return { onUseBrief, onClose }; };
it('shows an inert finished design behind blocks, can hide it, and saves page-wide decoration without a new block', async () => {
  await mount(); await waitFor(() => expect(screen.getByTitle('Design reference')).toBeTruthy());
  expect(screen.getByTitle('Design reference').getAttribute('sandbox')).toBe('allow-same-origin');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show finished design as a guide' })); expect(screen.queryByTitle('Design reference')).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: /^Background and watermark/ }), { target: { value: 'A watermark across the full sheet behind text' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
  await waitFor(() => expect(saveBlockout).toHaveBeenCalled());
  const saved = vi.mocked(saveBlockout).mock.calls.at(-1)![1]; expect(saved.variants[0]!.pages[0]!.backgroundIntent).toContain('full sheet'); expect(saved.variants[0]!.pages[0]!.blocks).toHaveLength(1);
});
it.each(['Edit in chat', 'Update the design'])('uses %s to prepare a Design-mode update with exactly one versioned handoff', async (button) => {
  const view = await mount(); fireEvent.click(screen.getByRole('button', { name: button }));
  await waitFor(() => expect(view.onUseBrief).toHaveBeenCalled());
  expect(saveBlockoutStartingPoint).toHaveBeenCalledWith('project', expect.anything(), undefined, 'saved', { action: 'update-design' });
  expect(view.onUseBrief.mock.calls[0]![2]).toBe('design'); expect(view.onUseBrief.mock.calls[0]![1]).toHaveLength(1); expect(view.onClose).toHaveBeenCalledOnce();
});
it('isolates the requested page, keeps head styling and page decoration, and removes executable content', () => {
  const isolated = isolateDesignedPage(html.replace('Actual design', '<span onclick="bad()">Actual design</span>'), 'page-1', 'http://localhost/raw/report.html')!;
  expect(isolated).toContain('Watermark'); expect(isolated).toContain('.watermark'); expect(isolated).not.toContain('Third page'); expect(isolated).not.toContain('<script'); expect(isolated).not.toContain('onclick');
  expect(isolateDesignedPage(html, 'missing', 'http://localhost')).toBeNull();
});
it('opens the current designed page through the preview toolbar without file navigation', async () => {
  const listener = vi.fn(); window.addEventListener(BLOCKOUT_OPEN_EVENT, listener);
  render(<I18nProvider initial="en"><BlockoutCompositionAction projectId="project" filePath="report.html" html={html} getFrame={() => null} /></I18nProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit page composition' })); expect(listener.mock.calls[0]![0].detail).toMatchObject({ documentId: 'document-1', pageId: 'page-1', variantId: 'brief' });
  window.removeEventListener(BLOCKOUT_OPEN_EVENT, listener);
  const frame = window.document.createElement('iframe'); window.document.body.append(frame);
  frame.contentDocument!.body.innerHTML = '<article data-blockout-page-id="page-1"></article><article data-blockout-page-id="page-3"></article>';
  const pages = frame.contentDocument!.querySelectorAll('article');
  pages[0]!.getBoundingClientRect = () => ({ top: -1000, bottom: -100, left: 0, right: 600 }) as DOMRect;
  pages[1]!.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 600 }) as DOMRect;
  expect(visibleDesignedPage(frame, ['page-1', 'page-3'])).toBe('page-3'); frame.remove();
});
it('warns on changed design files and hides a stale reference rather than claiming it matches the draft', async () => {
  state.sourceChanged = true; await mount(); expect(screen.getByText(/Design files have changed/)).toBeTruthy(); expect(screen.queryByTitle('Design reference')).toBeNull();
});
it('adopts completion while open through the same autosave base and undo history without reloading navigation', async () => {
  await mount();
  const completed = structuredClone(state); completed.applied!.revisionId = 'next'; completed.applied!.snapshot.variant.pages[0]!.blocks[0]!.box.x = 12;
  vi.mocked(loadBlockoutDesign).mockResolvedValue({ state: completed, projectId: 'project' });
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(saveBlockout).toHaveBeenCalled());
  expect(vi.mocked(saveBlockout).mock.calls[0]![2]).toBe('base');
  expect(vi.mocked(saveBlockout).mock.calls[0]![1].variants[0]!.pages[0]!.blocks[0]!.box.x).toBe(12);
  expect(loadBlockout).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(vi.mocked(saveBlockout).mock.calls.at(-1)![1].variants[0]!.pages[0]!.blocks[0]!.box.x).toBe(10));
  expect(vi.mocked(saveBlockout).mock.calls.at(-1)![2]).toBe('saved');
});
it('protects an unsaved local edit made while a completion check is in flight', async () => {
  await mount();
  let complete!: (value: { state: BlockoutDesignState; projectId: string }) => void;
  vi.mocked(loadBlockoutDesign).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
  fireEvent(window, new Event('focus'));
  fireEvent.change(screen.getByRole('textbox', { name: /^Background and watermark/ }), { target: { value: 'New user instruction during refresh' } });
  const completed = structuredClone(state); completed.applied!.revisionId = 'next'; completed.applied!.snapshot.variant.pages[0]!.blocks[0]!.box.x = 12;
  complete({ state: completed, projectId: 'project' });
  fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
  await waitFor(() => expect(saveBlockout).toHaveBeenCalled());
  const saved = vi.mocked(saveBlockout).mock.calls.at(-1)![1];
  expect(saved.variants[0]!.pages[0]!.backgroundIntent).toBe('New user instruction during refresh');
  expect(saved.variants[0]!.pages[0]!.blocks[0]!.box.x).toBe(10); expect(vi.mocked(saveBlockout).mock.calls.at(-1)![2]).toBe('base');
});
it('builds the update handoff from the actual saved revision after server metadata normalization', async () => {
  const view = await mount();
  const canonical = structuredClone(document); canonical.title = 'Canonical server title';
  const raw = JSON.stringify(canonical); vi.mocked(saveBlockout).mockResolvedValue(raw);
  fireEvent.click(screen.getByRole('button', { name: 'Edit in chat' }));
  await waitFor(() => expect(view.onUseBrief).toHaveBeenCalled());
  expect(saveBlockoutStartingPoint).toHaveBeenCalledWith('project', canonical, undefined, raw, { action: 'update-design' });
});
it('reopens a registered design after shared presentation edits clear approval, retaining those edits in its update', async () => {
  document.approval = undefined;
  document.presentation = { ...createDocumentPresentation('Updated shared presentation'), header: false, footer: false };
  const view = await mount();
  await screen.findByTitle('Design reference');
  expect(screen.queryByText(/No completed design is linked yet/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Update the design' }));
  await waitFor(() => expect(view.onUseBrief).toHaveBeenCalled());
  const call = vi.mocked(saveBlockoutStartingPoint).mock.calls.at(-1)!;
  expect(call[4]!.action).toBe('update-design'); expect(call[1].presentation).toEqual(document.presentation);
  expect(view.onUseBrief.mock.calls[0]![2]).toBe('design');
});
it.each(['missing', 'pending', 'failed'] as const)('shows a truthful %s registration state before a verified design exists', async (status) => {
  const revision = state.applied!; state.applied = null;
  if (status !== 'missing') state.pending = [{ ...revision, status }];
  const onUseBrief = vi.fn();
  render(<I18nProvider initial="en"><BlockoutWorkspace projectId="project" question={null} onClose={vi.fn()} onUseBrief={onUseBrief} /></I18nProvider>);
  await screen.findByText(status === 'missing' ? /No completed design is linked yet/ : status === 'pending' ? /still being checked/ : /could not become a verified reference/);
  expect(screen.queryByTitle('Design reference')).toBeNull();
  const edit = screen.getByRole('button', { name: 'Edit in chat' }) as HTMLButtonElement;
  expect(edit.disabled).toBe(status === 'pending');
  if (status !== 'pending') {
    fireEvent.click(edit); await waitFor(() => expect(onUseBrief).toHaveBeenCalled());
    expect(vi.mocked(saveBlockoutStartingPoint).mock.calls.at(-1)![4]!.action).toBe('develop-design'); expect(onUseBrief.mock.calls[0]![2]).toBe('design');
  }
});
it('accepts a later page from the opaque preview only for the matching frame, document and request', async () => {
  state.applied!.pages.push({ pageId: 'page-3', filePath: 'report.html', widthPx: 794, heightPx: 1123, blocks: [] });
  const frame = window.document.createElement('iframe'); window.document.body.append(frame);
  const sent = vi.spyOn(frame.contentWindow!, 'postMessage');
  const listener = vi.fn(); window.addEventListener(BLOCKOUT_OPEN_EVENT, listener);
  render(<I18nProvider initial="en"><BlockoutCompositionAction projectId="project" filePath="report.html" html={html} getFrame={() => frame} /></I18nProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit page composition' }));
  const requestId = sent.mock.calls[0]![0].requestId;
  const data = { type: 'od:blockout-visible-page', requestId, documentId: 'document-1', pageId: 'page-3' };
  fireEvent(window, new MessageEvent('message', { source: window, data }));
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data: { ...data, requestId: 'wrong' } }));
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data: { ...data, documentId: 'other' } }));
  expect(listener).not.toHaveBeenCalled();
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data }));
  expect(listener.mock.calls[0]![0].detail.pageId).toBe('page-3');
  window.removeEventListener(BLOCKOUT_OPEN_EVENT, listener); frame.remove();
});
