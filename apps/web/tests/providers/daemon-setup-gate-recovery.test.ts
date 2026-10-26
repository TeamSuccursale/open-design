import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamViaDaemon } from '../../src/providers/daemon';

afterEach(() => vi.unstubAllGlobals());
const refused = (code = 'DOCUMENT_SETUP_CONFIRMATION_REQUIRED', status = 409) => Response.json({ error: { code, message: 'Confirm the brief in chat before generating pages.' } }, { status });
function options(overrides: Record<string, unknown> = {}) {
  return { agentId: 'codex', projectId: 'project', conversationId: 'document-chat', sessionMode: 'blockout' as const,
    clientRequestId: 'same-request', userMessageId: 'same-user', assistantMessageId: 'same-assistant',
    history: [{ id: 'same-user', role: 'user' as const, content: 'Prepare the report proposals.' }],
    signal: new AbortController().signal, handlers: { onAgentEvent: vi.fn(), onDelta: vi.fn(), onError: vi.fn(), onDone: vi.fn() }, ...overrides };
}
describe('chat transport recovers an unfinished document brief', () => {
  it('retries only the known pre-run admission gate as chat with the exact same identity and starts one native run', async () => {
    const bodies: Record<string, unknown>[] = [], created = vi.fn(), args = options({ onRunCreated: created });
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/runs' && init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)));
        return bodies.length === 1 ? refused() : Response.json({ runId: 'only-native-run' }, { status: 202 });
      }
      if (url.includes('/events')) return new Response('id: 1\nevent: end\ndata: {"status":"succeeded","code":0}\n\n', { headers: { 'content-type': 'text/event-stream' } });
      return Response.json({ id: 'only-native-run', status: 'succeeded', exitCode: 0 });
    });
    vi.stubGlobal('fetch', fetch);
    await streamViaDaemon(args);
    expect(bodies).toHaveLength(2); expect(bodies[0]?.sessionMode).toBe('blockout'); expect(bodies[1]?.sessionMode).toBe('chat');
    expect({ ...bodies[1], sessionMode: 'blockout' }).toEqual(bodies[0]);
    expect(created).toHaveBeenCalledExactlyOnceWith('only-native-run'); expect(args.handlers.onError).not.toHaveBeenCalled(); expect(args.handlers.onDone).toHaveBeenCalledOnce();
  });
  it('stops after one conversational retry and exposes the actual refusal if the gate is still unmet', async () => {
    const fetch = vi.fn().mockImplementation(async () => refused()), args = options();
    vi.stubGlobal('fetch', fetch); await streamViaDaemon(args);
    expect(fetch).toHaveBeenCalledTimes(2); expect(args.handlers.onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'DOCUMENT_SETUP_CONFIRMATION_REQUIRED', status: 409, message: 'Confirm the brief in chat before generating pages.' }));
  });
  it.each([['WORKSPACE_FORBIDDEN', 403], ['CONVERSATION_NOT_FOUND', 404], ['DOCUMENT_REFERENCE_INVALID', 400], ['DOCUMENT_CONTEXT_CHANGED', 409]])('does not reinterpret %s as permission to switch phases', async (code, status) => {
    const fetch = vi.fn().mockImplementation(async () => refused(String(code), Number(status))), args = options();
    vi.stubGlobal('fetch', fetch); await streamViaDaemon(args);
    expect(fetch).toHaveBeenCalledOnce(); expect(args.handlers.onError).toHaveBeenCalledWith(expect.objectContaining({ code, status }));
  });
  it('does not retry a conversation already in chat mode', async () => {
    const fetch = vi.fn().mockImplementation(async () => refused()), args = options({ sessionMode: 'chat' });
    vi.stubGlobal('fetch', fetch); await streamViaDaemon(args);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
