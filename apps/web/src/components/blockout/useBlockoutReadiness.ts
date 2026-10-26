import { useEffect, useMemo, useRef, useState } from 'react';
import { assessBlockoutStructure, type BlockoutDocument, type BlockoutFitAssessment, type BlockoutMaterialInventory, type WorkspaceCollabContext } from '@open-design/contracts';
import { assessBlockoutDocument, BLOCKOUT_COMPARISON_RESULT_EVENT, BLOCKOUT_MATERIALS_UPDATED_EVENT, blockoutDocumentRevision, loadBlockoutMaterials, type BlockoutComparisonResult } from '../../providers/blockout-materials';
import { PROJECT_HISTORY_UPDATED_EVENT } from '../../providers/project-history';

export function usesBlockoutMaterials(document: BlockoutDocument | null): boolean {
  return document?.planningStage === 'composition';
}
export interface BlockoutReadiness {
  inventory: BlockoutMaterialInventory | null; assessment: BlockoutFitAssessment | null;
  loading: boolean; checking: boolean; error: '' | 'blockoutMaterials.loadFailed' | 'blockoutMaterials.checkFailed'; legacy: boolean; retry: () => void;
  comparisonError?: string;
}
/** One observer owns inventory polling and a revision-fenced measurement for this visible document. */
export function useBlockoutReadiness(projectId: string, document: BlockoutDocument | null, context?: WorkspaceCollabContext | null, enabled = true, generationBusy = false): BlockoutReadiness {
  const [inventoryResult, setInventory] = useState<{ scope: string; inventory: BlockoutMaterialInventory } | null>(null);
  const [result, setResult] = useState<{ key: string; assessment: BlockoutFitAssessment } | null>(null);
  const [loading, setLoading] = useState(false), [checking, setChecking] = useState(false), [error, setError] = useState<BlockoutReadiness['error']>('');
  const [revision, setRevision] = useState(0), force = useRef(false);
  const [comparisonResult, setComparisonResult] = useState<{ scope: string; error?: string } | null>(null);
  const key = JSON.stringify(document), contextKey = JSON.stringify(context ?? null), legacy = !usesBlockoutMaterials(document);
  const structure = useMemo(() => document && document.planningStage !== 'composition'
    ? assessBlockoutStructure(document, { documentRevision: key }) : null, [key]);
  const scope = `${projectId}:${contextKey}`, requestKey = `${scope}:${key}`;
  const comparisonScope = `${scope}:${document?.documentId ?? ''}`;
  useEffect(() => {
    const preview = (event: Event) => {
      const detail = (event as CustomEvent<BlockoutComparisonResult>).detail;
      if (detail?.projectId !== projectId || detail.documentId !== document?.documentId) return;
      setComparisonResult({ scope: comparisonScope, error: detail.error });
    };
    window.addEventListener(BLOCKOUT_COMPARISON_RESULT_EVENT, preview);
    return () => window.removeEventListener(BLOCKOUT_COMPARISON_RESULT_EVENT, preview);
  }, [projectId, comparisonScope, document?.documentId]);
  useEffect(() => {
    setInventory(null); setResult(null); setError('');
  }, [projectId, contextKey]);
  useEffect(() => {
    if (!enabled || legacy) return;
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, attempts = 0;
    const controller = new AbortController();
    setResult(null); setLoading(true); setError('');
    async function read(refresh = false) {
      try {
        const { inventory: next } = await loadBlockoutMaterials(projectId, context, controller.signal, refresh);
        if (disposed) return;
        setInventory({ scope, inventory: next }); setError(''); setLoading(false);
        if (document && !generationBusy && next.status === 'ready') {
          setChecking(true);
          const [assessment, expected] = await Promise.all([assessBlockoutDocument(projectId, document, context, controller.signal), blockoutDocumentRevision(document)]);
          if (disposed) return;
          // A saved file or source may change while a font worker is measuring it.
          // Never carry its older ready state into this new snapshot.
          if (!expected || assessment.documentRevision !== expected || assessment.inventoryRevision !== next.revision
            || assessment.status === 'ready' && (document.materialRevision !== next.revision || assessment.materialRevision !== next.revision)) throw new Error('blockoutMaterials.checkFailed');
          setResult({ key: requestKey, assessment }); setChecking(false);
          if (assessment.status === 'waiting') timer = setTimeout(() => void read(), Math.min(20_000, 2500 * ++attempts));
        } else {
          setResult(null); setChecking(false);
          if (next.status === 'preparing' || next.status === 'waiting') timer = setTimeout(() => void read(), Math.min(20_000, 2500 * ++attempts));
        }
      } catch (failure) {
        if (disposed) return;
        setResult(null); setChecking(false); setLoading(false);
        setError(failure instanceof Error && failure.message === 'blockoutMaterials.checkFailed' ? failure.message : 'blockoutMaterials.loadFailed');
      }
    }
    const updated = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (event.type === PROJECT_HISTORY_UPDATED_EVENT && detail?.projectId !== projectId) return;
      if (detail?.projectId && detail.projectId !== projectId) return;
      setResult(null); setRevision((value) => value + 1);
    };
    const events = [BLOCKOUT_MATERIALS_UPDATED_EVENT, PROJECT_HISTORY_UPDATED_EVENT, 'melillodesign:project-intake-updated', 'melillodesign:document-context-updated', 'melillodesign:blockout-saved'];
    for (const event of events) window.addEventListener(event, updated);
    // Debouncing draft changes keeps dragging and typing responsive. The previous
    // measurement disappears immediately because its serialized key no longer matches.
    const refreshRequested = force.current; force.current = false;
    timer = setTimeout(() => void read(refreshRequested), 180);
    return () => { disposed = true; controller.abort(); clearTimeout(timer); for (const event of events) window.removeEventListener(event, updated); };
  // The serialized document and collaboration authority describe this exact request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, key, contextKey, enabled, legacy, generationBusy, revision]);
  return { inventory: structure ? null : inventoryResult?.scope === scope ? inventoryResult.inventory : null, assessment: enabled && !generationBusy ? structure ?? (!legacy && result?.key === requestKey ? result.assessment : null) : null, loading: structure ? false : loading, checking: structure ? false : checking, error: structure ? '' : error, legacy,
    comparisonError: comparisonResult?.scope === comparisonScope ? comparisonResult.error : undefined,
    retry: () => { setResult(null); force.current = true; setRevision((value) => value + 1); } };
}
