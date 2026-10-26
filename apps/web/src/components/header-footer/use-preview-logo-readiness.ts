import { useCallback, useEffect, useRef, useState } from 'react';
import { warmPreviewLogos, type PreviewLogo } from './preview-image-readiness';

type State = { key: string; status: 'inactive' | 'loading' | 'ready' | 'error'; error?: unknown };

export function usePreviewLogoReadiness(plan: {
  active: boolean;
  // Include set/revision/draft fingerprint, preview format, enabled regions,
  // and every referenced asset ID/URL/hash for all formats to be applied.
  key: string;
  assets: readonly PreviewLogo[];
  missingAsset?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([plan.active, plan.key, plan.missingAsset, attempt]);
  const currentPlan = useRef(plan); currentPlan.current = plan;
  const [state, setState] = useState<State>({ key: '', status: 'inactive' });
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    const request = currentPlan.current, abort = new AbortController();
    if (!request.active) { setState({ key, status: 'inactive' }); return; }
    if (request.missingAsset) {
      setState({ key, status: 'error', error: new Error(`Logo not found: ${request.missingAsset}`) });
      return;
    }
    setState({ key, status: 'loading' });
    void warmPreviewLogos(request.assets, { signal: abort.signal }).then(() => {
      if (!abort.signal.aborted) setState({ key, status: 'ready' });
    }, (error: unknown) => {
      if (!abort.signal.aborted) setState({ key, status: 'error', error });
    });
    return () => abort.abort();
  }, [key]);
  // Never expose a previous model's ready state for even the render before
  // useEffect cleanup. Approval also binds to this exact readiness key.
  const current: State = state.key === key ? state : {
    key,
    status: !plan.active ? 'inactive' : plan.missingAsset ? 'error' : 'loading',
  };
  return { ...current, retry };
}
