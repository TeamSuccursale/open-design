import { afterEach, describe, expect, it, vi } from 'vitest';
import { reattachDaemonRun } from '../../src/providers/daemon';
import { resolveDesignDeliveryOutcome } from '../../src/runtime/design-delivery';
import type { AgentEvent } from '../../src/types';

afterEach(() => vi.unstubAllGlobals());

describe('durable library draft delivery over SSE', () => {
  it('preserves the host save receipt through live/replay transport without inventing a project file', async () => {
    const events: AgentEvent[] = [];
    const receipt = { type: 'diagnostic', name: 'header_footer_draft_saved', source: 'daemon-header-footer',
      shape: { projectId: 'parent', setId: 'model-1', draftVersion: 3, stage: 'graphic' } };
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`event: agent\ndata: ${JSON.stringify(receipt)}\n\nevent: end\ndata: {"status":"succeeded","code":0,"artifactCount":0}\n\n`));
      controller.close();
    } });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/events')
      ? new Response(stream, { status: 200 }) : new Response('{}', { status: 404 })));
    const error = vi.fn();
    await reattachDaemonRun({ runId: 'run-1', signal: new AbortController().signal,
      handlers: { onDelta() {}, onDone() {}, onError: error, onAgentEvent: (event) => { events.push(event); } } });
    expect(error).not.toHaveBeenCalled();
    expect(events).toContainEqual({ kind: 'diagnostic', name: receipt.name, source: receipt.source, shape: receipt.shape });
    expect(resolveDesignDeliveryOutcome({ sessionMode: 'design', runStatus: 'succeeded', content: 'Draft ready', events,
      producedFileCount: 0, traceObjectFileCount: 0, artifactCount: 0 })).toBe('delivered');
  });
});
