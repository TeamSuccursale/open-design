import { type BlockoutDocument } from './blockout.js';
import type { BlockoutFitAssessment } from './blockout-fit.js';
import type { BlockoutReserveAdjustment } from './blockout-geometry.js';

export const BLOCKOUT_DOCUMENTS_PATH = 'blockouts/.documents.json';
export type BlockoutDocumentEntry = { id: string; title: string };
export interface BlockoutDocumentCatalog { version: 1; documents: BlockoutDocumentEntry[] }
/** `reserveAdjustments` lists the pages a run-authored save pulled out of the header/footer reserve. */
export interface BlockoutWorkspaceResponse { document: BlockoutDocument | null; raw: string | null; comparisonPath?: string; comparisonError?: string; assessment?: BlockoutFitAssessment; reserveAdjustments?: BlockoutReserveAdjustment[] }
export interface SaveBlockoutWorkspaceRequest { document: BlockoutDocument; baseRaw: string | null; startingPoint?: boolean }
/** Legacy preview messages open selection; only an explicit saved choice may open editing. */
export const BLOCKOUT_PREVIEW_OPEN = 'melillodesign:blockout-page-open';
export const BLOCKOUT_PROPOSAL_SELECT = 'melillodesign:blockout-proposal-select';
export function blockoutProposalSelectMessage(value: unknown): { type: typeof BLOCKOUT_PROPOSAL_SELECT; documentId: string; variantId: string; editPageId?: string } | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (item.type !== BLOCKOUT_PROPOSAL_SELECT || !['documentId', 'variantId'].every((key) => typeof item[key] === 'string' && /^[\w.-]{1,120}$/.test(item[key] as string) && !['.', '..'].includes(item[key] as string))) return null;
  if (item.editPageId !== undefined && (typeof item.editPageId !== 'string' || !/^(?!\.{1,2}$)[\w.-]{1,120}$/.test(item.editPageId))) return null;
  return { type: BLOCKOUT_PROPOSAL_SELECT, documentId: item.documentId as string, variantId: item.variantId as string, ...(typeof item.editPageId === 'string' ? { editPageId: item.editPageId } : {}) };
}
export function isBlockoutComparisonFile(path: string): boolean { return /(?:^|\/)blockout-comparison(?:[-_][\w.-]+)?\.html$/i.test(path.replaceAll('\\', '/')); }
/** Explicit marker for legacy comparison entrypoints with a general filename such as index.html. */
export function blockoutComparisonDocumentFromHtml(html: string | null): string | null {
  const match = html?.slice(0, 16_384).match(/<meta\s+name=["']melillodesign-blockout-document["']\s+content=["']([\w.-]{1,120})["']\s*\/?\s*>/i);
  return match && !['.', '..'].includes(match[1]!) ? match[1]! : null;
}
export function blockoutComparisonFilePath(document: Pick<BlockoutDocument, 'title' | 'documentId'>): string {
  const slug = document.title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
  return `documents/${slug || document.documentId}/blockout-comparison.html`;
}
export interface BlockoutPreviewOpenMessage { type: typeof BLOCKOUT_PREVIEW_OPEN; documentId: string; variantId: string; pageId: string }
export function blockoutPreviewOpenMessage(value: unknown): BlockoutPreviewOpenMessage | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (item.type !== BLOCKOUT_PREVIEW_OPEN || !['documentId', 'variantId', 'pageId'].every((key) => typeof item[key] === 'string' && (item[key] as string).length <= 128 && /^(?!\.{1,2}$)[\w.-]+$/.test(item[key] as string))) return null;
  return { type: BLOCKOUT_PREVIEW_OPEN, documentId: item.documentId as string, variantId: item.variantId as string, pageId: item.pageId as string };
}
const safeId = /^(?!\.{1,2}$)[\w.-]+$/;
export function blockoutWorkspacePath(documentId = 'document-1') {
  if (!safeId.test(documentId)) throw new Error('Invalid blockout document identity');
  return documentId === 'document-1' ? 'blockout/layout.json' : `blockouts/${documentId}/.workspace.json`;
}
export function blockoutFileTarget(path: string): { documentId: string; pageId?: string } | null {
  const clean = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (clean === 'blockout/layout.json' || /^blockout\/proposal[^/]*\.json$/i.test(clean)) return { documentId: 'document-1' };
  const update = /^blockouts\/([\w.-]+)\/handoffs\/[\w.-]+\.blockout-update\.json$/i.exec(clean);
  if (update) return { documentId: update[1]! };
  const match = /^blockouts\/([\w.-]+)\/([\w.-]+)\.blockout\.json$/i.exec(clean);
  return match ? { documentId: match[1]!, pageId: match[2]! } : null;
}
export function isBlockoutFile(path: string): boolean { return Boolean(blockoutFileTarget(path)); }
export function isInternalBlockoutFile(path: string): boolean {
  const clean = path.replaceAll('\\', '/').replace(/^\.\//, '');
  return /^blockout\/(?:starting-point\.json|brief\.md|proposal[^/]*\.json|\.context\/)/i.test(clean)
    || /^blockouts\/(?:\.documents\.json$|[^/]+\/(?:\.workspace\.json$|handoffs\/))/i.test(clean);
}

/** One user-facing file per page, containing that page's editable alternatives. */
export function blockoutPageFiles(document: BlockoutDocument) {
  const documentId = document.documentId ?? 'document-1';
  if (!safeId.test(documentId)) throw new Error('Invalid blockout document identity');
  const firstPosition = new Map<string, number>(), fileIds = new Set<string>();
  for (const variant of document.variants) for (const [index, page] of variant.pages.entries()) {
    if (!firstPosition.has(page.id)) firstPosition.set(page.id, index);
  }
  // Agents may retain proposal-scoped page IDs. Corresponding page positions
  // still belong to a single document page, not separate proposal files.
  return Array.from({ length: Math.max(...document.variants.map((variant) => variant.pages.length)) }, (_, index) => {
    const candidates = document.variants.flatMap((variant) => variant.pages[index] ? [variant.pages[index]!.id] : []);
    let pageId = candidates.find((candidate) => firstPosition.get(candidate) === index && !fileIds.has(candidate));
    if (!pageId) {
      // A repeated ID can occupy a different position after proposals are
      // reordered independently. Use a logical slot absent from actual IDs.
      const stem = `_page-position-${index + 1}`;
      pageId = stem; let suffix = 2;
      while (firstPosition.has(pageId) || fileIds.has(pageId)) pageId = `${stem}-${suffix++}`;
    }
    if (!safeId.test(pageId)) throw new Error('Invalid blockout page identity');
    fileIds.add(pageId);
    const variants = document.variants.flatMap((variant) => variant.pages[index] ? [{ id: variant.id, label: variant.label, page: variant.pages[index]! }] : []);
    return {
    path: `blockouts/${documentId}/${pageId}.blockout.json`,
    content: `${JSON.stringify({ version: 1, type: 'blockout-page', documentId, documentTitle: document.title, pageId, pageNumber: index + 1, pageBudget: document.pageBudget, activeVariantId: document.activeVariantId, variants, approval: document.approval }, null, 2)}\n`,
    };
  });
}

export function blockoutPageForFile(document: BlockoutDocument, variantId: string, pageId?: string) {
  const variant = document.variants.find((item) => item.id === variantId);
  if (!variant) return undefined;
  if (!pageId) return variant.pages[0];
  const anchor = document.variants.find((item) => item.pages.some((page) => page.id === pageId));
  const index = anchor?.pages.findIndex((page) => page.id === pageId) ?? -1;
  if (index >= 0) return variant.pages[index];
  const position = /^_page-position-(\d+)(?:-\d+)?$/.exec(pageId);
  return position ? variant.pages[Number(position[1]) - 1] : undefined;
}
