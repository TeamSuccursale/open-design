import { useEffect, useRef } from 'react';

/** CLI writes do not emit browser-local registry events. Observe native work
 * independently of whether the document drawer or file panel is mounted. */
export function useProjectDocumentRegistrySync(scope: string, running: boolean, empty: boolean, refresh: () => void, enabled = true, settledRunId?: string | null) {
  const previous = useRef({ scope, running });
  useEffect(() => {
    const settled = previous.current.scope === scope && previous.current.running && !running;
    previous.current = { scope, running };
    if (!enabled || !settled) return;
    refresh();
    // A terminal run event and its last registry projection may settle apart.
    const timer = setTimeout(refresh, 1_500);
    return () => clearTimeout(timer);
  }, [scope, running, refresh, enabled]);
  // Reattachment/reload can observe only the terminal message, not a live→idle
  // transition. Its stable run identity is still a registry invalidation signal.
  useEffect(() => {
    if (!enabled || !settledRunId) return;
    refresh();
  }, [scope, settledRunId, enabled, refresh]);
  useEffect(() => {
    if (!enabled || !running || !empty) return;
    refresh();
    let attempts = 0;
    const timer = setInterval(() => {
      refresh();
      if (++attempts >= 72) clearInterval(timer);
    }, 5_000);
    return () => clearInterval(timer);
  }, [scope, running, empty, refresh, enabled]);
}
