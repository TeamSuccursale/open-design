import type { ProjectIntakeCatalog } from '@open-design/contracts';

/** Page completion measures successful indexing, never merely rendered thumbnails. */
export function projectIntakeProgress(catalog: ProjectIntakeCatalog) {
  let queued = 0, processing = 0, ready = 0, failed = 0;
  let completedPages = 0, totalPages = 0, unknownTotals = 0;
  const failedDocumentIds = new Set<string>();
  for (const document of catalog.documents) {
    if (document.status === 'queued') queued += 1;
    if (document.status === 'processing') processing += 1;
    if (document.status === 'ready') ready += 1;
    if (document.status === 'failed') { failed += 1; failedDocumentIds.add(document.id); }
    const count = Math.max(0, document.pageCount || 0);
    totalPages += count;
    completedPages += count ? Math.min(count, Math.max(0, document.completedPages || 0)) : 0;
    if (!count) unknownTotals += 1;
  }
  const failedAssets = catalog.assets.filter((asset) => asset.status === 'failed');
  for (const asset of failedAssets) failedDocumentIds.add(asset.documentId);
  const active = queued + processing > 0 || catalog.assets.some((asset) => asset.status === 'queued' || asset.status === 'processing');
  const hasFailures = failed + failedAssets.length > 0;
  const determinate = totalPages > 0 && unknownTotals === 0;
  // A last page can be indexed while final figure tagging or persistence is pending.
  const percent = determinate ? Math.min(active || hasFailures ? 99 : 100, Math.floor(completedPages / totalPages * 100)) : undefined;
  return {
    queued, processing, ready, failed, failedAssets: failedAssets.length,
    completedPages, totalPages, unknownTotals, active, percent,
    hasFailures,
    retryPaths: [...new Set(catalog.documents.filter((document) => failedDocumentIds.has(document.id)).map((document) => document.sourcePath))],
  };
}
