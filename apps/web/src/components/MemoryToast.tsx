// Floats above everything else and surfaces a transient "Memory updated"
// pill whenever the daemon emits a `kind: 'extract'` change event. We
// only fire on extraction events so a manual edit in the settings panel
// doesn't bounce a redundant toast back at the user (their click was the
// confirmation). The pill is clickable: tapping it opens Settings →
// Memory so the user can immediately see (and edit) the freshly
// extracted entries. The component owns its own EventSource so it can
// be dropped into App.tsx with no other plumbing.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type {
  MemoryChangeEvent,
  MemoryExtractionEvent,
  MemoryExtractionsResponse,
} from '@open-design/contracts';
import { useT } from '../i18n';
import { toastSlideUp } from '../motion';
import { bindStreamVisibility } from '../lib/stream-visibility';

interface ActiveToast {
  key: number;
  count: number;
  source?: MemoryChangeEvent['source'];
}

interface Props {
  // Optional click handler. When provided, the pill becomes a button
  // and clicking it should jump the user into Settings → Memory.
  onOpenMemory?: () => void;
  /**
   * Runs and idle/Home surfaces leave the browser's HTTP/1.1 slots available
   * for the run stream and normal requests. After a run ends, a bounded
   * hand-off can observe its memory extraction;
   * Settings → Memory remains the authoritative history outside that window.
   */
  subscriptionMode?: MemoryToastSubscriptionMode;
}

const VISIBLE_MS = 4500;
const EXTRACTION_START_GRACE_MS = 10_000;
const EXTRACTION_HANDOFF_MAX_MS = 60_000;

export type MemoryToastSubscriptionMode = 'activity' | 'idle' | 'off';

export function memoryToastSubscriptionMode(input: {
  routeKind: string;
  projectRunActive: boolean;
  memorySurfaceOpen: boolean;
}): MemoryToastSubscriptionMode {
  // MemorySection owns the same endpoint while its surface is open, so a
  // second toast-only connection would be redundant.
  if (input.memorySurfaceOpen) return 'off';
  if (input.routeKind !== 'project') return 'off';
  return input.projectRunActive ? 'activity' : 'idle';
}

export function MemoryToast({
  onOpenMemory,
  subscriptionMode = 'off',
}: Props) {
  const t = useT();
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  // We keep the dismiss timer in a ref so a second event mid-flight
  // resets the countdown instead of double-dismissing.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscriptionModeRef = useRef(subscriptionMode);
  const subscriptionCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscriptionExpiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeExtractionIdsRef = useRef(new Set<string>());
  const [streamVisible, setStreamVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const reconcileOnOpen = useRef(false);

  useEffect(() => {
    // The shared lease only reports a return after it has released a stream.
    // A component mounted hidden has no stream yet, so also observe an early
    // visible return before that grace window has elapsed.
    const becameVisible = () => {
      if (document.visibilityState !== 'hidden') setStreamVisible(true);
    };
    const binding = bindStreamVisibility({
      onHidden: () => { reconcileOnOpen.current = true; setStreamVisible(false); },
      onVisible: () => setStreamVisible(true),
    });
    document.addEventListener('visibilitychange', becameVisible);
    window.addEventListener('focus', becameVisible);
    return () => {
      binding.dispose();
      document.removeEventListener('visibilitychange', becameVisible);
      window.removeEventListener('focus', becameVisible);
    };
  }, []);

  useEffect(() => {
    const previousMode = subscriptionModeRef.current;
    subscriptionModeRef.current = subscriptionMode;
    if (subscriptionCloseTimerRef.current) {
      clearTimeout(subscriptionCloseTimerRef.current);
      subscriptionCloseTimerRef.current = null;
    }
    if (subscriptionExpiryTimerRef.current) {
      clearTimeout(subscriptionExpiryTimerRef.current);
      subscriptionExpiryTimerRef.current = null;
    }
    if (subscriptionMode === 'activity') {
      // Extraction follows child close. While the native run is active its
      // own stream has priority; a new run also ends any previous hand-off.
      activeExtractionIdsRef.current.clear();
      setSubscribed(false);
      return;
    }
    // Only a completed activity opens a short hand-off window so the
    // post-child-close extractor can announce its `running` id.
    if (subscriptionMode !== 'idle' || previousMode !== 'activity') {
      activeExtractionIdsRef.current.clear();
      setSubscribed(false);
      return;
    }
    // The extractor may have announced itself before the UI received the run's
    // terminal frame. Reconcile once when opening, alongside future events.
    reconcileOnOpen.current = true;
    setSubscribed(true);
    // A missing terminal frame (or a delayed extractor) must not leave a
    // visible idle tab holding a socket forever. This expires observation
    // only; extraction records and the native job continue independently.
    subscriptionExpiryTimerRef.current = setTimeout(() => {
      subscriptionExpiryTimerRef.current = null;
      if (subscriptionModeRef.current !== 'idle') return;
      activeExtractionIdsRef.current.clear();
      setSubscribed(false);
    }, EXTRACTION_HANDOFF_MAX_MS);
    subscriptionCloseTimerRef.current = setTimeout(() => {
      subscriptionCloseTimerRef.current = null;
      if (
        subscriptionModeRef.current === 'idle'
        && activeExtractionIdsRef.current.size === 0
      ) {
        setSubscribed(false);
      }
    }, EXTRACTION_START_GRACE_MS);
  }, [subscriptionMode]);

  useEffect(() => () => {
    if (subscriptionCloseTimerRef.current) {
      clearTimeout(subscriptionCloseTimerRef.current);
    }
    if (subscriptionExpiryTimerRef.current) {
      clearTimeout(subscriptionExpiryTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!subscribed || !streamVisible) return;
    // Guard for environments without EventSource (jsdom in tests, SSR).
    // The toast is purely a UX nicety; no SSE just means no auto-pop-up.
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/memory/events');
    const reconcile = new AbortController();
    let disposed = false;
    let reconcileTimeout: ReturnType<typeof setTimeout> | undefined;
    const changedSinceResume = new Set<string>();
    if (reconcileOnOpen.current) {
      reconcileOnOpen.current = false;
      // Only observation resumes. A terminal event may have arrived while the
      // toast released its socket; reconcile before retaining idle ownership.
      reconcileTimeout = setTimeout(() => reconcile.abort(), 5000);
      void fetch('/api/memory/extractions', { signal: reconcile.signal, cache: 'no-store' })
        .then(async response => {
          if (!response.ok) throw new Error('Memory extraction snapshot unavailable');
          const value = await response.json() as MemoryExtractionsResponse;
          if (!Array.isArray(value.extractions)) throw new Error('Invalid memory extraction snapshot');
          if (disposed) return;
          const running = new Set(value.extractions.filter(record => record.phase === 'running').map(record => record.id));
          // Missing rows may have been evicted or explicitly cleared. Retain
          // notification ownership only for known running rows, without
          // overriding a newer SSE transition received during this read.
          for (const id of activeExtractionIdsRef.current) if (!changedSinceResume.has(id) && !running.has(id)) activeExtractionIdsRef.current.delete(id);
          for (const id of running) if (!changedSinceResume.has(id)) activeExtractionIdsRef.current.add(id);
          if (subscriptionModeRef.current === 'idle' && activeExtractionIdsRef.current.size === 0 && subscriptionCloseTimerRef.current === null) setSubscribed(false);
        })
        .catch(() => {
          // Notification failure cannot reserve an idle socket indefinitely.
          // This does not change extraction records or the native job.
          if (disposed) return;
          for (const id of activeExtractionIdsRef.current) {
            if (!changedSinceResume.has(id)) activeExtractionIdsRef.current.delete(id);
          }
          if (subscriptionModeRef.current === 'idle' && activeExtractionIdsRef.current.size === 0 && subscriptionCloseTimerRef.current === null) setSubscribed(false);
        })
        .finally(() => { if (reconcileTimeout) clearTimeout(reconcileTimeout); });
    }
    es.addEventListener('change', (raw) => {
      try {
        const event = JSON.parse((raw as MessageEvent).data) as MemoryChangeEvent;
        if (event.kind !== 'extract') return;
        if ((event.count ?? 0) <= 0) return;
        // Source defaults to heuristic but a manual extract via curl
        // would still be useful to surface. Only suppress when source is
        // 'manual' (won't currently fire, reserved for future settings
        // bulk-import hook).
        if (event.source === 'manual') return;
        setToast({
          key: Date.now(),
          count: event.count ?? 1,
          source: event.source,
        });
      } catch {
        // Malformed payload — ignore.
      }
    });
    es.addEventListener('error', () => {
      // The browser will auto-reconnect. We don't surface connection
      // failures because the SSE channel is purely a UX nicety; missing
      // a notification still lets the user see updates next time they
      // open Settings → Memory.
    });
    es.addEventListener('extraction', (raw) => {
      try {
        const event = JSON.parse((raw as MessageEvent).data) as MemoryExtractionEvent;
        if (!event?.id) return;
        changedSinceResume.add(event.id);
        if (event.phase === 'running') {
          activeExtractionIdsRef.current.add(event.id);
          if (subscriptionCloseTimerRef.current) {
            clearTimeout(subscriptionCloseTimerRef.current);
            subscriptionCloseTimerRef.current = null;
          }
          return;
        }
        activeExtractionIdsRef.current.delete(event.id);
        if (
          subscriptionModeRef.current === 'idle'
          && activeExtractionIdsRef.current.size === 0
        ) {
          subscriptionCloseTimerRef.current = setTimeout(() => {
            subscriptionCloseTimerRef.current = null;
            if (subscriptionModeRef.current === 'idle') setSubscribed(false);
          }, 0);
        }
      } catch {
        // Malformed payload — ignore.
      }
    });
    return () => {
      disposed = true; reconcile.abort();
      if (reconcileTimeout) clearTimeout(reconcileTimeout);
      es.close();
    };
  }, [subscribed, streamVisible]);

  useEffect(() => {
    if (!toast) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), VISIBLE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast]);

  const label = toast ? t('settings.memoryToastChanged') : '';
  const detail = toast
    ? toast.source === 'llm'
      ? `(${toast.count} · LLM)`
      : toast.source === 'annotation'
        ? `(${toast.count} · annotations)`
        : `(${toast.count})`
    : '';
  const clickHint = toast ? t('settings.memoryToastClickHint') : '';

  const pillStyle: CSSProperties = {
    position: 'fixed',
    bottom: 20,
    right: 20,
    zIndex: 1000,
    padding: '8px 14px',
    borderRadius: 999,
    background: 'rgba(20, 20, 20, 0.92)',
    color: '#fff',
    fontSize: 13,
    boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    backdropFilter: 'blur(8px)',
    border: 'none',
    font: 'inherit',
    cursor: onOpenMemory ? 'pointer' : 'default',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
  };

  return (
    <AnimatePresence>
      {toast ? (
        !onOpenMemory ? (
          <motion.div
            key={toast.key}
            role="status"
            aria-live="polite"
            style={pillStyle}
            variants={toastSlideUp}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <span aria-hidden style={{ fontSize: 14 }}>✦</span>
            <span>{label}</span>
            <span style={{ opacity: 0.65 }}>{detail}</span>
          </motion.div>
        ) : (
          <motion.button
            key={toast.key}
            type="button"
            aria-live="polite"
            aria-label={`${label} ${detail} — ${clickHint}`}
            title={clickHint}
            onClick={onOpenMemory}
            whileHover={{ y: -1, boxShadow: '0 10px 28px rgba(0,0,0,0.24)' }}
            style={pillStyle}
            variants={toastSlideUp}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <span aria-hidden style={{ fontSize: 14 }}>✦</span>
            <span>{label}</span>
            <span style={{ opacity: 0.65 }}>{detail}</span>
            <span
              aria-hidden
              style={{
                marginLeft: 4,
                paddingLeft: 8,
                borderLeft: '1px solid rgba(255,255,255,0.18)',
                opacity: 0.85,
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              {clickHint} →
            </span>
          </motion.button>
        )
      ) : null}
    </AnimatePresence>
  );
}
