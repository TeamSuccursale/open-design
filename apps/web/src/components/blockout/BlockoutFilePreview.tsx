import { useEffect, useRef, useState } from 'react';
import { Button, Select } from '@open-design/components';
import { blockoutComparisonFilePath, blockoutFileTarget, type BlockoutDocument, type BlockoutDocumentEntry } from '@open-design/contracts';
import { useProjectCollabContext } from '../../collab/collab-context';
import { workspaceIdentityCacheKey } from '../../collab/workspace-identity';
import { listBlockoutDocuments, loadBlockout, registeredBlockoutComparisonDocument, saveBlockout } from '../../providers/blockout';
import { PROJECT_HISTORY_UPDATED_EVENT } from '../../providers/project-history';
import { useT } from '../../i18n';
import { openBlockoutEditor } from './events';
import { BlockoutDocumentOverview } from './BlockoutDocumentOverview';
import { blockoutPageScope } from './blockout-page-scope';
import { BlockoutReadiness } from './BlockoutReadiness';
import { useBlockoutReadiness } from './useBlockoutReadiness';
import styles from './BlockoutWorkspace.module.css';

export function BlockoutFilePreview({ projectId, path, revision, documentId, generating = false }: { projectId: string; path: string; revision?: number; documentId?: string; generating?: boolean }) {
  const t = useT(), { workspaceContext } = useProjectCollabContext();
  const [doc, setDoc] = useState<BlockoutDocument | null>(null), [error, setError] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false), [choiceError, setChoiceError] = useState(false);
  const [reload, setReload] = useState(0);
  const readiness = useBlockoutReadiness(projectId, doc, workspaceContext, Boolean(doc));
  const inventoryPending = !readiness.legacy && !readiness.error && (!readiness.inventory || readiness.inventory.status === 'preparing' || readiness.inventory.status === 'waiting');
  const target = blockoutFileTarget(path);
  const authority = workspaceIdentityCacheKey(workspaceContext);
  const identity = JSON.stringify([projectId, path, documentId ?? target?.documentId ?? null, authority, reload]);
  const loadedIdentity = useRef<string | null>(null);
  const canonicalSelection = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const restored = (event: Event) => { if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId === projectId) setReload((value) => value + 1); };
    window.addEventListener(PROJECT_HISTORY_UPDATED_EVENT, restored);
    return () => window.removeEventListener(PROJECT_HISTORY_UPDATED_EVENT, restored);
  }, [projectId]);
  useEffect(() => {
    const controller = new AbortController(); setError(false); setChoiceError(false);
    // A content revision updates this preview in place. Changing its owner/path,
    // authority or history restore identity intentionally clears local inspection.
    if (loadedIdentity.current !== identity) {
      loadedIdentity.current = identity;
      canonicalSelection.current = undefined;
      setDoc(null); setSelected(null);
    }
    void loadBlockout(projectId, workspaceContext, controller.signal, documentId ?? target?.documentId).then((loaded) => {
      if (controller.signal.aborted) return;
      if (!loaded.document) { setError(true); return; }
      const nextSelection = loaded.document.selectedVariantId ?? null;
      if (canonicalSelection.current !== nextSelection) setSelected(nextSelection);
      canonicalSelection.current = nextSelection;
      setDoc(loaded.document);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
    // Authority is compared by value; a recreated context object is not a new owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, revision, generating]);
  async function choose(variantId: string, editPageId?: string) {
    if (!doc || choosing || generating) return;
    setChoosing(true); setChoiceError(false);
    try {
      const current = await loadBlockout(projectId, workspaceContext, undefined, doc.documentId);
      const variant = current.document?.variants.find((variant) => variant.id === variantId);
      if (!current.document || !variant || (editPageId && !variant.pages.some((page) => page.id === editPageId))) throw new Error('Missing proposal');
      const next = { ...current.document, activeVariantId: variantId, selectedVariantId: variantId };
      await saveBlockout(projectId, next, current.raw, workspaceContext);
      canonicalSelection.current = variantId;
      setDoc(next); setSelected(variantId);
      if (editPageId) openBlockoutEditor({ projectId, documentId: next.documentId, variantId, pageId: editPageId });
    } catch (failure) { setChoiceError(true); throw failure; } finally { setChoosing(false); }
  }
  const scope = doc ? blockoutPageScope(doc, target?.pageId) : null;
  const proposal = scope?.document.variants.find((variant) => variant.id === selected);
  const visibleDocument = scope && proposal ? { ...scope.document, variants: [proposal], activeVariantId: proposal.id } : scope?.document;
  const latestBatch = doc?.alternativeBatches?.at(-1);
  const newVariants = proposal && latestBatch ? doc!.variants.filter((variant) => latestBatch.variantIds.includes(variant.id) && variant.id !== proposal.id) : [];
  const alternativeBase = latestBatch && doc?.variants.find((variant) => variant.id === latestBatch.baseVariantId);
  return <section className={styles.filePreview} aria-label={t('blockout.file')}>
    <header><div><h2>{doc?.title || t('blockout.file')}</h2>{target?.pageId && scope && <p>{t('blockout.pageFile', { number: scope.pageNumber!, name: scope.pageName || t('blockout.page') })}</p>}<p>{t(proposal ? 'documentWorkspace.editHint' : 'documentWorkspace.chooseHint')}</p></div>{proposal && <div><Button variant="secondary" title={t('documentWorkspace.compareAll')} onClick={() => setSelected(null)}>{t('documentWorkspace.compareAll')}</Button><Button variant="primary" disabled={generating || choosing} onClick={() => openBlockoutEditor({projectId,documentId:doc!.documentId,variantId:proposal.id,pageId:proposal.pages[0]!.id})}>{t('documentWorkspace.editSelected')}</Button></div>}</header>
    {error && !generating && <div role="alert"><p>{t('blockout.loadFailed')}</p><Button variant="secondary" onClick={() => setReload((value) => value + 1)}>{t('documentStart.retry')}</Button></div>}
    {choiceError && <p role="alert">{t('blockout.saveFailed')}</p>}
    {generating && <div className={styles.generationNotice} role="status"><progress aria-label={t('blockout.completingProposals')} /><span>{t('blockout.completingProposals')}</span></div>}
    {proposal && <p role="status">{t('blockout.savedLocally')}</p>}
    {!doc && !error && <p role="status">{t('common.loading')}</p>}
    {doc && <BlockoutReadiness value={readiness} />}
    {doc && newVariants.length > 0 && !inventoryPending && <section aria-label={t('blockout.newAlternatives')}><h3>{t('blockout.newAlternatives')}</h3>{alternativeBase && alternativeBase.id !== proposal?.id && <p>{t('blockout.alternativeBase',{name:alternativeBase.label})}</p>}<BlockoutDocumentOverview document={{...doc,variants:newVariants,activeVariantId:newVariants[0]!.id}} previewDocument={doc} budgetDocument={doc} presentation="proposals" busy={choosing} choicesPending={generating} projectId={projectId} workspaceContext={workspaceContext} onSelectProposal={choose} onOpenPage={() => {}} /></section>}
    {visibleDocument && !inventoryPending && <BlockoutDocumentOverview document={visibleDocument} previewDocument={doc!} busy={choosing} choicesPending={generating} budgetDocument={doc!} inventory={readiness.inventory} assessment={readiness.assessment} projectId={projectId} workspaceContext={workspaceContext} pageNumberOffset={(scope?.pageNumber ?? 1) - 1} presentation={proposal ? 'selected' : 'proposals'} onSelectProposal={proposal ? undefined : choose} onOpenPage={(variantId, pageId,blockId) => { if (!generating && selected === variantId) openBlockoutEditor({ projectId, documentId: visibleDocument.documentId, pageId, variantId,...(blockId?{blockId}:{}) }); }} />}
  </section>;
}

/** Old generated comparison HTML cannot introduce its own editor/export controls into selection. */
export function BlockoutComparisonPreview({ projectId, path, revision, onOpenComparison, generating = false }: { projectId: string; path: string; revision?: number; onOpenComparison?: (path: string) => void; generating?: boolean }) {
  const t = useT(), { workspaceContext } = useProjectCollabContext();
  const [documents, setDocuments] = useState<BlockoutDocumentEntry[]>([]), [documentId, setDocumentId] = useState(''), [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const authority = workspaceIdentityCacheKey(workspaceContext);
  const comparisonIdentity = JSON.stringify([projectId, path, authority, reload]);
  const loadedComparisonIdentity = useRef<string | null>(null);
  useEffect(() => {
    const restored = (event: Event) => { if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId === projectId) setReload((value) => value + 1); };
    window.addEventListener(PROJECT_HISTORY_UPDATED_EVENT, restored);
    return () => window.removeEventListener(PROJECT_HISTORY_UPDATED_EVENT, restored);
  }, [projectId]);
  useEffect(() => {
    let disposed = false; const controller = new AbortController(); setError(false);
    // A new output revision updates the mounted preview, including its current
    // page modal. Only navigation, authority or an explicit retry resets it.
    if (loadedComparisonIdentity.current !== comparisonIdentity) {
      loadedComparisonIdentity.current = comparisonIdentity; setDocumentId(''); setDocuments([]);
    }
    void (async () => {
      const registered = await registeredBlockoutComparisonDocument(projectId, path, workspaceContext, controller.signal);
      if (registered) { if (!disposed) setDocumentId(registered); return; }
      const entries = await listBlockoutDocuments(projectId, workspaceContext);
      if (disposed) return;
      const normal = path.replaceAll('\\', '/').replace(/blockout-comparison(?:[-_][\w.-]+)?\.html$/i, 'blockout-comparison.html');
      const match = entries.find((entry) => blockoutComparisonFilePath({ documentId: entry.id, title: entry.title }) === normal);
      const legacy = !normal.startsWith('documents/') ? entries.find((entry) => entry.id === 'document-1') : undefined;
      setDocuments(entries); setDocumentId(match?.id ?? legacy?.id ?? ''); setError(!match && !legacy);
    })().catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; controller.abort(); };
    // Only fields carried by provider requests partition this read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparisonIdentity, revision, generating]);
  if (error && !documentId && !generating) return <div role="alert"><p>{t('blockout.loadFailed')}</p><Button variant="secondary" onClick={() => setReload((value) => value + 1)}>{t('documentStart.retry')}</Button></div>;
  if (!documentId) return <p role="status">{t(generating ? 'blockout.completingProposals' : 'common.loading')}</p>;
  return <div className={styles.comparisonPreview}>
    {error && !generating && <div role="alert"><p>{t('blockout.loadFailed')}</p><Button variant="secondary" onClick={() => setReload((value) => value + 1)}>{t('documentStart.retry')}</Button></div>}
    {documents.length > 1 && <label className={styles.comparisonDocumentChoice}>{t('blockout.document')}<Select aria-label={t('blockout.document')} value={documentId} onChange={(event) => {
      const entry = documents.find((entry) => entry.id === event.target.value);
      if (!entry || entry.id === documentId) return;
      // Navigate through the workspace host so the URL and implicit edit target
      // change with the document being viewed. Explicit attachments stay intact.
      if (onOpenComparison) onOpenComparison(blockoutComparisonFilePath({ documentId: entry.id, title: entry.title }));
      else setDocumentId(entry.id);
    }}>{documents.map((entry) => <option key={entry.id} value={entry.id}>{entry.title || entry.id}</option>)}</Select></label>}
    <BlockoutFilePreview key={`${projectId}:${documentId}`} projectId={projectId} path={path} documentId={documentId} revision={revision} generating={generating} />
  </div>;
}
