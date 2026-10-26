import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { blockoutDesignBridge } from '../src/runtime/blockout-design-bridge.js';
it('reports the visible later page across an opaque frame and accepts location requests only from its parent', () => {
  let listener!: (event: { source: unknown; data: unknown }) => void;
  const parent = { postMessage: vi.fn() };
  const page = (id: string, top: number, bottom: number) => ({ getBoundingClientRect: () => ({ top, bottom, left: 0, right: 600 }), getAttribute: (key: string) => key === 'data-blockout-page-id' ? id : 'report' });
  const script = blockoutDesignBridge().replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  runInNewContext(script, { window: { addEventListener: (_event: string, callback: typeof listener) => { listener = callback; } }, document: { querySelectorAll: () => [page('page-1', -1800, -1000), page('page-2', -900, -100), page('page-3', 0, 800)] }, innerWidth: 600, innerHeight: 800, parent });
  const data = { type: 'od:blockout-visible-page-request', requestId: 'test' };
  listener({ source: {}, data }); expect(parent.postMessage).not.toHaveBeenCalled();
  listener({ source: parent, data }); expect(parent.postMessage).toHaveBeenCalledWith({ type: 'od:blockout-visible-page', requestId: 'test', pageId: 'page-3', documentId: 'report' }, '*');
});
