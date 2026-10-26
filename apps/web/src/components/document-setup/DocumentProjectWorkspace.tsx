import { useEffect, useState } from 'react';
import { Button, Select } from '@open-design/components';
import type { BlockoutDocument, WorkspaceCollabContext } from '@open-design/contracts';
import { useT } from '../../i18n';
import { listBlockoutDocuments, loadBlockout, saveBlockout } from '../../providers/blockout';
import { documentSetupRequest } from '../../providers/document-setup';
import { ProjectIntakeProgress } from '../chat/ProjectIntakeProgress';
import { BlockoutDocumentOverview } from '../blockout/BlockoutDocumentOverview';
import { BlockoutReadiness } from '../blockout/BlockoutReadiness';
import { useBlockoutReadiness } from '../blockout/useBlockoutReadiness';
import { blockoutPageScope } from '../blockout/blockout-page-scope';
import { openBlockoutEditor } from '../blockout/events';
import { Icon } from '../Icon';
import styles from './DocumentProjectWorkspace.module.css';

interface Props {
  projectId: string; title: string; workspaceContext?: WorkspaceCollabContext | null; enabled: boolean;
  running: boolean; verifiedAgent?: string; failed: boolean; chatOpen: boolean; left: number;
  initialDocumentId?: string; initialPageId?: string;
  onBack: () => void; onChat: () => void; onFiles: () => void; onStop: () => void;
}

/** A document has a visible stage. Chat is an explicit supporting action. */
export function DocumentProjectWorkspace({ projectId, title, workspaceContext, enabled, running, verifiedAgent, failed, initialDocumentId = 'document-1', initialPageId, left, onBack, onChat, onFiles, onStop }: Props) {
  const t = useT();
  const [documentId, setDocumentId] = useState(initialDocumentId);
  const [documents, setDocuments] = useState<Array<{ id: string; title: string }>>([]);
  const [document, setDocument] = useState<BlockoutDocument | null>(null), [selected, setSelected] = useState<string | null>(null);
  const [confirmedManual, setConfirmedManual] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
  const readiness = useBlockoutReadiness(projectId, document, workspaceContext, enabled && !loading, running);
  const inventoryPending = !readiness.legacy && !readiness.error && (!readiness.inventory || readiness.inventory.status === 'preparing' || readiness.inventory.status === 'waiting');
  const contextKey = JSON.stringify(workspaceContext ?? null);
  useEffect(() => { setDocumentId(initialDocumentId); setSelected(null); }, [projectId, initialDocumentId, initialPageId, enabled]);
  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function read() {
      try {
        const [catalog, value, setup] = await Promise.all([listBlockoutDocuments(projectId, workspaceContext), loadBlockout(projectId, workspaceContext, controller.signal, documentId), documentSetupRequest(projectId, workspaceContext, undefined, undefined, controller.signal).catch(() => null)]);
        if (disposed) return;
        setDocuments(catalog); setDocument(value.document); setSelected(value.document?.selectedVariantId ?? null); setError('');
        setConfirmedManual(setup?.status === 'confirmed' && setup.confirmed?.blockoutApproach === 'manual');
      } catch { if (!disposed) setError(t('blockout.loadFailed')); }
      finally { if (!disposed) { setLoading(false); if (running) timer = setTimeout(() => void read(), 3000); } }
    }
    const saved = () => { if (!disposed) setRefresh((value) => value + 1); };
    window.addEventListener('melillodesign:blockout-saved', saved);
    void read();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); window.removeEventListener('melillodesign:blockout-saved', saved); };
  // The serialized collaboration identity is stable across parent rendering.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, projectId, contextKey, documentId, running, refresh]);
  const pageScope = document ? blockoutPageScope(document, documentId === initialDocumentId ? initialPageId : undefined) : null;
  const scopedDocument = pageScope?.document;
  const proposals = scopedDocument?.variants.filter((variant) => variant.pages.some((page) => page.blocks.length)) ?? [];
  const manualVariant = confirmedManual && !proposals.length ? scopedDocument?.variants.find((variant) => variant.id === scopedDocument.activeVariantId && variant.pages.length) ?? scopedDocument?.variants.find((variant) => variant.pages.length) : undefined;
  const selectedProposal = proposals.find((variant) => variant.id === selected);
  const visibleDocument = scopedDocument && proposals.length ? { ...scopedDocument, variants: selectedProposal ? [selectedProposal] : proposals, activeVariantId: selectedProposal?.id ?? proposals[0]!.id } : null;
  const openPage = (variantId: string, pageId: string) => { if (proposals.some((variant) => variant.id === variantId) && !running) openBlockoutEditor({ projectId, documentId, variantId, pageId }); };
  async function choose(variantId: string, editPageId?: string) {
    if (choosing) return;
    setChoosing(true); setError('');
    try {
      const current = await loadBlockout(projectId, workspaceContext, undefined, documentId);
      const variant = current.document?.variants.find((variant) => variant.id === variantId);
      if (!current.document || !variant || (editPageId && !variant.pages.some((page) => page.id === editPageId))) throw new Error('Missing proposal');
      const next = { ...current.document, activeVariantId: variantId, selectedVariantId: variantId };
      await saveBlockout(projectId, next, current.raw, workspaceContext); setDocument(next); setSelected(variantId);
      if (editPageId) openBlockoutEditor({ projectId, documentId, variantId, pageId: editPageId });
    } catch (failure) { throw failure; } finally { setChoosing(false); }
  }
  return <section className={styles.root} style={{ left }} aria-label={t('documentWorkspace.region')}>
    <header className={styles.header}>
      <div className={styles.identity}><div><h1>{document?.title || title}</h1><p>{pageScope?.pageNumber ? t('blockout.pageFile', { number: pageScope.pageNumber, name: pageScope.pageName || t('blockout.page') }) : t('documentWorkspace.stage')}</p></div></div>
      <div className={styles.actions}><Button variant="ghost" onClick={onFiles}>{t('documentWorkspace.files')}</Button><Button variant="ghost" onClick={onBack} aria-label={t('common.close')}><Icon name="close" size={18} /></Button></div>
    </header>
    <ProjectIntakeProgress projectId={projectId} workspaceContext={workspaceContext} />
    <div className={styles.body}>
      <BlockoutReadiness value={readiness} generating={running} />
      {documents.length > 1 && <label className={styles.documents}>{t('blockout.document')}<Select value={documentId} onChange={(event) => { setDocumentId(event.target.value); setSelected(null); }}>{documents.map((entry) => <option key={entry.id} value={entry.id}>{entry.title || entry.id}</option>)}</Select></label>}
      {running ? <div className={styles.state} role="status"><h2>{t('documentWorkspace.preparing', { agent: verifiedAgent || 'Codex CLI' })}</h2><p>{t('documentWorkspace.preparingHint')}</p><progress aria-label={t('documentWorkspace.progress')} /><Button variant="secondary" onClick={onStop}>{t('documentWorkspace.stop')}</Button></div> : loading ? <p role="status">{t('common.loading')}</p> : error ? <div role="alert"><p>{error}</p><Button variant="secondary" onClick={() => setRefresh((value) => value + 1)}>{t('documentStart.retry')}</Button></div> : inventoryPending ? null : visibleDocument ? <>
        <div className={styles.intro}><div><h2>{t(selectedProposal ? 'documentWorkspace.selected' : 'documentWorkspace.choose')}</h2><p>{t(verifiedAgent ? 'documentWorkspace.agentOrigin' : 'documentWorkspace.savedOrigin', { agent: verifiedAgent || '' })}</p><p>{t(selectedProposal ? 'documentWorkspace.editHint' : 'documentWorkspace.chooseHint')}</p></div>{selectedProposal && <Button variant="secondary" title={t('documentWorkspace.compareAll')} onClick={() => setSelected(null)}><Icon name="arrow-left" size={16} />{t('chat.comments.deselect')}</Button>}</div>
        {selectedProposal && <p role="status">{t('blockout.savedLocally')}</p>}
        <BlockoutDocumentOverview document={visibleDocument} previewDocument={document!} busy={choosing} budgetDocument={document!} inventory={readiness.inventory} assessment={readiness.assessment} projectId={projectId} workspaceContext={workspaceContext} pageNumberOffset={(pageScope?.pageNumber ?? 1) - 1} presentation={selectedProposal ? 'selected' : 'proposals'} onSelectProposal={selectedProposal ? undefined : choose} onOpenPage={(variantId, pageId) => { if (selectedProposal?.id === variantId) openPage(variantId, pageId); }} />
        {selectedProposal && <footer className={styles.next}><p>{t(document?.approval?.variantId === selectedProposal.id ? 'documentWorkspace.approved' : 'documentWorkspace.approvalHint')}</p><Button variant="primary" onClick={() => openPage(selectedProposal.id, selectedProposal.pages[0]!.id)}>{t('documentWorkspace.editSelected')}</Button></footer>}
      </> : manualVariant ? <div className={styles.state}><h2>{t('documentWorkspace.manualTitle')}</h2><p>{t('documentWorkspace.manualHint')}</p><Button variant="primary" onClick={() => openBlockoutEditor({ projectId, documentId, variantId: manualVariant.id, pageId: manualVariant.pages[0]!.id })}>{t('documentWorkspace.manualResume')}</Button></div> : <div className={styles.state}><h2>{t(failed ? 'documentWorkspace.interrupted' : 'documentWorkspace.empty')}</h2><p>{t(failed ? 'documentWorkspace.interruptedHint' : 'documentWorkspace.emptyHint')}</p>{failed && <Button variant="secondary" onClick={onChat}>{t('documentWorkspace.openChat')}</Button>}</div>}
    </div>
  </section>;
}
