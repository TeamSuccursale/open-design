import { headerFooterVariantForFormat, type HeaderFooterDraft, type HeaderFooterSet, type HeaderFooterWorkspaceResponse, type ProjectDocument } from '@open-design/contracts';

const enablesRegion = (document: ProjectDocument) => !document.archivedAt && (document.presentation?.header === true || document.presentation?.footer === true);

/** Actual graphics saved as a draft that the engineer has not approved yet:
 * either never published, or different from the published revision. */
export function headerFooterAwaitingReview(set: HeaderFooterSet): boolean {
  if (set.archivedAt || set.draft.stage !== 'graphic' || !set.draft.variants.some((variant) => variant.blocks.length)) return false;
  const published = set.publishedRevision;
  return !published || JSON.stringify({ guidance: set.draft.guidance, variants: set.draft.variants }) !== JSON.stringify({ guidance: published.guidance, variants: published.variants });
}

/** The one unpublished proposal the editor lands on when nothing else is
 * targeted. Several alternatives stay in the library, side by side. */
export function singleHeaderFooterProposal(sets: readonly HeaderFooterSet[]): HeaderFooterSet | null {
  const proposals = sets.filter((set) => !set.publishedRevision && headerFooterAwaitingReview(set));
  return proposals.length === 1 ? proposals[0]! : null;
}

/** Documents still waiting for their first header/footer that this design can
 * serve: a region enabled, no binding of any kind, and a populated variant for
 * the document's actual page format. Approving the design applies it to them too. */
export function headerFooterCompanionDocuments(state: Pick<HeaderFooterWorkspaceResponse, 'documents' | 'bindings' | 'pageContexts'>, draft: Pick<HeaderFooterDraft, 'variants'>, excludeDocumentId: string): ProjectDocument[] {
  return state.documents.filter((document) => {
    if (document.id === excludeDocumentId || !enablesRegion(document) || state.bindings.some((binding) => binding.documentId === document.id)) return false;
    const format = state.pageContexts?.find((context) => context.documentId === document.id)?.initialFormat;
    return Boolean(format && headerFooterVariantForFormat(draft.variants, format.widthMm, format.heightMm)?.blocks.length);
  });
}

/** What to open for review when an agent turn ends: the proposal saved during
 * that turn, on a document that uses it or waits for it. Alternatives open the
 * library (setId null) so they can be compared. */
export function headerFooterReviewTarget(state: Pick<HeaderFooterWorkspaceResponse, 'sets' | 'documents' | 'bindings'>, since: number): { documentId: string; setId: string | null } | null {
  const changed = state.sets.filter((set) => headerFooterAwaitingReview(set) && Date.parse(set.updatedAt) >= since)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const set = changed[0];
  if (!set) return null;
  const alternatives = changed.filter((item) => !item.publishedRevision).length > 1;
  const live = new Set(state.documents.filter((document) => !document.archivedAt).map((document) => document.id));
  const bound = state.bindings.find((binding) => binding.setId === set.id && binding.status !== 'disabled' && live.has(binding.documentId));
  if (bound) return { documentId: bound.documentId, setId: alternatives ? null : set.id };
  const waiting = state.documents.find((document) => enablesRegion(document) && !state.bindings.some((binding) => binding.documentId === document.id));
  return waiting ? { documentId: waiting.id, setId: alternatives ? null : set.id } : null;
}
