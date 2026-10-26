import { useEffect, useState } from 'react';
import { Button } from '@open-design/components';
import { blockoutFileTarget, type BlockoutDocument } from '@open-design/contracts';
import { useProjectCollabContext } from '../../collab/collab-context';
import { useT } from '../../i18n';
import { loadBlockout } from '../../providers/blockout';
import { openBlockoutProposals } from './events';
import { blockoutPageScope } from './blockout-page-scope';
import styles from './BlockoutWorkspace.module.css';

/** Saved blockouts are visual, editable deliverables even in old chat history. */
export function BlockoutArtifactCard({ projectId, path, revision }: { projectId: string; path: string; revision?: string | number; onOpen?: (path: string) => void }) {
  const t = useT(), { workspaceContext } = useProjectCollabContext();
  const [doc, setDoc] = useState<BlockoutDocument | null>(null);
  const target = blockoutFileTarget(path), documentId = target?.documentId ?? 'document-1';
  useEffect(() => {
    const controller = new AbortController(); setDoc(null);
    void loadBlockout(projectId, workspaceContext, controller.signal, documentId).then((value) => {
      if (!controller.signal.aborted) setDoc(value.document);
    }).catch(() => {});
    return () => controller.abort();
  }, [projectId, documentId, revision, workspaceContext]);
  const scope = doc ? blockoutPageScope(doc, target?.pageId) : null;
  // Setup confirmation saves blank pages as an initial brief, not generated
  // alternatives. Check the whole document so a blank cover is still shown
  // when the engineer has composed blocks elsewhere in a manual structure.
  const initialScaffold = doc?.variants.length === 1 && doc.variants[0]?.id === 'brief'
    && !doc.selectedVariantId && !doc.approval && doc.variants[0].pages.every((page) => page.blocks.length === 0);
  if (!scope || initialScaffold) return null;
  const pageName = scope?.pageName || `${t('blockout.page')} ${scope?.pageNumber ?? ''}`.trim();
  return <section className={styles.artifactCard} data-testid={`blockout-artifact-${path}`}>
    <div className={styles.artifactPages}>{scope?.document.variants.slice(0, 4).map((variant, index) => {
      const page = variant.pages[0];
      if (!page) return null;
      return <span role="img" aria-label={`${variant.label || `${t('blockout.proposal')} ${index + 1}`} · ${page.label || pageName}`} key={variant.id} style={{ aspectRatio: `${page.widthMm} / ${page.heightMm}` }}>{page.blocks.map((block) => <i aria-hidden="true" key={block.id} style={{ left: `${block.box.x}%`, top: `${block.box.y}%`, width: `${block.box.width}%`, height: `${block.box.height}%`, transform: `rotate(${block.box.rotation}deg)` }} />)}</span>;
    })}</div>
    <strong>{target?.pageId ? t('blockout.pageFile', { number: scope?.pageNumber ?? '…', name: pageName }) : t('blockout.documentFile')}{doc?.title ? ` · ${doc.title}` : ''}</strong>
    <p>{t(target?.pageId ? 'blockout.pageFileHint' : 'blockout.fileHint')}</p>
    <Button variant="secondary" disabled={!scope} onClick={() => openBlockoutProposals({ projectId, documentId, ...(target?.pageId ? { pageId: target.pageId } : {}) })}>{t(target?.pageId ? 'blockout.comparePage' : 'documentWorkspace.compareAll')}</Button>
  </section>;
}
