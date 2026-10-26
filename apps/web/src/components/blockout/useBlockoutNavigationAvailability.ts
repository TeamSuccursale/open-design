import { useEffect, useState } from 'react';
import { isBlockoutComparisonFile, isBlockoutFile, type BlockoutDocument, type WorkspaceCollabContext } from '@open-design/contracts';
import { BLOCKOUT_COMPARISON_RESULT_EVENT, listBlockoutDocuments, loadBlockout, registeredBlockoutComparisonDocument } from '../../providers/blockout';

/** A setup seed records page settings, not a proposal the user can inspect. */
export function hasNavigableBlockout(document: BlockoutDocument | null): boolean {
  if (!document) return false;
  if (document.variants.some((variant) => variant.pages.some((page) => page.blocks.length > 0))) return true;
  if (document.selectedVariantId || document.approval || document.answers.length > 0) return true;
  // Legacy workspaces predate the structural-seed contract. Keep them reachable.
  return document.planningStage === undefined;
}

export function useBlockoutNavigationAvailability(projectId: string, files: readonly { name: string }[], refreshKey: number, context?: WorkspaceCollabContext | null, enabled = true): boolean {
  const [availability, setAvailability] = useState<{ scope: string; available: boolean } | null>(null), [revision, setRevision] = useState(0);
  const scope = `${projectId}:${JSON.stringify(context ?? null)}`;
  const relevantFiles = JSON.stringify(files.filter((file) => isBlockoutFile(file.name) || isBlockoutComparisonFile(file.name) || /(?:^|\/)\.workspace\.json$|blockouts\/\.documents\.json$/.test(file.name)).map((file) => file.name));
  useEffect(() => {
    if (!enabled) return;
    const update = (event: Event) => { const detail = (event as CustomEvent<{ projectId?: string }>).detail; if (detail?.projectId && detail.projectId !== projectId) return; setRevision((value) => value + 1); };
    const events = ['melillodesign:blockout-saved', BLOCKOUT_COMPARISON_RESULT_EVENT, 'melillodesign:project-history-updated'];
    events.forEach((name) => window.addEventListener(name, update));
    return () => events.forEach((name) => window.removeEventListener(name, update));
  }, [projectId, enabled]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false; const abort = new AbortController();
    async function read() {
      try {
        const legacy = files.some((file) => /^blockout\/(?:layout|proposal[^/]*)\.json$/i.test(file.name.replaceAll('\\', '/')));
        const catalog = await listBlockoutDocuments(projectId, context).catch((error: unknown) => { if (legacy) return []; throw error; });
        const identities = new Set(catalog.map((entry) => entry.id));
        // A collection's working chat can own the preview tab while its saved
        // structure lives in a registered document workspace.
        const linked = await Promise.all(files.filter((file) => isBlockoutComparisonFile(file.name)).map((file) => registeredBlockoutComparisonDocument(projectId, file.name, context, abort.signal)));
        for (const id of linked) if (id) identities.add(id);
        // Old folders can have layout.json without a generated catalog entry.
        if (legacy) identities.add('document-1');
        const workspaces = await Promise.all([...identities].map((id) => loadBlockout(projectId, context, abort.signal, id)));
        if (!cancelled) setAvailability({ scope, available: workspaces.some((value) => hasNavigableBlockout(value.document)) });
      } catch { /* Preserve a known workspace through a transient read failure. */ }
    }
    const timer = window.setTimeout(() => void read(), 100);
    return () => { cancelled = true; abort.abort(); window.clearTimeout(timer); };
  // Files are a committed project snapshot; only relevant names and its refresh key invalidate this read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, relevantFiles, refreshKey, enabled, revision]);
  return enabled && availability?.scope === scope && availability.available;
}
