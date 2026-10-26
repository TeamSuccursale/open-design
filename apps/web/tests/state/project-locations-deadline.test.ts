import { afterEach, expect, it, vi } from 'vitest';
import { fetchProjectLocations } from '../../src/state/project-locations';
import { LOCAL_REQUEST_TIMEOUT_MS, RequestDeadlineError } from '../../src/runtime/request-deadline';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('distinguishes a failed storage lookup from an empty location list for the creation dialog', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
  await expect(fetchProjectLocations({ throwOnError: true })).rejects.toThrow('Could not load project storage locations');
  await expect(fetchProjectLocations()).resolves.toEqual([]);
});

it('bounds a queued location request and aborts it rather than holding browser capacity', async () => {
  vi.useFakeTimers(); let signal!: AbortSignal;
  vi.stubGlobal('fetch', vi.fn((_url, options) => { signal = options.signal; return new Promise(() => {}); }));
  const result = fetchProjectLocations({ throwOnError: true });
  const rejected = expect(result).rejects.toBeInstanceOf(RequestDeadlineError);
  await vi.advanceTimersByTimeAsync(LOCAL_REQUEST_TIMEOUT_MS); await rejected;
  expect(signal.aborted).toBe(true);
});
