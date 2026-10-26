import { afterEach, expect, it, vi } from 'vitest';
import { streamViaDaemon } from '../../src/providers/daemon';
afterEach(() => vi.unstubAllGlobals());
it('sends document IDs separately from file attachment paths in the run request', async () => {
  let request: Record<string, unknown> | undefined;
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    if (options?.method === 'POST') { request = JSON.parse(options.body); return new Response(JSON.stringify({ error: { message: 'test boundary reached' } }), { status: 400, headers: { 'content-type': 'application/json' } }); }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  await streamViaDaemon({ agentId: 'codex', projectId: 'p', history: [{ id: 'message-1', role: 'user', content: '@Report compare this' }], documentReferences: ['doc-report'], attachments: [], signal: new AbortController().signal, handlers: { onAgentEvent: vi.fn(), onDelta: vi.fn(), onError: vi.fn(), onDone: vi.fn() } }).catch(() => undefined);
  expect(request?.documentReferences).toEqual(['doc-report']); expect(request?.attachments).toEqual([]);
});
