import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreviewLogoCache, PreviewLogoError, referencedPreviewLogos, warmPreviewLogos, type PreviewImage, type PreviewLogo } from '../../src/components/header-footer/preview-image-readiness';
import type { HeaderFooterVariant } from '@open-design/contracts';

function logo(id: string, sha256 = id): PreviewLogo {
  return { id, name: `Logo ${id}`, url: `/assets/${id}`, sha256 };
}

class DeferredImage implements PreviewImage {
  naturalWidth = 120;
  naturalHeight = 40;
  fetchPriority: PreviewImage['fetchPriority'] = 'auto';
  assignedPriority?: string;
  private source = '';
  private resolve!: () => void;
  private reject!: (reason: unknown) => void;
  readonly pending = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
  readonly decode = vi.fn(() => this.pending);
  readonly removeAttribute = vi.fn((name: string) => { if (name === 'src') this.source = ''; });
  get src() { return this.source; }
  set src(value: string) { this.assignedPriority = this.fetchPriority; this.source = value; }
  ready() { this.resolve(); }
  fail() { this.reject(new Error('decode rejected')); }
}

function batch(assets: readonly PreviewLogo[], options: { timeoutMs?: number; cache?: ReturnType<typeof createPreviewLogoCache> } = {}) {
  const images: DeferredImage[] = [], abort = new AbortController();
  const createImage = vi.fn(() => { const image = new DeferredImage(); images.push(image); return image; });
  const promise = warmPreviewLogos(assets, { signal: abort.signal, createImage, cache: options.cache ?? createPreviewLogoCache(), timeoutMs: options.timeoutMs });
  return { images, abort, createImage, promise };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('preview logo image readiness', () => {
  it('keeps pending decode unready, uses the original URL, and sets priority before src without fetch', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const run = batch([logo('pending')]);
    let ready = false; void run.promise.then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(run.images[0]!.src).toBe('/assets/pending');
    expect(run.images[0]!.assignedPriority).toBe('high');
    expect(fetch).not.toHaveBeenCalled();
    run.images[0]!.ready(); await run.promise;
    expect(ready).toBe(true);
  });

  it('caps active decodes at two and deduplicates repeated URL/hash references', async () => {
    const run = batch([logo('a'), logo('a'), logo('b'), logo('c')]);
    expect(run.images).toHaveLength(2);
    run.images[0]!.ready(); await vi.waitFor(() => expect(run.images).toHaveLength(3));
    run.images[1]!.ready(); run.images[2]!.ready(); await run.promise;
    expect(run.createImage).toHaveBeenCalledTimes(3);
  });

  it('rejects decode failure with the affected logo and cancels the other active image', async () => {
    const run = batch([logo('broken'), logo('other')]);
    const failure = expect(run.promise).rejects.toMatchObject({ name: 'PreviewLogoError', asset: logo('broken') });
    run.images[0]!.fail(); await failure;
    expect(run.images[0]!.removeAttribute).toHaveBeenCalledWith('src');
    expect(run.images[1]!.removeAttribute).toHaveBeenCalledWith('src');
  });

  it('rejects decoded images with zero intrinsic dimensions', async () => {
    const run = batch([logo('zero')]);
    const failure = expect(run.promise).rejects.toBeInstanceOf(PreviewLogoError);
    run.images[0]!.naturalWidth = 0; run.images[0]!.ready(); await failure;
  });

  it('retries real decode after failure and reuses only successful URL/hash results', async () => {
    const cache = createPreviewLogoCache(), asset = logo('retry');
    const failed = batch([asset], { cache });
    const failure = expect(failed.promise).rejects.toBeInstanceOf(PreviewLogoError);
    failed.images[0]!.fail(); await failure;
    const retry = batch([asset], { cache });
    expect(retry.images).toHaveLength(1); retry.images[0]!.ready(); await retry.promise;
    const cached = batch([asset], { cache }); await cached.promise;
    expect(cached.images).toHaveLength(0);
    const changed = batch([logo('retry', 'new hash')], { cache });
    expect(changed.images).toHaveLength(1); changed.images[0]!.ready(); await changed.promise;
  });

  it('enforces the finite overall deadline and clears every active source', async () => {
    vi.useFakeTimers();
    const run = batch([logo('timeout-a'), logo('timeout-b'), logo('never-started')], { timeoutMs: 15_000 });
    const failure = expect(run.promise).rejects.toBeInstanceOf(PreviewLogoError);
    await vi.advanceTimersByTimeAsync(15_000); await failure;
    expect(run.images).toHaveLength(2);
    expect(run.images.every((image) => image.src === '')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts on close and ignores stale decode completion without caching it', async () => {
    const cache = createPreviewLogoCache(), asset = logo('stale');
    const run = batch([asset], { cache });
    const failure = expect(run.promise).rejects.toMatchObject({ name: 'AbortError' });
    run.abort.abort(); await failure; run.images[0]!.ready(); await Promise.resolve();
    expect(cache.has(asset)).toBe(false);
    expect(run.images[0]!.src).toBe('');
  });

  it('is immediately ready for no-logo designs without allocating images', async () => {
    const run = batch([]); await run.promise;
    expect(run.createImage).not.toHaveBeenCalled();
  });

  it('evicts old successful images from the bounded cache', async () => {
    const cache = createPreviewLogoCache(1), first = logo('first'), second = logo('second');
    const one = batch([first], { cache }); one.images[0]!.ready(); await one.promise;
    const two = batch([second], { cache }); two.images[0]!.ready(); await two.promise;
    expect(cache.has(first)).toBe(false); expect(cache.has(second)).toBe(true);
  });
});

describe('referenced preview logos', () => {
  const variant = (id: string, assetId: string, region: 'header' | 'footer' = 'header'): HeaderFooterVariant => ({
    id, name: id, pageWidthMm: 210, pageHeightMm: 297, headerHeightMm: 28, footerHeightMm: 20,
    blocks: [{ id: `block-${id}`, kind: 'logo', region, x: .1, y: .1, width: .2, height: .5, assetId }],
  });
  it('includes enabled logos in every applied format, not only the active preview', () => {
    const result = referencedPreviewLogos([variant('portrait', 'a'), variant('landscape', 'b')], [logo('a'), logo('b')], { header: true, footer: true });
    expect(result.assets.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result.missingAsset).toBeUndefined();
  });
  it('ignores disabled regions and deduplicates shared logo references', () => {
    const result = referencedPreviewLogos([variant('one', 'a'), variant('two', 'a'), variant('three', 'missing', 'footer')], [logo('a')], { header: true, footer: false });
    expect(result.assets).toEqual([logo('a')]); expect(result.missingAsset).toBeUndefined();
  });
  it('reports a missing reference or empty URL rather than a no-logo design', () => {
    expect(referencedPreviewLogos([variant('one', 'missing')], [], { header: true, footer: true }).missingAsset).toBe('missing');
    expect(referencedPreviewLogos([variant('one', 'a')], [{ ...logo('a'), url: '' }], { header: true, footer: true }).missingAsset).toBe('Logo a');
  });
});
