import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectDocumentsResponse, WorkspaceCollabContext } from '@open-design/contracts';
import { listProjectDocuments, PROJECT_DOCUMENTS_UPDATED_EVENT } from '../../providers/project-documents';

export function useProjectDocuments(projectId: string, context?: WorkspaceCollabContext | null, enabled = true): ProjectDocumentsResponse & { loading: boolean; error: boolean; refresh: () => void } {
  const [loaded, setLoaded] = useState<{ scope: string; value: ProjectDocumentsResponse } | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(false), [revision, setRevision] = useState(0);
  const scope = `${projectId}:${JSON.stringify(context ?? null)}`;
  const reading = useRef(false), refreshQueued = useRef(false);
  const refresh = useCallback(() => { if (reading.current) { refreshQueued.current = true; return; } setRevision((value) => value + 1); }, []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController(); let disposed = false;
    reading.current = true; refreshQueued.current = false; setLoading(true); setError(false);
    const timer = setTimeout(() => { if (!disposed) { controller.abort(); setError(true); setLoading(false); reading.current = false; } }, 20_000);
    void listProjectDocuments(projectId, context, controller.signal).then((value) => {
      if (!disposed && !controller.signal.aborted) setLoaded({ scope, value });
    }).catch(() => { if (!disposed && !controller.signal.aborted) setError(true); }).finally(() => {
      clearTimeout(timer);
      if (!disposed && !controller.signal.aborted) { reading.current = false; setLoading(false); if (refreshQueued.current) { refreshQueued.current = false; setRevision((value) => value + 1); } }
    });
    return () => { disposed = true; clearTimeout(timer); controller.abort(); reading.current = false; };
    // Scope contains the complete collaboration identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, scope, enabled, revision]);
  useEffect(() => {
    if (!enabled) return;
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      refresh();
    };
    for (const name of [PROJECT_DOCUMENTS_UPDATED_EVENT, 'melillodesign:blockout-saved', 'melillodesign:project-history-updated']) window.addEventListener(name, changed);
    return () => { for (const name of [PROJECT_DOCUMENTS_UPDATED_EVENT, 'melillodesign:blockout-saved', 'melillodesign:project-history-updated']) window.removeEventListener(name, changed); };
  }, [projectId, enabled, refresh]);
  return { documents: loaded?.scope === scope ? loaded.value.documents : [], selectedDocumentId: loaded?.scope === scope ? loaded.value.selectedDocumentId : null, pendingCreations: loaded?.scope === scope ? loaded.value.pendingCreations ?? [] : [], loading: enabled && (loading || (loaded?.scope !== scope && !error)), error, refresh };
}
