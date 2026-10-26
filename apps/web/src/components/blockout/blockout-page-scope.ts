import { blockoutPageForFile, type BlockoutDocument } from '@open-design/contracts';

/** A saved page file represents corresponding positions, even with proposal-scoped IDs. */
export function blockoutPageScope(document: BlockoutDocument, pageId?: string) {
  if (!pageId) return { document, pageNumber: undefined, pageName: undefined };
  let pageNumber: number | undefined;
  const variants = document.variants.flatMap((variant) => {
    const page = blockoutPageForFile(document, variant.id, pageId);
    if (!page) return [];
    pageNumber ??= variant.pages.indexOf(page) + 1;
    return [{ ...variant, pages: [page] }];
  });
  if (!variants.length) return null;
  const active = variants.find((variant) => variant.id === document.activeVariantId) ?? variants[0]!;
  return { document: { ...document, variants, activeVariantId: active.id }, pageNumber, pageName: active.pages[0]!.label };
}
