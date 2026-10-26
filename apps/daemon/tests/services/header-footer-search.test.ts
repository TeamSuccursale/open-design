import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HeaderFooterAsset, HeaderFooterSearch, HeaderFooterSearchRequest } from '@open-design/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeaderFooterSearchService, headerFooterLogoWorkerPrompt, type HeaderFooterLogoWorkerRunner, type HeaderFooterSearchStore } from '../../src/services/header-footer-search.js';
import type { HeaderFooterAssetInput } from '../../src/services/header-footer-assets.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
const logo = '<svg viewBox="0 0 180 60"><path d="M0 0h180v60H0z"/></svg>';
async function fixture(): Promise<HeaderFooterSearchStore & { searches: HeaderFooterSearch[]; assets: HeaderFooterAsset[] }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'melillo-logo-search-')); temporary.push(directory);
  const searches: HeaderFooterSearch[] = [], assets: HeaderFooterAsset[] = [];
  return {
    identity: randomUUID(), searches, assets, assetDirectory: async () => directory,
    listSearches: async () => structuredClone(searches), getSearch: async (id) => { const found = searches.find((entry) => entry.id === id); if (!found) throw new Error('not found'); return structuredClone(found); },
    createSearch: async (input: HeaderFooterSearchRequest) => { const entry: HeaderFooterSearch = { target: input.target, ...(input.website ? { website: input.website } : {}), ...(input.guidance ? { guidance: input.guidance } : {}), id: randomUUID(), model: 'gpt-6.1-sol', effort: 'low', status: 'queued', attempt: 0, assetIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; searches.push(entry); return structuredClone(entry); },
    updateSearch: async (id, patch) => { const entry = searches.find((item) => item.id === id)!; Object.assign(entry, patch); return structuredClone(entry); },
    addAsset: async (input: HeaderFooterAssetInput, data: Buffer) => { const asset: HeaderFooterAsset = { ...input, id: randomUUID(), size: data.length, sha256: createHash('sha256').update(data).digest('hex'), createdAt: new Date().toISOString(), url: '/owned/logo' }; assets.push(asset); return asset; },
  };
}
const runner: HeaderFooterLogoWorkerRunner = async (request) => {
  await request.onSession(`session-${request.workerId}`);
  await writeFile(path.join(request.outputDirectory, 'logo.svg'), logo);
  return { status: 'ready', candidates: [{ label: request.target.target, sourceUrl: 'https://organisation.example/logo.svg', filename: 'logo.svg' }], error: null, browserUsed: false };
};

describe('bounded per-logo Codex acquisition', () => {
  it('persists distinct Sol/low targets and sessions, actual bytes/provenance, and deduplicates repeated starts', async () => {
    const store = await fixture(), observed = vi.fn(runner), service = new HeaderFooterSearchService({ runner: observed });
    const [first, duplicate, second] = await Promise.all([service.start(store, { target: 'Organisation One' }), service.start(store, { target: 'Organisation One' }), service.start(store, { target: 'Organisation Two' })]);
    expect(first.id).toBe(duplicate.id); expect(second.id).not.toBe(first.id); await service.waitForIdle();
    expect(observed).toHaveBeenCalledTimes(2); expect(store.searches.every((search) => search.status === 'ready' && search.model === 'gpt-6.1-sol' && search.effort === 'low' && search.sessionId && search.attempt === 1)).toBe(true);
    expect(new Set(store.searches.map((search) => search.sessionId)).size).toBe(2);
    expect(store.assets).toHaveLength(2); expect(store.assets[0]).toMatchObject({ source: 'web', sourceUrl: 'https://organisation.example/logo.svg', width: 180, height: 60, mimeType: 'image/svg+xml' });
    expect(headerFooterLogoWorkerPrompt(observed.mock.calls[0]![0])).not.toMatch(/all project images|gallery catalog/);
  });
  it('keeps ambiguous matches as candidates and never marks a remote hotlink as an acquired logo', async () => {
    const store = await fixture();
    const service = new HeaderFooterSearchService({ runner: async () => ({ status: 'ready', candidates: [{ label: 'Possible mark', sourceUrl: 'https://organisation.example/logo.svg', filename: null }], browserUsed: false, error: null }) });
    const search = await service.start(store, { target: 'Ambiguous identity' }); await service.waitForIdle();
    expect((await store.getSearch(search.id)).status).toBe('candidate'); expect(store.assets).toHaveLength(0);
  });
  it('limits concurrency, cancels a queued target without starting a session, and preserves completed downloads', async () => {
    const store = await fixture(); let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const observed = vi.fn<HeaderFooterLogoWorkerRunner>(async (request) => { await barrier; return runner(request); });
    const service = new HeaderFooterSearchService({ runner: observed, maxConcurrent: 1 });
    await service.start(store, { target: 'First identity' }); const second = await service.start(store, { target: 'Second identity' });
    await vi.waitFor(() => expect(observed).toHaveBeenCalledTimes(1));
    expect((await store.getSearch(second.id)).status).toBe('queued'); await service.cancel(store, second.id); release(); await service.waitForIdle();
    expect(observed).toHaveBeenCalledTimes(1); expect((await store.getSearch(second.id)).status).toBe('cancelled'); expect(store.assets).toHaveLength(1);
  });
  it('retries a failed target under the same identity with a new worker and attempt', async () => {
    const store = await fixture(); let broken = true;
    const service = new HeaderFooterSearchService({ runner: async (request) => { if (broken) throw new Error('Download blocked'); return runner(request); } });
    const first = await service.start(store, { target: 'Retry identity' }); await service.waitForIdle(); const failed = await store.getSearch(first.id);
    expect(failed).toMatchObject({ status: 'failed', error: 'Download blocked', attempt: 1 });
    broken = false; await service.retry(store, first.id); await service.waitForIdle(); const ready = await store.getSearch(first.id);
    expect(ready.status).toBe('ready'); expect(ready.attempt).toBe(2); expect(ready.workerId).not.toBe(failed.workerId);
  });
  it('rejects escaping output files and unsafe source URLs instead of importing them', async () => {
    for (const candidate of [{ label: 'Bad', sourceUrl: 'https://example.com/logo.svg', filename: '../escape.svg' }, { label: 'Bad', sourceUrl: 'file:///private/logo.svg', filename: 'logo.svg' }]) {
      const store = await fixture(); const service = new HeaderFooterSearchService({ runner: async () => ({ status: 'ready', candidates: [candidate], error: null, browserUsed: false }) });
      const search = await service.start(store, { target: 'Invalid result' }); await service.waitForIdle();
      expect((await store.getSearch(search.id)).status).toBe('failed'); expect(store.assets).toHaveLength(0);
    }
  });
  it('makes interrupted work retryable after restart while queued work resumes exactly once', async () => {
    const store = await fixture(); const interrupted = await store.createSearch({ target: 'Interrupted' }); await store.updateSearch(interrupted.id, { status: 'searching', attempt: 1 });
    const queued = await store.createSearch({ target: 'Queued' }), observed = vi.fn(runner), service = new HeaderFooterSearchService({ runner: observed });
    await service.recover(store); await service.recover(store); await service.waitForIdle();
    expect((await store.getSearch(interrupted.id)).status).toBe('failed'); expect((await store.getSearch(interrupted.id)).error).toContain('riavvio');
    expect((await store.getSearch(queued.id)).status).toBe('ready'); expect(observed).toHaveBeenCalledTimes(1);
  });
  it('cancellation during an active session does not later overwrite cancelled state or import a logo', async () => {
    const store = await fixture(); let release!: () => void; const barrier = new Promise<void>((resolve) => { release = resolve; });
    const observed = vi.fn<HeaderFooterLogoWorkerRunner>(async (request) => { await barrier; return runner(request); });
    const service = new HeaderFooterSearchService({ runner: observed }); const search = await service.start(store, { target: 'Cancel me' });
    await vi.waitFor(() => expect(observed).toHaveBeenCalledTimes(1)); await service.cancel(store, search.id); release(); await service.waitForIdle();
    expect((await store.getSearch(search.id)).status).toBe('cancelled'); expect(store.assets).toHaveLength(0);
  });
  it('recovers from an unavailable state store without an unhandled background rejection', async () => {
    const store = await fixture(), realUpdate = store.updateSearch.bind(store), warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let unavailable = true;
    store.updateSearch = async (id, patch) => { if (unavailable) throw new Error('ENOSPC'); return realUpdate(id, patch); };
    const service = new HeaderFooterSearchService({ runner });
    const search = await service.start(store, { target: 'Interrupted by disk space' }); await service.waitForIdle();
    expect(warning).toHaveBeenCalled(); expect((await store.getSearch(search.id)).status).toBe('queued');
    unavailable = false; await service.retry(store, search.id); await service.waitForIdle();
    expect((await store.getSearch(search.id)).status).toBe('ready'); warning.mockRestore();
  });
});
