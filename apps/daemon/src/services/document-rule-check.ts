import type { BlockoutPage, DocumentRuleCheckInput } from '@open-design/contracts';
import { readBlockoutWorkspace } from './blockout-workspaces.js';
import { readDocumentSetup } from './document-setup.js';

/**
 * What a designed document is checked against: the rules the setup saved for it, their source pages, its editorial
 * choices (which say whether a cover counts) and the pages of its approved Blockout (safe margins and block names).
 * A project without a setup or a Blockout simply has fewer rules; nothing here fails the check.
 */
export async function documentRuleInputs(root: string, projectId: string, documentId: string | null): Promise<Omit<DocumentRuleCheckInput, 'fileName' | 'measurement'>> {
  const setup = await readDocumentSetup(root, undefined, projectId).catch(() => null) ?? await readDocumentSetup(root).catch(() => null);
  const settings = setup?.confirmed?.editorialSettings ?? setup?.intent.editorialSettings ?? [];
  const entry = settings.find((item) => item.documentId === documentId) ?? (settings.length === 1 ? settings[0] : undefined);
  // Project-wide rules belong to a single-document project; with several documents only each one's own rules apply.
  const constraints = entry?.constraints ?? (settings.length <= 1 ? setup?.confirmed?.constraints ?? setup?.scan.constraints.filter((item) => item.status === 'confirmed') ?? [] : []);
  let blockoutPages: BlockoutPage[] = [];
  if (documentId) {
    try {
      const { document } = await readBlockoutWorkspace(root, documentId);
      const variant = document && (document.variants.find((item) => item.id === document.approval?.variantId)
        ?? document.variants.find((item) => item.id === document.activeVariantId) ?? document.variants[0]);
      blockoutPages = variant?.pages ?? [];
    } catch { /* No readable Blockout: the margins row falls back to the tender rule, or stays unchecked. */ }
  }
  return { constraints, sources: setup?.scan.sources ?? [], ...(entry?.presentation ? { presentation: entry.presentation } : {}), blockoutPages };
}
