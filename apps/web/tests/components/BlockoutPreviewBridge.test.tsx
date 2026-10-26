// @vitest-environment jsdom
import { render, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BLOCKOUT_PREVIEW_OPEN, BLOCKOUT_PROPOSAL_SELECT, createBlockoutDocument, createBlockoutPage } from '@open-design/contracts';
import { useBlockoutPreviewBridge } from '../../src/components/blockout/useBlockoutPreviewBridge';
import { BLOCKOUT_OPEN_EVENT, OPEN_BLOCKOUT_PROPOSALS_EVENT } from '../../src/components/blockout/events';
import { loadBlockout, saveBlockout } from '../../src/providers/blockout';
vi.mock('../../src/providers/blockout', () => ({ loadBlockout: vi.fn(), saveBlockout: vi.fn() }));

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Harness({ path = 'documents/report/blockout-comparison.html' }: { path?: string }) {
  useBlockoutPreviewBridge('current-project', path, (source) => source === window);
  return null;
}
const target = { type: BLOCKOUT_PREVIEW_OPEN, documentId: 'document-2', variantId: 'measured-b', pageId: 'page-3' };
it('routes legacy thumbnails to comparison without bypassing the choice', () => {
  const opened = vi.fn(); window.addEventListener(OPEN_BLOCKOUT_PROPOSALS_EVENT, opened);
  render(<Harness />);
  window.dispatchEvent(new MessageEvent('message', { source: window, data: target }));
  expect(opened).toHaveBeenCalledOnce();
  expect((opened.mock.calls[0]![0] as CustomEvent).detail).toEqual({ projectId: 'current-project', documentId: 'document-2', pageId: 'page-3' });
  expect(saveBlockout).not.toHaveBeenCalled();
  window.removeEventListener(OPEN_BLOCKOUT_PROPOSALS_EVENT, opened);
});
it('opens editing on the requested page only after persisting the explicit choice', async () => {
  const document = createBlockoutDocument(); document.documentId = 'document-2';
  document.variants = [{ id: 'measured-b', label: 'Text with notes', pages: [createBlockoutPage('page-3', 'Findings')] }]; document.activeVariantId = 'measured-b';
  vi.mocked(loadBlockout).mockResolvedValue({ document, raw: 'revision' });
  let resolveSave!: (raw: string) => void;
  vi.mocked(saveBlockout).mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
  const opened = vi.fn(); window.addEventListener(BLOCKOUT_OPEN_EVENT, opened);
  render(<Harness />);
  window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: BLOCKOUT_PROPOSAL_SELECT, documentId: 'document-2', variantId: 'measured-b', editPageId: 'page-3' } }));
  await waitFor(() => expect(saveBlockout).toHaveBeenCalledOnce());
  expect(opened).not.toHaveBeenCalled();
  expect(vi.mocked(saveBlockout).mock.calls[0]![1]).toMatchObject({ selectedVariantId: 'measured-b' });
  expect(vi.mocked(saveBlockout).mock.calls[0]![1].approval).toBeUndefined();
  resolveSave('saved');
  await waitFor(() => expect(opened).toHaveBeenCalledOnce());
  expect((opened.mock.calls[0]![0] as CustomEvent).detail).toEqual({ projectId: 'current-project', documentId: 'document-2', variantId: 'measured-b', pageId: 'page-3' });
  window.removeEventListener(BLOCKOUT_OPEN_EVENT, opened);
});
it('does not open editing or claim success when the save conflicts', async () => {
  const document = createBlockoutDocument();
  vi.mocked(loadBlockout).mockResolvedValue({ document, raw: 'revision' });
  vi.mocked(saveBlockout).mockRejectedValue(new Error('blockout.conflict'));
  const opened = vi.fn(), reply = vi.spyOn(window, 'postMessage'); window.addEventListener(BLOCKOUT_OPEN_EVENT, opened);
  render(<Harness />);
  window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: BLOCKOUT_PROPOSAL_SELECT, documentId: 'document-1', variantId: 'brief', editPageId: 'page-1' } }));
  await waitFor(() => expect(reply).toHaveBeenCalledWith(expect.objectContaining({ saved: false }), '*'));
  expect(opened).not.toHaveBeenCalled();
  window.removeEventListener(BLOCKOUT_OPEN_EVENT, opened);
});
it('ignores other frames, invalid identities and messages from ordinary HTML previews', () => {
  const opened = vi.fn(); window.addEventListener(BLOCKOUT_OPEN_EVENT, opened);
  const view = render(<Harness />);
  window.dispatchEvent(new MessageEvent('message', { source: null, data: target }));
  window.dispatchEvent(new MessageEvent('message', { source: window, data: { ...target, pageId: '../../secret' } }));
  view.rerender(<Harness path="index.html" />);
  window.dispatchEvent(new MessageEvent('message', { source: window, data: target }));
  expect(opened).not.toHaveBeenCalled(); window.removeEventListener(BLOCKOUT_OPEN_EVENT, opened);
});
