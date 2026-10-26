import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type { DocumentResearchFinding, DocumentResearchRun, WorkspaceCollabContext } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { workspaceIdentityCacheKey } from '../../collab/workspace-identity';
import { DocumentResearchNotReadyError, DocumentResearchUnavailableError, documentResearchRequest, researchOverviewPreview, visibleResearchFindings } from '../../providers/document-research';
import styles from './DocumentResearchStatus.module.css';
import { ProjectCustodianStatus } from './ProjectCustodianStatus';
import type { CustodianStatusSnapshot, ResearchStatusSnapshot } from '../../runtime/chat/project-preparation-status';

export interface DocumentResearchStatusProps { projectId: string; workspaceContext?: WorkspaceCollabContext | null; disabled?: boolean; onResearchSnapshot?: (value: ResearchStatusSnapshot) => void; onCustodianSnapshot?: (value: CustodianStatusSnapshot) => void }
type Action = 'read' | 'start' | 'retry';
const activeStatuses = new Set(['queued', 'quick', 'full']);
export const DOCUMENT_PREPARATION_STARTED_EVENT = 'melillodesign:document-preparation-started';

/** Quick findings remain readable while the same job continues its full text pass. */
export function DocumentResearchStatus(props: DocumentResearchStatusProps) {
  return <><ProjectCustodianStatus {...props} onSnapshot={props.onCustodianSnapshot} /><DocumentResearchReadStatus {...props} /></>;
}

function DocumentResearchReadStatus({ projectId, workspaceContext, disabled = false, onResearchSnapshot }: DocumentResearchStatusProps) {
  const { t } = useI18n();
  const scope = `${projectId}\0${workspaceIdentityCacheKey(workspaceContext)}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const active = useRef<AbortController | null>(null);
  const preparationScope = useRef<string | null>(null);
  const pendingPreparation = useRef<{ scope: string; startedAt: number; notReadySince?: number; attempts: number; dueAt: number } | null>(null);
  const [pendingVersion, setPendingVersion] = useState(0);
  const [state, setState] = useState<{ scope: string; run: DocumentResearchRun | null }>({ scope, run: null });
  const [busy, setBusy] = useState<Action | null>('read');
  const [failure, setFailure] = useState<Action | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [visibleFindings, setVisibleFindings] = useState(40);
  const detailsId = useId();
  const run = state.scope === scope ? state.run : null;
  useEffect(() => { onResearchSnapshot?.({ run, busy, error: Boolean(failure), unavailable, pending: pendingPreparation.current?.scope === scope }); }, [onResearchSnapshot, run, busy, failure, unavailable, scope, pendingVersion]);

  const execute = useCallback(async (action: Action) => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(action); setFailure(null);
    try {
      const research = await documentResearchRequest(projectId, workspaceContext, action === 'read' ? undefined : { retry: action === 'retry' }, controller.signal);
      if (!controller.signal.aborted && currentScope.current === scope) {
        setState({ scope, run: research });
        setUnavailable(false);
        if (action !== 'read') { pendingPreparation.current = null; setPendingVersion((value) => value + 1); }
      }
    } catch (error) {
      if (!controller.signal.aborted && currentScope.current === scope) {
        const pending = pendingPreparation.current;
        if (action !== 'read' && pending?.scope === scope
          && (error instanceof DocumentResearchUnavailableError || error instanceof DocumentResearchNotReadyError)) {
          const now = Date.now();
          if (error instanceof DocumentResearchNotReadyError && pending.notReadySince === undefined) pending.notReadySince = now;
          if (error instanceof DocumentResearchNotReadyError && now - pending.notReadySince! >= 60_000) {
            pendingPreparation.current = null; setFailure(action);
          } else {
            pending.attempts += 1;
            pending.dueAt = now + (error instanceof DocumentResearchNotReadyError ? 5000 : Math.min(10_000, 1000 * 2 ** Math.min(pending.attempts, 4)));
            if (error instanceof DocumentResearchUnavailableError) setUnavailable(true);
          }
          setPendingVersion((value) => value + 1);
        } else if (action === 'read' && error instanceof DocumentResearchUnavailableError) setUnavailable(true);
        else { pendingPreparation.current = null; setFailure(action); }
      }
    } finally {
      if (active.current === controller) { active.current = null; setBusy(null); }
    }
    // The complete wire identity, rather than context object identity, scopes a request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, scope]);

  useEffect(() => {
    setState({ scope, run: null }); setExpanded(false); setVisibleFindings(40); setFailure(null); setUnavailable(false); setOverviewExpanded(false);
    preparationScope.current = null; pendingPreparation.current = null;
    void execute('read');
    const prepare = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId !== projectId || preparationScope.current === scope) return;
      preparationScope.current = scope;
      pendingPreparation.current = { scope, startedAt: Date.now(), attempts: 0, dueAt: Date.now() };
      setPendingVersion((value) => value + 1); setFailure(null);
    };
    window.addEventListener(DOCUMENT_PREPARATION_STARTED_EVENT, prepare);
    return () => {
      active.current?.abort(); active.current = null; pendingPreparation.current = null; preparationScope.current = null;
      window.removeEventListener(DOCUMENT_PREPARATION_STARTED_EVENT, prepare);
    };
  }, [scope, execute]);

  useEffect(() => {
    const pending = pendingPreparation.current;
    if (pending?.scope !== scope || busy || disabled) return;
    const timer = setTimeout(() => void execute('start'), Math.max(0, pending.dueAt - Date.now()));
    return () => clearTimeout(timer);
  }, [scope, busy, disabled, pendingVersion, execute]);

  useEffect(() => {
    if (!run || !activeStatuses.has(run.status) || failure || busy) return;
    const timer = setTimeout(() => void execute('read'), 2000);
    return () => clearTimeout(timer);
  }, [run, failure, busy, execute]);

  if (unavailable) return null;
  const overview = run ? visibleResearchFindings(run, run.overview) : [];
  const overviewPreview = researchOverviewPreview(overview);
  const findings = run ? visibleResearchFindings(run, run.findings) : [];

  function renderFindings(findings: DocumentResearchFinding[]) {
    return <ul className={styles.findings}>{findings.map((finding, index) => {
      const source = run?.sources.find((item) => item.id === finding.sourceId);
      return <li key={`${finding.sourceId}-${index}`}>
        <p>{finding.text}</p>
        <span className={styles.citation}>{t('documentResearch.sourcePages', { source: source?.title ?? t('documentResearch.unknownSource'), pages: finding.pages.join(', ') })}
          {finding.certainty !== 'observed' ? ` · ${t(finding.certainty === 'inferred' ? 'documentResearch.inferred' : 'documentResearch.conflict')}` : ''}
        </span>
      </li>;
    })}</ul>;
  }

  return <section className={styles.root} aria-label={t('documentResearch.title')} data-testid="document-research-status">
    <div className={styles.header}>
      <Button variant="ghost" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((value) => !value)}>{t('documentResearch.title')}</Button>
      <span className={styles.status} role="status">
        {run ? t(`documentResearch.${run.status}`) : pendingPreparation.current?.scope === scope ? t('documentResearch.waitingForText') : busy ? t('documentResearch.loading') : t('documentResearch.idle')}
        {run ? ` · ${t('documentResearch.pages', { read: run.coverage.pagesAnalyzed, total: run.coverage.pagesTotal })}` : ''}
      </span>
      {!run && !failure && pendingPreparation.current?.scope !== scope ? <Button variant="ghost" disabled={disabled || busy !== null} onClick={() => void execute('start')}>{t('documentResearch.start')}</Button> : null}
      {run && ['partial', 'failed'].includes(run.status) && !failure ? <Button variant="ghost" disabled={disabled || busy !== null} onClick={() => void execute('retry')}>{t('documentResearch.retry')}</Button> : null}
    </div>
    {failure ? <div className={styles.error} role="alert">
      <span>{t(failure === 'read' ? 'documentResearch.loadFailed' : 'documentResearch.startFailed')}</span>
      <Button variant="ghost" disabled={busy !== null || (failure !== 'read' && disabled)} onClick={() => void execute(failure)}>{t('documentContext.retry')}</Button>
    </div> : null}
    <div id={detailsId} className={styles.details} hidden={!expanded}>
      {!run ? <p>{t('documentResearch.intro')}</p> : <>
        <p className={styles.scope}>{t('documentResearch.scope', { count: run.coverage.sourcesTotal })}</p>
        <h3>{t('documentResearch.overview')}</h3>
        {overview.length ? renderFindings(overviewExpanded ? overview : overviewPreview) : <p className={styles.scope}>{t('documentResearch.overviewPending')}</p>}
        {overview.length > overviewPreview.length ? <Button variant="ghost" aria-expanded={overviewExpanded} onClick={() => setOverviewExpanded((value) => !value)}>{t(overviewExpanded ? 'documentResearch.lessOverview' : 'documentResearch.moreOverview')}</Button> : null}
        <h3>{t('documentResearch.analysis')}</h3>
        {findings.length ? renderFindings(findings.slice(0, visibleFindings)) : <p className={styles.scope}>{t('documentResearch.analysisPending')}</p>}
        {findings.length > visibleFindings ? <Button variant="ghost" onClick={() => setVisibleFindings((count) => count + 40)}>{t('documentResearch.showMore')}</Button> : null}
        <h3>{t('documentResearch.coverage')}</h3>
        <ul className={styles.coverage}>{run.coverage.sources.map((coverage) => <li key={coverage.sourceId}>
          <strong>{run.sources.find((source) => source.id === coverage.sourceId)?.title ?? t('documentResearch.unknownSource')}</strong>
          <span>{t('documentResearch.pages', { read: coverage.analyzedPages.length, total: coverage.pagesTotal })}</span>
          {coverage.pendingPages.length ? <span>{t('documentResearch.pendingPages', { pages: coverage.pendingPages.join(', ') })}</span> : null}
          {coverage.unreadablePages.length ? <span>{t('documentResearch.unreadablePages', { pages: coverage.unreadablePages.join(', ') })}</span> : null}
        </li>)}</ul>
        {run.warnings.length ? <ul className={styles.warnings}>{run.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
        {run.workers.some((worker) => worker.status === 'failed') ? <p className={styles.error}>{t('documentResearch.workerFailed', { count: run.workers.filter((worker) => worker.status === 'failed').length })}</p> : null}
      </>}
    </div>
  </section>;
}
