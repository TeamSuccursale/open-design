import { afterEach, expect, it, vi } from 'vitest';
import { RequestDeadlineError, withRequestDeadline } from '../../src/runtime/request-deadline';

afterEach(() => vi.useRealTimers());

it('aborts a stalled transport and rejects even when that transport ignores the abort', async () => {
  vi.useFakeTimers(); let signal!: AbortSignal;
  const result = withRequestDeadline((value) => { signal = value; return new Promise(() => {}); }, { timeoutMs: 100 });
  const rejected = expect(result).rejects.toBeInstanceOf(RequestDeadlineError);
  await vi.advanceTimersByTimeAsync(100); await rejected;
  expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
});

it('cancels an abandoned read immediately and clears its timer', async () => {
  vi.useFakeTimers(); const controller = new AbortController(); let signal!: AbortSignal;
  const result = withRequestDeadline((value) => { signal = value; return new Promise(() => {}); }, { signal: controller.signal });
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await rejected;
  expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
});

it('clears the deadline after a successful read so it cannot abort later', async () => {
  vi.useFakeTimers(); let signal!: AbortSignal;
  await expect(withRequestDeadline(async (value) => { signal = value; return 'ready'; })).resolves.toBe('ready');
  expect(signal.aborted).toBe(false); expect(vi.getTimerCount()).toBe(0);
});
