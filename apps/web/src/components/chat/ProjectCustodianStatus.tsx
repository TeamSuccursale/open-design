import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type { CustodianDomain, WorkspaceCollabContext } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { workspaceIdentityCacheKey } from '../../collab/workspace-identity';
import { askProjectCustodian, custodianDisplayText, ProjectCustodiansUnavailableError, pulseProjectCustodians, readCustodianHistory, readProjectCustodians } from '../../providers/project-custodians';
import { OPEN_PROJECT_GALLERY_EVENT } from '../../providers/project-intake';
import type { CustodianStatusSnapshot } from '../../runtime/chat/project-preparation-status';
import styles from './ProjectCustodianStatus.module.css';

export interface ProjectCustodianStatusProps { projectId: string; workspaceContext?: WorkspaceCollabContext | null; disabled?: boolean; onSnapshot?: (value: CustodianStatusSnapshot) => void }
type Snapshot = Awaited<ReturnType<typeof readProjectCustodians>>;
type History = Awaited<ReturnType<typeof readCustodianHistory>>;
type Answer = Awaited<ReturnType<typeof askProjectCustodian>>;

/** A visible project renews a bounded indexing lease; original-source access stays with its custodians. */
export function ProjectCustodianStatus({ projectId, workspaceContext, disabled = false, onSnapshot }: ProjectCustodianStatusProps) {
  const { t, locale } = useI18n();
  const scope = `${projectId}\0${workspaceIdentityCacheKey(workspaceContext)}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const activityAllowed = useRef(!disabled); activityAllowed.current = !disabled;
  const [snapshot, setSnapshot] = useState<{ scope: string; value: Snapshot } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<History | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [domain, setDomain] = useState<CustodianDomain>('text');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [asking, setAsking] = useState(false);
  const [askFailed, setAskFailed] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const askController = useRef<AbortController | null>(null);
  const id = useId();
  const value = snapshot?.scope === scope ? snapshot.value : null;
  useEffect(() => { onSnapshot?.({ ledger: value?.ledger ?? null, indexing: value?.indexing ?? null, error: refreshFailed }); }, [onSnapshot, value, refreshFailed]);

  useEffect(() => {
    let stopped = false, busy = false, misses = 0, lastAttempt = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    setSnapshot(null); setExpanded(false); setHistory(null); setHistoryFailed(false); setRefreshFailed(false);
    setQuestion(''); setDomain('text'); setAnswer(null); setAskFailed(false); setAsking(false);
    const tick = async () => {
      if (stopped || document.hidden || busy) return;
      busy = true; lastAttempt = Date.now(); controller = new AbortController();
      const signal = controller.signal;
      try {
        const next = await readProjectCustodians(projectId, workspaceContext, signal);
        if (stopped || signal.aborted) return;
        setSnapshot({ scope, value: next }); setRefreshFailed(false); misses = 0;
        if (activityAllowed.current) {
          const indexing = await pulseProjectCustodians(projectId, true, workspaceContext, signal);
          if (!stopped && !signal.aborted) setSnapshot({ scope, value: { ...next, indexing } });
        }
      } catch (error) {
        if (!stopped && !signal.aborted) {
          if (error instanceof ProjectCustodiansUnavailableError) { misses += 1; setRefreshFailed(false); }
          else setRefreshFailed(true);
        }
      } finally {
        busy = false;
        if (!stopped && !document.hidden) timer = setTimeout(() => void tick(), Math.min(300_000, 30_000 * 2 ** Math.min(misses, 4)));
      }
    };
    const visibility = () => {
      if (document.hidden) { clearTimeout(timer); controller?.abort(); }
      else if (Date.now() - lastAttempt >= 30_000) { clearTimeout(timer); void tick(); }
      else { clearTimeout(timer); timer = setTimeout(() => void tick(), 30_000 - (Date.now() - lastAttempt)); }
    };
    void tick();
    document.addEventListener('visibilitychange', visibility); window.addEventListener('focus', visibility);
    return () => {
      stopped = true; clearTimeout(timer); controller?.abort(); askController.current?.abort(); askController.current = null;
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', visibility);
    };
    // A complete wire identity scopes the lease and all its evidence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    if (!expanded || !value) return;
    const controller = new AbortController(); setHistoryFailed(false);
    void readCustodianHistory(projectId, workspaceContext, controller.signal).then((next) => {
      if (!controller.signal.aborted && currentScope.current === scope) setHistory(next);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && !(error instanceof ProjectCustodiansUnavailableError)) setHistoryFailed(true);
    });
    return () => controller.abort();
    // Refresh the small diary after a query or index revision, not each status poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, expanded, value?.ledger.snapshotRevision, historyVersion]);

  async function ask() {
    if (!question.trim() || asking || disabled || !value || (domain === 'images' && !value.ledger.imageConsent)) return;
    const controller = new AbortController(); askController.current = controller; setAsking(true); setAskFailed(false); setAnswer(null);
    try {
      const next = await askProjectCustodian(projectId, { domain, question, limit: 6 }, workspaceContext, controller.signal);
      if (!controller.signal.aborted && currentScope.current === scope) { setAnswer(next); setHistoryVersion((version) => version + 1); }
    } catch { if (!controller.signal.aborted && currentScope.current === scope) setAskFailed(true); }
    finally { if (askController.current === controller) { askController.current = null; setAsking(false); } }
  }

  if (!value) return refreshFailed ? <section className={styles.root} aria-label={t('custodian.title')} data-testid="project-custodian-status">
    <p className={styles.status} role="status">{t('custodian.loadFailed')}</p>
  </section> : null;
  const { ledger, indexing } = value;
  const clean = (text: string) => custodianDisplayText(text, ledger, t('custodian.privateDetail'));
  const phase = indexing?.phase ?? 'idle';
  const phaseKey = phase === 'text' ? 'custodian.textIndexing' : phase === 'images' ? 'custodian.imagesIndexing' : `custodian.${phase}` as const;
  const textState = ['queued', 'quick', 'full', 'complete', 'partial', 'failed'].includes(ledger.textStatus)
    ? t(`documentResearch.${ledger.textStatus}` as 'documentResearch.complete') : t('custodian.notStarted');
  const imageState = ledger.imagesStatus === 'indexed' ? t('custodian.indexed') : ledger.imagesStatus === 'indexing'
    ? t('custodian.imagesIndexing') : ledger.imagesStatus === 'partial' ? t('custodian.partial') : t('custodian.notStarted');
  const timestamp = (at: string) => {
    const date = new Date(at);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date) : '';
  };
  return <section className={styles.root} aria-label={t('custodian.title')} data-testid="project-custodian-status">
    <div className={styles.header}>
      <Button variant="ghost" aria-expanded={expanded} aria-controls={`${id}-details`} onClick={() => setExpanded((open) => !open)}>{t('custodian.title')}</Button>
      <span className={styles.status} role="status">{t(phaseKey)}{indexing?.queuedChanges.length ? ` · ${t('custodian.pending', { count: indexing.queuedChanges.length })}` : ''}</span>
    </div>
    <div id={`${id}-details`} className={styles.details} hidden={!expanded}>
      <p>{t('custodian.intro')}</p>
      <p className={styles.muted}>{t('custodian.domainState', { domain: t('custodian.text'), state: textState })}<br />{t('custodian.domainState', { domain: t('custodian.images'), state: imageState })}</p>
      {refreshFailed ? <p className={styles.muted}>{t('custodian.refreshFailed')}</p> : null}
      {!ledger.imageConsent ? <p>{t('custodian.imageConsent')}</p> : null}
      <h3>{t('custodian.coverage')}</h3>
      {ledger.sources.length ? <ol className={styles.sources}>{ledger.sources.map((source) => <li key={source.sourceId}>
        <strong>{clean(source.title)}</strong>
        <span>{t('custodian.sourceCoverage', { text: source.textAnalyzedPages.length, visual: source.visualIndexedPages.length, total: source.pagesTotal })}</span>
        {source.status !== 'current' ? <span>{t(`custodian.${source.status}`)}</span> : null}
      </li>)}</ol> : <p>{t('custodian.noSources')}</p>}
      <p className={styles.muted}>{t('custodian.coverageLimit')}</p>
      {ledger.gaps.length ? <><h3>{t('custodian.gaps')}</h3><ul className={styles.gaps}>{ledger.gaps.slice(0, 10).map((gap, index) => <li key={index}>{clean(gap)}</li>)}</ul></> : null}
      <h3>{t('custodian.history')}</h3>
      {historyFailed ? <p>{t('custodian.historyFailed')}</p> : history?.events.length ? <ol className={styles.diary}>{[...history.events].reverse().slice(0, 10).map((event) => <li key={event.seq}>
        <time dateTime={event.at}>{timestamp(event.at)}</time><span>{clean(event.summary)}</span>
      </li>)}</ol> : <p className={styles.muted}>{t('custodian.noHistory')}</p>}
      <h3>{t('custodian.ask')}</h3>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void ask(); }}>
        <div className={styles.controls}>
          <label htmlFor={`${id}-domain`}>{t('custodian.ask')}</label>
          <select id={`${id}-domain`} value={domain} disabled={asking || disabled} onChange={(event) => { setDomain(event.target.value as CustodianDomain); setAnswer(null); }}>
            <option value="text">{t('custodian.text')}</option><option value="images" disabled={!ledger.imageConsent}>{t('custodian.images')}</option>
          </select>
        </div>
        <label htmlFor={`${id}-question`}>{t('custodian.question')}</label>
        <textarea id={`${id}-question`} rows={2} maxLength={12_000} value={question} disabled={asking || disabled} placeholder={t('custodian.questionHint')} onChange={(event) => setQuestion(event.target.value)} />
        <Button variant="ghost" type="submit" disabled={asking || disabled || !question.trim() || (domain === 'images' && !ledger.imageConsent)}>{t(asking ? 'custodian.asking' : 'custodian.send')}</Button>
      </form>
      {askFailed ? <p role="alert">{t('custodian.askFailed')}</p> : null}
      {answer ? <div className={styles.answer} aria-live="polite">
        <p>{clean(answer.answer)}</p>
        <ul className={styles.citations}>{answer.citations.map((citation, index) => <li key={index}>{citation.page ? t('custodian.citation', { title: clean(citation.title), page: citation.page }) : clean(citation.title)}</li>)}</ul>
        {answer.assetIds.length ? <Button variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PROJECT_GALLERY_EVENT, { detail: { projectId } }))}>{t('custodian.openGallery')}</Button> : null}
        {answer.gaps.length ? <><h3>{t('custodian.gaps')}</h3><ul className={styles.gaps}>{answer.gaps.slice(0, 10).map((gap, index) => <li key={index}>{clean(gap)}</li>)}</ul></> : null}
      </div> : null}
    </div>
  </section>;
}
