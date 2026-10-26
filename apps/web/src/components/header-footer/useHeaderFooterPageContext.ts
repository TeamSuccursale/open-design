import { useEffect, useState } from 'react';
import type { BlockoutDocument, DocumentEditorialSettings, ProjectDocument, WorkspaceCollabContext } from '@open-design/contracts';
import { loadBlockout } from '../../providers/blockout';
import { getHeaderFooterWorkspace } from '../../providers/header-footer';

export type HeaderFooterPageContext = { totalPages?: number; initialFormat?: { widthMm: number; heightMm: number } };

export function resolveHeaderFooterPageContext(document: BlockoutDocument | null, setting?: DocumentEditorialSettings): HeaderFooterPageContext {
  const variant = document?.variants.find((item) => item.id === (document.selectedVariantId ?? document.activeVariantId));
  if (variant?.pages.length && variant.pages.some((page) => page.blocks.length)) return { totalPages: variant.pages.length, initialFormat: { widthMm: variant.pages[0]!.widthMm, heightMm: variant.pages[0]!.heightMm } };
  const rules = (setting?.constraints ?? []).filter((item) => item.status === 'confirmed');
  const paper = rules.find((item) => item.kind === 'paper')?.value ?? '';
  const orientation = rules.find((item) => item.kind === 'orientation')?.value ?? paper;
  const sizes: Record<string, [number, number]> = { A3: [297, 420], A4: [210, 297], A5: [148, 210] };
  const size = sizes[paper.match(/\bA[345]\b/i)?.[0].toUpperCase() ?? ''];
  const landscape = /orizzontale|landscape|horizontal/i.test(orientation);
  return { ...(setting?.pageTarget ? { totalPages: setting.pageTarget } : {}), ...(size ? { initialFormat: { widthMm: size[landscape ? 1 : 0], heightMm: size[landscape ? 0 : 1] } } : {}) };
}

/** Read only the selected document, never another document's page allowance. */
export function useHeaderFooterPageContext(projectId: string, documentId: string | null, documents: readonly ProjectDocument[], settings: readonly DocumentEditorialSettings[] | undefined, context?: WorkspaceCollabContext | null, enabled = true): HeaderFooterPageContext {
  const targetWorkspace = documents.find((item) => item.id === documentId)?.workspaceProjectId ?? projectId;
  const authority = JSON.stringify(context ?? null);
  const scope = `${projectId}:${targetWorkspace}:${documentId}:${authority}`;
  const fallbackSetting = settings?.find((item) => item.documentId === documentId);
  const [loaded, setLoaded] = useState<{ scope: string; value: HeaderFooterPageContext } | null>(null);
  useEffect(() => {
    if (!enabled || !documentId) return;
    const abort = new AbortController();
    void Promise.all([
      loadBlockout(targetWorkspace, context, abort.signal, documentId).catch(() => null),
      getHeaderFooterWorkspace(projectId, context, abort.signal).catch(() => null),
    ]).then(([blockout, workspace]) => {
      if (abort.signal.aborted) return;
      const persisted = workspace?.pageContexts?.find((item) => item.documentId === documentId);
      setLoaded({ scope, value: persisted ? { ...(persisted.totalPages ? { totalPages: persisted.totalPages } : {}), ...(persisted.initialFormat ? { initialFormat: persisted.initialFormat } : {}) } : resolveHeaderFooterPageContext(blockout?.document ?? null, fallbackSetting) });
    });
    return () => abort.abort();
    // Authority values, not object identity, delimit these reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, enabled, JSON.stringify(fallbackSetting)]);
  return loaded?.scope === scope ? loaded.value : resolveHeaderFooterPageContext(null, fallbackSetting);
}
