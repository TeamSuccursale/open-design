import type { HeaderFooterVariant } from '@open-design/contracts';

export interface PreviewLogo {
  id: string;
  name: string;
  url: string;
  sha256: string;
}

export type PreviewImage = Pick<HTMLImageElement,
  'src' | 'fetchPriority' | 'decode' | 'naturalWidth' | 'naturalHeight' | 'removeAttribute'>;

export class PreviewLogoError extends Error {
  constructor(readonly asset: PreviewLogo, options?: ErrorOptions) {
    super(`The preview could not display ${asset.name}`, options);
    this.name = 'PreviewLogoError';
  }
}

const keyFor = (asset: PreviewLogo) => JSON.stringify([asset.url, asset.sha256]);

/** A revision can apply several formats, including one outside the current preview. */
export function referencedPreviewLogos(variants: readonly HeaderFooterVariant[], assets: readonly PreviewLogo[], regions: { header: boolean; footer: boolean }) {
  const referenced = new Map<string, PreviewLogo>();
  for (const variant of variants) {
    for (const block of variant.blocks) {
      if (block.kind !== 'logo' || !regions[block.region]) continue;
      const asset = assets.find((item) => item.id === block.assetId);
      if (!asset?.url.trim()) return { assets: [...referenced.values()], missingAsset: asset?.name ?? block.assetId ?? block.id };
      referenced.set(keyFor(asset), asset);
    }
  }
  return { assets: [...referenced.values()] };
}

/** Holds decoded original-URL images, not fetch status or metadata dimensions. */
export function createPreviewLogoCache(limit = 64) {
  const ready = new Map<string, PreviewImage>();
  return {
    has(asset: PreviewLogo) {
      const key = keyFor(asset), image = ready.get(key);
      if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        ready.delete(key);
        return false;
      }
      ready.delete(key); ready.set(key, image);
      return true;
    },
    set(asset: PreviewLogo, image: PreviewImage) {
      const key = keyFor(asset);
      ready.delete(key); ready.set(key, image);
      while (ready.size > limit) ready.delete(ready.keys().next().value!);
    },
  };
}

const sharedPreviewLogoCache = createPreviewLogoCache();

/** Decode at most two original asset URLs; no redundant fetch/HTTP-200 gate. */
export async function warmPreviewLogos(assets: readonly PreviewLogo[], options: {
  signal: AbortSignal;
  timeoutMs?: number;
  createImage?: () => PreviewImage;
  cache?: ReturnType<typeof createPreviewLogoCache>;
}): Promise<void> {
  const batch = new AbortController();
  const abort = () => batch.abort(options.signal.reason);
  if (options.signal.aborted) abort();
  else options.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => batch.abort(new DOMException('Preview image deadline exceeded', 'TimeoutError')), options.timeoutMs ?? 15_000);
  const cache = options.cache ?? sharedPreviewLogoCache;
  const unique = [...new Map(assets.map((asset) => [keyFor(asset), asset])).values()];
  let next = 0;
  try {
    batch.signal.throwIfAborted();
    const worker = async () => {
      while (next < unique.length) {
        batch.signal.throwIfAborted();
        const asset = unique[next++]!;
        if (cache.has(asset)) continue;
        const image = options.createImage?.() ?? new Image();
        try {
          await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (error?: unknown) => {
              if (settled) return;
              settled = true;
              batch.signal.removeEventListener('abort', cancelled);
              if (error) { image.removeAttribute('src'); reject(error); }
              else resolve();
            };
            const cancelled = () => finish(batch.signal.reason ?? new DOMException('Preview closed', 'AbortError'));
            batch.signal.addEventListener('abort', cancelled, { once: true });
            if (batch.signal.aborted) { cancelled(); return; }
            // Set priority BEFORE src: the SVG's own external-image requests
            // must not be the only low-priority requests warming this URL.
            try {
              image.fetchPriority = 'high';
              image.src = asset.url;
              void image.decode().then(() => {
                if (image.naturalWidth > 0 && image.naturalHeight > 0) finish();
                else finish(new Error('Decoded image has no intrinsic dimensions'));
              }, finish);
            } catch (error) { finish(error); }
          });
          batch.signal.throwIfAborted();
          cache.set(asset, image);
        } catch (cause) {
          if (options.signal.aborted) throw options.signal.reason;
          throw new PreviewLogoError(asset, { cause });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, unique.length) }, worker));
  } catch (error) {
    batch.abort(error);
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', abort);
  }
}
