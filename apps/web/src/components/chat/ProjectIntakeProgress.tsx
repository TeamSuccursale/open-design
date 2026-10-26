import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type { ProjectIntakeCatalog, WorkspaceCollabContext } from '@open-design/contracts';
import { useT } from '../../i18n';
import { fetchProjectIntake, OPEN_PROJECT_GALLERY_EVENT, PROJECT_INTAKE_UPDATED_EVENT, PROJECT_INTAKE_RETRY_EVENT } from '../../providers/project-intake';
import { projectIntakeProgress } from '../../runtime/chat/project-intake-progress';
import type { IntakeStatusSnapshot } from '../../runtime/chat/project-preparation-status';
import { Icon } from '../Icon';
import styles from './ProjectIntakeProgress.module.css';

interface Props { projectId: string; workspaceContext?: WorkspaceCollabContext | null; onSnapshot?: (value: IntakeStatusSnapshot) => void }
const empty: ProjectIntakeCatalog = { version: 1, documents: [], assets: [] };

/** Independent of agent runs: observing intake never locks or submits the composer. */
export function ProjectIntakeProgress({ projectId, workspaceContext, onSnapshot }: Props) {
  const t = useT();
  const [catalog, setCatalog] = useState<ProjectIntakeCatalog>(empty);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [launchError, setLaunchError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  const mounted = useRef(false);
  const progress = useMemo(() => projectIntakeProgress(catalog), [catalog]);
  useEffect(() => { onSnapshot?.({ catalog, loaded, error: Boolean(error), launchError: Boolean(launchError) }); }, [onSnapshot, catalog, loaded, error, launchError]);

  useEffect(() => {
    mounted.current = true;
    setCatalog(empty); setLoaded(false); setError(''); setLaunchError('');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false, refreshAgain = false, failures = 0, unchanged = 0;
    let previous = '';
    function schedule(delay: number) {
      clearTimeout(timer);
      if (!controller.signal.aborted && document.visibilityState !== 'hidden') timer = setTimeout(() => { void refresh(); }, delay);
    }
    async function refresh() {
      if (running) { refreshAgain = true; return; }
      running = true;
      let nextDelay: number | undefined;
      try {
        const next = await fetchProjectIntake(projectId, workspaceContext, undefined, controller.signal);
        if (controller.signal.aborted) return;
        setCatalog(next); setLoaded(true); setError(''); failures = 0;
        const summary = projectIntakeProgress(next);
        const signature = JSON.stringify([next.documents.map((item) => [item.id, item.status, item.completedPages, item.pageCount, item.updatedAt]), next.assets.length, summary.failedAssets, summary.active]);
        unchanged = previous === signature ? unchanged + 1 : 0;
        previous = signature;
        // Active work is watched closely; idle refresh still discovers CLI starts.
        nextDelay = summary.active ? Math.min(8000, 1800 + unchanged * 400) : 30_000;
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(failure instanceof Error ? failure.message : String(failure));
        failures += 1;
        // Repeated connection failures settle until explicit retry or focus.
        if (failures < 4) nextDelay = Math.min(30_000, 2000 * 2 ** failures);
      } finally {
        running = false;
        if (!controller.signal.aborted) {
          if (refreshAgain) { refreshAgain = false; schedule(0); }
          else if (nextDelay !== undefined) schedule(nextDelay);
        }
      }
    }
    function wake() { clearTimeout(timer); void refresh(); }
    function updated(event: Event) {
      const detail = (event as CustomEvent<{ projectId?: string; launchError?: string }>).detail;
      if (detail?.projectId !== projectId) return;
      setLaunchError(detail.launchError ?? '');
      wake();
    }
    function visibility() {
      if (document.visibilityState === 'hidden') clearTimeout(timer);
      else wake();
    }
    refreshRef.current = wake;
    window.addEventListener(PROJECT_INTAKE_UPDATED_EVENT, updated);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', visibility);
    void refresh();
    return () => {
      mounted.current = false; controller.abort(); clearTimeout(timer);
      window.removeEventListener(PROJECT_INTAKE_UPDATED_EVENT, updated);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [projectId, workspaceContext]);

  async function retryFailed() {
    if (retrying || !progress.retryPaths.length) return;
    setRetrying(true); setError('');
    try {
      const next = await fetchProjectIntake(projectId, workspaceContext, { paths: progress.retryPaths, retry: true });
      if (mounted.current) setCatalog(next);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (mounted.current) setRetrying(false); }
  }
  if (!catalog.documents.length && !catalog.assets.length && !error && !launchError) return null;
  const label = launchError ? t('intake.progress.launchFailed') : error ? t('intake.progress.unavailable') : progress.active ? t('intake.progress.active') : progress.hasFailures ? t('intake.progress.incomplete') : t('intake.progress.ready');
  const pageText = progress.unknownTotals ? t('intake.progress.pagesUnknown', { done: progress.completedPages }) : t('intake.progress.pages', { done: progress.completedPages, total: progress.totalPages });
  return <section className={styles.root} aria-label={t('intake.progress.region')} data-testid="project-intake-progress" data-state={launchError ? 'failed' : error ? 'unavailable' : progress.active ? 'processing' : progress.hasFailures ? 'failed' : 'ready'}>
    <div className={styles.heading}>
      <div className={styles.summary} role="status" aria-live="polite" aria-atomic="true">
        <Icon name={progress.hasFailures || error || launchError ? 'alert-triangle' : progress.active ? 'image' : 'check'} size={15} />
        <strong>{label}</strong>
        {catalog.documents.length ? <span className={styles.count}>{pageText}</span> : null}
      </div>
      <div className={styles.actions}>
        {launchError ? <Button variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent(PROJECT_INTAKE_RETRY_EVENT, { detail: { projectId } }))}>{t('intake.progress.retryLaunch')}</Button> : null}
        {error ? <Button variant="ghost" onClick={() => refreshRef.current()}>{t('intake.progress.refresh')}</Button> : null}
        {progress.hasFailures && progress.retryPaths.length ? <Button variant="ghost" disabled={retrying} aria-busy={retrying} onClick={() => void retryFailed()}>{t(retrying ? 'intake.progress.retrying' : 'intake.progress.retry')}</Button> : null}
        <Button variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PROJECT_GALLERY_EVENT, { detail: { projectId } }))}>{t('intake.openGallery')}</Button>
      </div>
    </div>
    {progress.active || progress.percent !== undefined ? <progress className={styles.bar} aria-label={t('intake.progress.bar')} aria-valuetext={pageText} max={100} {...(progress.percent !== undefined ? { value: progress.percent } : {})} /> : null}
    {launchError ? <p className={styles.error} role="alert">{t('intake.progress.launchHint')} <span>{launchError}</span></p> : null}
    {error ? <p className={styles.error} role="alert">{t('intake.progress.connectionHint')} <span>{error}</span></p> : catalog.documents.length || catalog.assets.length ? <details className={styles.details}>
      <summary>
        <span>{progress.active ? t('intake.progress.background') : t('intake.progress.details')}</span>
        <span className={styles.counts}>
          {progress.queued ? <span>{t('intake.progress.queued', { count: progress.queued })}</span> : null}
          {progress.processing ? <span>{t('intake.progress.processing', { count: progress.processing })}</span> : null}
          {progress.ready ? <span>{t('intake.progress.completed', { count: progress.ready })}</span> : null}
          {progress.failed ? <span className={styles.failure}>{t('intake.progress.failed', { count: progress.failed })}</span> : null}
          {progress.failedAssets ? <span className={styles.failure}>{t('intake.progress.failedAssets', { count: progress.failedAssets })}</span> : null}
        </span>
      </summary>
      <ul className={styles.documents}>
        {catalog.documents.map((document) => <li key={document.id}>
          <div><span className={styles.documentName}>{document.name}</span><span>{t(`intake.status.${document.status}` as 'intake.status.ready')} · {document.pageCount ? t('intake.progress.pages', { done: Math.min(document.pageCount, document.completedPages), total: document.pageCount }) : t('intake.progress.discovering')}</span></div>
          {document.error ? <p className={styles.failure}>{document.error}</p> : null}
        </li>)}
      </ul>
    </details> : null}
  </section>;
}
