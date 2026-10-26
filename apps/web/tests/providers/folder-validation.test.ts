import { afterEach, expect, it, vi } from 'vitest';
import { dirExists } from '../../src/providers/registry';

afterEach(() => vi.unstubAllGlobals());

it('does not turn a service failure into a successful strict creation preflight', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
  await expect(dirExists('C:/Sources', { throwOnError: true })).rejects.toThrow('Could not check the selected folder');
  // Passive folder hints retain their established fail-open behavior.
  await expect(dirExists('C:/Sources')).resolves.toBe(true);
});

it('propagates preflight abort and its signal instead of treating a canceled check as an existing folder', async () => {
  const controller = new AbortController(); const reason = new DOMException('Timed out', 'AbortError');
  const fetch = vi.fn(async (_url, options) => { expect(options.signal).toBe(controller.signal); throw reason; });
  vi.stubGlobal('fetch', fetch);
  await expect(dirExists('C:/Sources', { signal: controller.signal, throwOnError: true })).rejects.toBe(reason);
});
