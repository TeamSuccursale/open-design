// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryToast, memoryToastSubscriptionMode } from '../../src/components/MemoryToast';
import { I18nProvider } from '../../src/i18n';

type Listener = (event: MessageEvent) => void;
class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly listeners = new Map<string, Set<Listener>>();
  closed = false;
  constructor(readonly url: string) { MockEventSource.instances.push(this); }
  addEventListener(name: string, listener: EventListener): void {
    const listeners = this.listeners.get(name) ?? new Set<Listener>();
    listeners.add(listener as Listener);
    this.listeners.set(name, listeners);
  }
  close(): void { this.closed = true; }
  dispatch(name: string, data: unknown): void {
    const event = new MessageEvent(name, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

function renderToast(subscriptionMode: Parameters<typeof MemoryToast>[0]['subscriptionMode']) {
  return render(<I18nProvider initial="en"><MemoryToast subscriptionMode={subscriptionMode} /></I18nProvider>);
}
function mode(view: ReturnType<typeof renderToast>, value: 'off' | 'idle' | 'activity') {
  view.rerender(<I18nProvider initial="en"><MemoryToast subscriptionMode={value} /></I18nProvider>);
}
function handoff() {
  const view = renderToast('activity');
  mode(view, 'idle');
  return view;
}
function visibility(value: 'visible' | 'hidden') {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
}
function extraction(phase: 'running' | 'success') {
  return { id: 'extract-1', phase, startedAt: 1, userMessagePreview: 'remember this' };
}
function snapshot(phase?: 'running' | 'success') {
  return Response.json({ extractions: phase ? [extraction(phase)] : [] });
}

beforeEach(() => {
  vi.useFakeTimers();
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal('fetch', vi.fn(async () => snapshot()));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('MemoryToast connection budget', () => {
  it('arms extraction observation only for project activity, never idle Home or the Memory surface', () => {
    expect(memoryToastSubscriptionMode({ routeKind: 'project', projectRunActive: false, memorySurfaceOpen: false })).toBe('idle');
    expect(memoryToastSubscriptionMode({ routeKind: 'project', projectRunActive: true, memorySurfaceOpen: false })).toBe('activity');
    expect(memoryToastSubscriptionMode({ routeKind: 'home', projectRunActive: false, memorySurfaceOpen: false })).toBe('off');
    expect(memoryToastSubscriptionMode({ routeKind: 'project', projectRunActive: true, memorySurfaceOpen: true })).toBe('off');
  });

  it('leaves every HTTP slot available while four visible Home tabs prepare projects', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const homeMode = memoryToastSubscriptionMode({ routeKind: 'home', projectRunActive: false, memorySurfaceOpen: false });
    const views = Array.from({ length: 4 }, () => renderToast(homeMode));
    renderToast(undefined);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      vi.advanceTimersByTime(120_000);
    });
    expect(MockEventSource.instances).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    for (const view of views) view.unmount();
  });

  it('reserves no memory streams for four active native runs and opens only on completion', async () => {
    const views = Array.from({ length: 4 }, () => renderToast('activity'));
    act(() => vi.advanceTimersByTime(120_000));
    expect(MockEventSource.instances).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    mode(views[0]!, 'idle');
    await act(async () => {});
    expect(MockEventSource.instances).toHaveLength(1);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/memory/extractions');
    expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({ cache: 'no-store' });
    expect(vi.mocked(fetch).mock.calls[0]![1]?.method).toBeUndefined();
  });

  it('does not mistake Home or Memory settings navigation for a completed run', () => {
    const view = renderToast('activity');
    mode(view, 'off');
    act(() => vi.advanceTimersByTime(120_000));
    expect(MockEventSource.instances).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();

    mode(view, 'activity');
    mode(view, 'idle');
    const source = MockEventSource.instances[0]!;
    mode(view, 'off');
    expect(source.closed).toBe(true);
  });

  it('allows ten seconds for extraction to announce itself even after an empty initial snapshot', async () => {
    handoff();
    const source = MockEventSource.instances[0]!;
    await act(async () => {});
    act(() => vi.advanceTimersByTime(9_999));
    expect(source.closed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(source.closed).toBe(true);
  });

  it('catches a running extraction that announced itself before the UI received the run terminal frame', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => snapshot('running')));
    handoff();
    const source = MockEventSource.instances[0]!;
    await act(async () => {});
    act(() => vi.advanceTimersByTime(30_000));
    expect(source.closed).toBe(false);
    act(() => { source.dispatch('extraction', extraction('success')); vi.advanceTimersByTime(0); });
    expect(source.closed).toBe(true);
  });

  it('shows the memory update and releases its hand-off after extraction finishes', async () => {
    const view = handoff();
    const source = MockEventSource.instances[0]!;
    await act(async () => {});
    act(() => {
      vi.advanceTimersByTime(9_000);
      source.dispatch('extraction', extraction('running'));
      vi.advanceTimersByTime(21_000);
    });
    expect(source.closed).toBe(false);
    act(() => {
      source.dispatch('change', { kind: 'extract', count: 2, source: 'llm' });
      source.dispatch('extraction', extraction('success'));
      vi.advanceTimersByTime(0);
    });
    expect(view.getByRole('status').textContent).toContain('(2 · LLM)');
    expect(source.closed).toBe(true);
  });

  it('expires post-run observation after sixty seconds if the terminal frame is lost', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => snapshot('running')));
    handoff();
    const source = MockEventSource.instances[0]!;
    await act(async () => {});
    act(() => vi.advanceTimersByTime(59_999));
    expect(source.closed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(source.closed).toBe(true);
    act(() => { window.dispatchEvent(new Event('focus')); vi.advanceTimersByTime(120_000); });
    expect(MockEventSource.instances).toHaveLength(1);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('immediately ends an old hand-off for a new run and arms a fresh hand-off only on its completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => snapshot('running')));
    const view = handoff();
    const first = MockEventSource.instances[0]!;
    await act(async () => {});
    act(() => vi.advanceTimersByTime(30_000));
    mode(view, 'activity');
    expect(first.closed).toBe(true);
    act(() => vi.advanceTimersByTime(120_000));
    expect(MockEventSource.instances).toHaveLength(1);
    mode(view, 'idle');
    const next = MockEventSource.instances[1]!;
    await act(async () => {});
    act(() => vi.advanceTimersByTime(59_999));
    expect(next.closed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(next.closed).toBe(true);
  });
});

describe('MemoryToast hidden hand-off ownership', () => {
  it('does not open while hidden and opens once on return before hidden grace expires', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    handoff();
    expect(MockEventSource.instances).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1_000));
    visibility('visible');
    await act(async () => {});
    expect(MockEventSource.instances).toHaveLength(1);
    act(() => window.dispatchEvent(new Event('focus')));
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it('releases a hidden hand-off and does not resurrect it after absolute expiry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => snapshot('running')));
    handoff();
    const first = MockEventSource.instances[0]!;
    await act(async () => {});
    visibility('hidden');
    act(() => vi.advanceTimersByTime(29_999));
    expect(first.closed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(first.closed).toBe(true);
    act(() => vi.advanceTimersByTime(120_000));
    visibility('visible');
    expect(MockEventSource.instances).toHaveLength(1);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('reconciles completion while hidden and releases without cancelling native work', async () => {
    const fetchMock = vi.fn(async () => snapshot('running'));
    vi.stubGlobal('fetch', fetchMock);
    handoff();
    await act(async () => {});
    visibility('hidden');
    act(() => vi.advanceTimersByTime(30_000));
    fetchMock.mockImplementation(async () => snapshot('success'));
    visibility('visible');
    await act(async () => {});
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1]!.closed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(fetch).mock.calls) expect(call[1]?.method).toBeUndefined();
  });

  it('retains a still-running extraction on return and closes on its terminal event', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => snapshot('running')));
    handoff();
    await act(async () => {});
    visibility('hidden');
    act(() => vi.advanceTimersByTime(30_000));
    visibility('visible');
    await act(async () => {});
    const resumed = MockEventSource.instances[1]!;
    expect(resumed.closed).toBe(false);
    act(() => { resumed.dispatch('extraction', extraction('success')); vi.advanceTimersByTime(0); });
    expect(resumed.closed).toBe(true);
  });

  it('drops stale ownership on snapshot failure so the visible idle tab releases its stream', async () => {
    const fetchMock = vi.fn(async () => snapshot('running'));
    vi.stubGlobal('fetch', fetchMock);
    handoff();
    await act(async () => {});
    visibility('hidden');
    act(() => vi.advanceTimersByTime(30_000));
    fetchMock.mockRejectedValue(new Error('offline'));
    visibility('visible');
    await act(async () => {});
    expect(MockEventSource.instances[1]!.closed).toBe(true);
  });

  it('releases stale IDs when extraction history was cleared while hidden', async () => {
    const fetchMock = vi.fn(async () => snapshot('running'));
    vi.stubGlobal('fetch', fetchMock);
    handoff();
    await act(async () => {});
    visibility('hidden');
    act(() => vi.advanceTimersByTime(30_000));
    fetchMock.mockImplementation(async () => snapshot());
    visibility('visible');
    await act(async () => {});
    expect(MockEventSource.instances[1]!.closed).toBe(true);
  });

  it('keeps a newer terminal SSE transition when an older running snapshot arrives', async () => {
    let resolveSnapshot!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveSnapshot = resolve; })));
    handoff();
    const source = MockEventSource.instances[0]!;
    act(() => source.dispatch('extraction', extraction('success')));
    await act(async () => resolveSnapshot(snapshot('running')));
    act(() => vi.advanceTimersByTime(0));
    expect(source.closed).toBe(true);
  });
});
