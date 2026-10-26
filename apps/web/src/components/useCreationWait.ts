import { useEffect, useRef, useState } from 'react';
import { LOCAL_REQUEST_TIMEOUT_MS } from '../runtime/request-deadline';

/** Keep observing one create request; waiting again never resubmits it. */
export function useCreationWait() {
  const [slow, setSlow] = useState(false);
  const pending = useRef<Promise<unknown> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(timer.current); };
  }, []);
  function continueWaiting() {
    clearTimeout(timer.current);
    setSlow(false);
    if (pending.current) timer.current = setTimeout(() => { if (mounted.current) setSlow(true); }, LOCAL_REQUEST_TIMEOUT_MS);
  }
  async function observe<T>(create: () => T | Promise<T>): Promise<T> {
    if (pending.current) return pending.current as Promise<T>;
    const request = Promise.resolve().then(create);
    pending.current = request;
    continueWaiting();
    try { return await request; }
    finally {
      pending.current = null;
      clearTimeout(timer.current);
      if (mounted.current) setSlow(false);
    }
  }
  return { slow, continueWaiting, observe };
}
