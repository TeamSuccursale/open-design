import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, Select } from '@open-design/components';
import type { ProjectHistoryChange, ProjectHistoryEntry, ProjectHistoryResponse, ProjectHistoryRestoreResponse, ProjectHistoryVersionResponse, ProjectHistoryCompareResponse, WorkspaceCollabContext } from '@open-design/contracts';
import { compareProjectHistory, createProjectHistoryCheckpoint, ProjectHistoryError, readProjectHistory, readProjectHistoryVersion, restoreProjectHistory, reviewProjectOrganization } from '../../providers/project-history';
import { Icon } from '../Icon';
import { useHistoryCopy } from './copy';
import styles from './ProjectHistoryPanel.module.css';

export interface ProjectHistoryPanelProps {
  projectId: string; workspaceContext?: WorkspaceCollabContext | null; onClose: () => void;
  onRestored?: (result: ProjectHistoryRestoreResponse) => void;
}
const reasons = { save: 'reasonSave', initial: 'reasonInitial', work: 'reasonWork', idle: 'reasonIdle', manual: 'reasonManual', 'before-restore': 'reasonSafety', restore: 'reasonRestore' } as const;
const byteSize = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
const TIMELINE_PAGE_SIZE = 80;
type Detail = { key: string; version: ProjectHistoryVersionResponse; comparison: ProjectHistoryCompareResponse };

/** Every restore is reviewed against the exact current revision shown by this panel. */
export function ProjectHistoryPanel({ projectId, workspaceContext, onClose, onRestored }: ProjectHistoryPanelProps) {
  const { t, locale } = useHistoryCopy(), contextKey = JSON.stringify(workspaceContext ?? null), scope = `${projectId}:${contextKey}`;
  const root = useRef<HTMLDivElement>(null), timeline = useRef<HTMLElement>(null), close = useRef(onClose), mounted = useRef(true), operation = useRef(false), olderRequest = useRef<AbortController | null>(null); close.current = onClose;
  const [loaded, setLoaded] = useState<{ scope: string; history: ProjectHistoryResponse } | null>(null), [reload, setReload] = useState(0), [detailReload, setDetailReload] = useState(0);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSaves, setShowSaves] = useState(false), [visibleStart, setVisibleStart] = useState(0), [olderLoading, setOlderLoading] = useState(false), [olderError, setOlderError] = useState('');
  const [compareToId, setCompareToId] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null), [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState('');
  const [filePath, setFilePath] = useState(''), [selectedPaths, setSelectedPaths] = useState<string[]>([]), [confirm, setConfirm] = useState<'all' | string[] | null>(null);
  const [pending, setPending] = useState<'checkpoint' | 'restore' | 'organization' | null>(null), [actionError, setActionError] = useState(''), [notice, setNotice] = useState(''), [conflict, setConflict] = useState(false);
  const [restored, setRestored] = useState<ProjectHistoryRestoreResponse | null>(null);
  useEffect(() => { if (timeline.current) timeline.current.scrollTop = 0; }, [visibleStart, showSaves]);
  const history = loaded?.scope === scope ? loaded.history : null;
  const retained = useRef({ loaded, selectedId, compareToId }); retained.current = { loaded, selectedId, compareToId };
  const entries = useMemo(() => [...(history?.entries ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [history]);
  const saves = entries.filter((entry) => entry.kind === 'save'), visible = entries.filter((entry) => showSaves || entry.kind === 'commit');
  const selected = entries.find((entry) => entry.id === selectedId), detailKey = `${scope}:${selectedId}:${compareToId}:${history?.status.revision ?? ''}`;
  const current = detail?.key === detailKey ? detail : null, changes = current?.comparison.changes ?? [], file = changes.find((change) => change.path === filePath) ?? changes[0];
  const canWrite = !workspaceContext || workspaceContext.permissions.canWriteSyncedFiles;
  const canRestore = canWrite && !compareToId && !pending && !loading && !loadError && !detailLoading && !detailError && !conflict && Boolean(current && history?.status.state === 'ready' && history.status.revision && changes.length);
  function errorText(error: unknown, fallback: 'errorLoad' | 'errorDetail' | 'errorAction') {
    return t(error instanceof ProjectHistoryError && error.code === 'conflict' ? 'conflict' : error instanceof ProjectHistoryError && error.code === 'agent-running' ? 'agentRunning' : error instanceof ProjectHistoryError && error.code === 'background-running' ? 'backgroundRunning' : error instanceof ProjectHistoryError && error.code === 'unavailable' ? 'unavailable' : fallback);
  }
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLButtonElement>('button')?.focus();
    function keys(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? [])].filter((element) => !element.closest('details:not([open])') || element.tagName === 'SUMMARY' && element.parentElement === element.closest('details:not([open])'));
      const first = controls[0], last = controls.at(-1);
      if (!root.current?.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', keys, true);
    return () => { mounted.current = false; olderRequest.current?.abort(); document.removeEventListener('keydown', keys, true); previous?.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setLoadError(''); setVisibleStart(0);
    olderRequest.current?.abort(); olderRequest.current = null; setOlderLoading(false); setOlderError('');
    void readProjectHistory(projectId, workspaceContext, controller.signal).then((history) => {
      if (controller.signal.aborted) return;
      const previous = retained.current, selectedIds = [previous.selectedId, previous.compareToId];
      // Keep the two versions being inspected even if a refreshed head page no
      // longer contains them. Older pagination itself starts from the new head.
      const keep = previous.loaded?.scope === scope ? previous.loaded.history.entries.filter((entry) => selectedIds.includes(entry.id) && !history.entries.some((latest) => latest.id === entry.id)) : [];
      const merged = { ...history, entries: [...history.entries, ...keep] };
      setLoaded({ scope, history: merged }); setConflict(false);
      setSelectedId((previous) => merged.entries.some((entry) => entry.id === previous) ? previous : [...merged.entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find((entry) => entry.kind === 'commit')?.id ?? null);
    }).catch((error) => { if (!controller.signal.aborted) setLoadError(errorText(error, 'errorLoad')); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  // The serialized context describes the authority of this history read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, contextKey, scope, reload, t]);
  useEffect(() => {
    setConfirm(null); setSelectedPaths([]); setDetailError(''); setActionError('');
    if (!selected) { setDetailLoading(false); return; }
    const controller = new AbortController(); setDetailLoading(true);
    void Promise.all([readProjectHistoryVersion(projectId, selected.id, workspaceContext, controller.signal), compareProjectHistory(projectId, { fromId: selected.id, ...(compareToId ? { toId: compareToId } : {}) }, workspaceContext, controller.signal)]).then(([version, comparison]) => {
      if (controller.signal.aborted) return;
      setDetail({ key: detailKey, version, comparison }); setFilePath(comparison.changes[0]?.path ?? '');
    }).catch((error) => { if (!controller.signal.aborted) setDetailError(errorText(error, 'errorDetail')); }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  // Selected identity plus current revision fence the complete comparison.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailKey, Boolean(selected), detailReload, t]);
  function refresh() { if (!pending) { setReload((value) => value + 1); setDetailReload((value) => value + 1); } }
  useEffect(() => {
    if (!confirm) return;
    const preview = root.current?.querySelector<HTMLElement>('[data-history-restore-confirmation]');
    preview?.scrollIntoView?.({ block: 'nearest' });
    preview?.focus({ preventScroll: true });
  }, [confirm]);
  async function loadOlder() {
    if (olderRequest.current || !history?.nextCursor || pending || loading) return;
    const controller = new AbortController(), cursor = history.nextCursor;
    olderRequest.current = controller; setOlderLoading(true); setOlderError('');
    try {
      const page = await readProjectHistory(projectId, workspaceContext, controller.signal, { before: cursor, limit: 200 });
      if (controller.signal.aborted || !mounted.current) return;
      setLoaded((previous) => {
        if (previous?.scope !== scope || previous.history.nextCursor !== cursor) return previous;
        const seen = new Set(previous.history.entries.map((entry) => entry.id)), entries = [...previous.history.entries];
        for (const entry of page.entries) if (!seen.has(entry.id)) { seen.add(entry.id); entries.push(entry); }
        return { ...previous, history: { ...previous.history, entries, nextCursor: page.nextCursor ?? null } };
      });
      const incomingVisible = page.entries.some((entry) => !history.entries.some((existing) => existing.id === entry.id) && (showSaves || entry.kind === 'commit'));
      if (incomingVisible) setVisibleStart(Math.floor(visible.length / TIMELINE_PAGE_SIZE) * TIMELINE_PAGE_SIZE);
      if (!selectedId) setSelectedId(page.entries.find((entry) => entry.kind === 'commit')?.id ?? null);
    } catch { if (!controller.signal.aborted && mounted.current) setOlderError(t('olderError')); }
    finally {
      if (olderRequest.current === controller) { olderRequest.current = null; if (mounted.current) setOlderLoading(false); }
    }
  }
  async function checkpoint() {
    if (operation.current || !canWrite) return;
    operation.current = true; setPending('checkpoint'); setActionError(''); setNotice('');
    try {
      const result = await createProjectHistoryCheckpoint(projectId, {}, workspaceContext);
      if (!mounted.current) return;
      setNotice(t(result.entry ? 'checkpointDone' : 'checkpointEmpty')); if (result.entry) setSelectedId(result.entry.id); setReload((value) => value + 1);
    } catch (error) { if (mounted.current) setActionError(errorText(error, 'errorAction')); }
    finally { operation.current = false; if (mounted.current) setPending(null); }
  }
  async function restore() {
    if (operation.current || !canRestore || !selected || !confirm || !history?.status.revision || Array.isArray(confirm) && !confirm.length) return;
    operation.current = true; setPending('restore'); setActionError(''); setNotice('');
    let completed: ProjectHistoryRestoreResponse | null = null;
    try {
      const result = await restoreProjectHistory(projectId, { entryId: selected.id, ...(confirm === 'all' ? {} : { paths: confirm }), baseRevision: history.status.revision }, workspaceContext);
      if (!mounted.current) return;
      setRestored(result); setNotice(t('restored', { count: result.restoredPaths.length })); setConfirm(null); setShowSaves(true); setSelectedId(result.entry.id); setCompareToId(''); setReload((value) => value + 1); completed = result;
    } catch (error) {
      if (!mounted.current) return;
      setActionError(errorText(error, 'errorAction')); if (error instanceof ProjectHistoryError && error.code === 'conflict') setConflict(true);
    } finally { operation.current = false; if (mounted.current) setPending(null); }
    if (completed) onRestored?.(completed);
  }
  async function organization(action: 'review' | 'acknowledge') {
    if (operation.current || !canWrite) return;
    operation.current = true; setPending('organization'); setActionError('');
    try {
      const result = await reviewProjectOrganization(projectId, { action, ...(action === 'acknowledge' && history?.status.organizationReview ? { reviewId: history.status.organizationReview.id } : {}) }, workspaceContext);
      if (mounted.current) setLoaded((value) => value?.scope === scope ? { ...value, history: { ...value.history, status: { ...value.history.status, organizationReview: result.review } } } : value);
    } catch (error) { if (mounted.current) setActionError(errorText(error, 'errorAction')); }
    finally { operation.current = false; if (mounted.current) setPending(null); }
  }
  const review = history?.status.organizationReview;
  const date = (entry: ProjectHistoryEntry) => new Date(entry.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const restoreChanges = confirm === 'all' ? changes : changes.filter((change) => confirm?.includes(change.path));
  return <Dialog className={styles.panel} backdropClassName={styles.backdrop} ariaLabel={t('title')} onClose={onClose}>
    <div className={styles.inner} ref={root}>
      <header className={styles.header}><div><h2>{t('title')}</h2><p>{t('intro')}</p></div><Button variant="ghost" aria-label={t('close')} onClick={onClose}><Icon name="close" size={18} /></Button></header>
      <div className={styles.statusBar}><span><Icon name="lock" size={13} />{t('private')}</span>{!canWrite && <strong>{t('readOnly')}</strong>}<Button variant="ghost" disabled={Boolean(pending) || loading} onClick={refresh}><Icon name="refresh" size={14} />{t('refresh')}</Button><Button variant="secondary" disabled={!canWrite || Boolean(pending) || loading || history?.status.state !== 'ready'} onClick={() => void checkpoint()}>{t(pending === 'checkpoint' ? 'checkpointPending' : 'checkpoint')}</Button></div>
      <details className={styles.cadence}><summary>{t('cadence')}</summary><p>{t('organizationCadence')}</p>{history && <><p>{t('work')}: {t('minutes', { value: Math.floor(history.status.activeWorkMs / 60_000) })} · {t(history.status.dirty ? 'waitingCheckpoint' : 'upToDate')}</p><details><summary>{t('exclusions')}</summary><p>{t('exclusionsHint')}</p><p>{history.status.excluded.join(' · ')}</p></details></>}</details>
      {loading && <p className={styles.message} role="status">{t('loading')}</p>}
      {loadError && <div className={styles.message} role="alert"><p>{loadError}</p><Button variant="secondary" onClick={refresh}>{t('retry')}</Button></div>}
      {history?.status.state === 'initializing' && <p className={styles.message} role="status">{t('initializing')}</p>}
      {history?.status.state === 'error' && <p className={styles.message} role="alert">{t('statusError')}</p>}
      {(notice || actionError) && <div className={styles.message} role={actionError ? 'alert' : 'status'}><p>{actionError || notice}</p>{actionError && <Button variant="secondary" disabled={Boolean(pending)} onClick={refresh}>{t('refresh')}</Button>}{restored && !actionError && <Button variant="ghost" onClick={() => { setShowSaves(true); setSelectedId(restored.safetyEntryId); }}>{t('viewSafety')}</Button>}</div>}
      <div className={styles.content}>
        <nav className={styles.timeline} ref={timeline} aria-label={t('listTitle')}><div className={styles.timelineHeading}><h3>{t('listTitle')}</h3>{saves.length > 0 && <Button variant="ghost" aria-pressed={showSaves} disabled={olderLoading} onClick={() => { setShowSaves((value) => !value); setVisibleStart(0); }}>{showSaves ? t('hideSaves') : t('saves', { count: saves.length })}</Button>}</div>
          {!loading && !visible.length && <p>{t(entries.length ? 'emptyRange' : 'empty')}</p>}
          {visibleStart > 0 && <Button variant="ghost" disabled={olderLoading} onClick={() => setVisibleStart((value) => Math.max(0, value - TIMELINE_PAGE_SIZE))}>{t('newer')}</Button>}
          <ol>{visible.slice(visibleStart, visibleStart + TIMELINE_PAGE_SIZE).map((entry) => <li key={entry.id}><button type="button" className={styles.version} aria-current={selectedId === entry.id ? 'true' : undefined} disabled={Boolean(pending)} onClick={() => { setCompareToId(''); setSelectedId(entry.id); }}><span className={styles.versionType} data-kind={entry.kind}><Icon name={entry.kind === 'save' ? 'file' : 'history'} size={13} />{t(entry.kind === 'save' ? 'saveVersion' : 'recoveryPoint')}</span><strong>{entry.title || t(reasons[entry.reason])}</strong><time dateTime={entry.createdAt}>{date(entry)}</time><small>{t(reasons[entry.reason])} · {t('files', { count: entry.fileCount })}</small></button></li>)}</ol>
          {visible.length > visibleStart + TIMELINE_PAGE_SIZE && <Button variant="ghost" disabled={olderLoading} onClick={() => setVisibleStart((value) => value + TIMELINE_PAGE_SIZE)}>{t('more')}</Button>}
          {olderError && <p role="alert">{olderError}</p>}
          {history?.nextCursor && visible.length <= visibleStart + TIMELINE_PAGE_SIZE && <Button variant="secondary" disabled={olderLoading || Boolean(pending) || loading} onClick={() => void loadOlder()}>{t(olderLoading ? 'loadingOlder' : 'loadOlder')}</Button>}
        </nav>
        <section className={styles.detail} aria-label={t('selected')}>
          {!selected && <div className={styles.empty}><Icon name="history" size={32} /><p>{t('select')}</p></div>}
          {selected && <><header className={styles.detailHeading}><h3>{selected.title || t(reasons[selected.reason])}</h3><p>{date(selected)} · {t('files', { count: selected.fileCount })} · {byteSize(selected.totalBytes)}</p>{selected.summary && <p>{selected.summary}</p>}</header>
            <label className={styles.compareTarget}>{t('compareTarget')}<Select aria-label={t('compareTarget')} disabled={Boolean(pending)} value={compareToId} onChange={(event) => setCompareToId(event.target.value)}><option value="">{t('currentProject')}</option>{entries.filter((entry) => entry.id !== selected.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.title || t(reasons[entry.reason])} · {date(entry)}</option>)}</Select></label>
            {compareToId && <Button variant="ghost" onClick={() => setCompareToId('')}>{t('compareCurrentToRestore')}</Button>}
            {detailLoading && <p role="status">{t('compareLoading')}</p>}
            {detailError && <div role="alert"><p>{detailError}</p><Button variant="secondary" onClick={() => setDetailReload((value) => value + 1)}>{t('retry')}</Button></div>}
            {current && <><h4>{t(compareToId ? 'historicalComparison' : 'compareTitle')}</h4><p className={styles.comparisonCount}>{t('changeCount', { count: changes.length })}</p>
              {!changes.length && <p>{t(compareToId ? 'historicalMatch' : 'comparisonEmpty')}</p>}
              {changes.length > 0 && <><ul className={styles.changeList}>{changes.map((change) => <li key={change.path} data-selected={file?.path === change.path || undefined}><label><input type="checkbox" aria-label={t('chooseFile', { path: change.path })} checked={selectedPaths.includes(change.path)} disabled={!canRestore} onChange={(event) => setSelectedPaths((paths) => event.target.checked ? [...paths, change.path] : paths.filter((path) => path !== change.path))} /></label><button type="button" aria-label={t('view', { path: change.path })} onClick={() => setFilePath(change.path)}><strong>{change.path}</strong><span>{t(compareToId ? change.kind === 'modified' ? 'differentModified' : change.kind === 'added' ? 'differentAdded' : 'differentDeleted' : change.kind)} · {byteSize(change.beforeSize)} → {byteSize(change.afterSize)}</span></button></li>)}</ul>
                {file && <FileComparison change={file} afterLabel={compareToId ? entries.find((entry) => entry.id === compareToId)?.title : undefined} />}
                <div className={styles.restoreActions}><Button variant="secondary" disabled={!canRestore || !selectedPaths.length} onClick={() => { setActionError(''); setConfirm([...selectedPaths]); }}>{t('restoreSelected', { count: selectedPaths.length })}</Button><Button variant="secondary" disabled={!canRestore} onClick={() => { setActionError(''); setConfirm('all'); }}>{t('restoreAll')}</Button></div>
              </>}
              <details className={styles.versionFiles}><summary>{t('versionFiles')} · {current.version.files.length}</summary><ul>{current.version.files.map((file) => <li key={file.path}><span>{file.path}</span><small>{byteSize(file.size)}</small></li>)}</ul></details>
            </>}
          </>}
          {confirm && <section className={styles.confirmation} data-history-restore-confirmation tabIndex={-1} aria-label={t('restoreTitle')}><h4>{t('restoreTitle')}</h4><p>{t(confirm === 'all' ? 'restoreAllHint' : 'restoreSomeHint')}</p><p>{t('restoreCount', { count: restoreChanges.length })}</p><ul>{restoreChanges.map((change) => <li key={change.path}><strong>{change.path}</strong>{change.kind === 'added' && <span>{t('removeHint')}</span>}</li>)}</ul><p>{t('safetyHint')}</p><div><Button variant="ghost" disabled={pending === 'restore'} onClick={() => setConfirm(null)}>{t('cancel')}</Button><Button variant="primary" disabled={!canRestore} onClick={() => void restore()}>{t(pending === 'restore' ? 'restoring' : 'confirmRestore')}</Button></div></section>}
          <details className={styles.organization}><summary>{t('organization')}{review && <span>{t(review.status === 'acknowledged' ? 'acknowledged' : 'candidates')}</span>}</summary><p>{t('organizationCadence')}</p><p>{t('noMoves')}</p><Button variant="secondary" disabled={!canWrite || Boolean(pending)} onClick={() => void organization('review')}>{t(pending === 'organization' ? 'reviewing' : 'review')}</Button>
            {!review && <p>{t('noReview')}</p>}
            {review && <><p>{review.summary}</p>{!review.candidates.length && <p>{t('noCandidates')}</p>}<ul className={styles.candidates}>{review.candidates.map((candidate) => <li key={candidate.path}><strong>{candidate.path}</strong><span>{t(candidate.suggestedAction === 'keep' ? 'keep' : candidate.suggestedAction === 'review' ? 'reviewCandidate' : 'archiveCandidate')}: {candidate.reason}</span>{candidate.referencedBy.length > 0 && <small>{t('references')}: {candidate.referencedBy.join(', ')}</small>}</li>)}</ul>{review.protectedPaths.length > 0 && <details><summary>{t('protected')} · {review.protectedPaths.length}</summary><ul>{review.protectedPaths.map((path) => <li key={path}>{path}</li>)}</ul></details>}{review.limitations.length > 0 && <><h4>{t('limitations')}</h4><ul>{review.limitations.map((limit, index) => <li key={index}>{limit}</li>)}</ul></>}{review.status !== 'acknowledged' && <Button variant="ghost" disabled={!canWrite || Boolean(pending)} onClick={() => void organization('acknowledge')}>{t('acknowledge')}</Button>}</>}
          </details>
        </section>
      </div>
    </div>
  </Dialog>;
}

function FileComparison({ change, afterLabel }: { change: ProjectHistoryChange; afterLabel?: string }) {
  const { t } = useHistoryCopy(), maximum = 100_000;
  return <section className={styles.fileComparison} aria-label={change.path}><h4>{change.path}</h4>
    {change.binary ? <><p>{t('binary')}</p><div className={styles.binaryMetadata}><div><strong>{t('textBefore')}</strong><span>{t('bytes', { value: change.beforeSize })}</span></div><div><strong>{afterLabel || t('textAfter')}</strong><span>{t('bytes', { value: change.afterSize })}</span></div></div><p>{t('binaryHint')}</p></> : <div className={styles.textComparison}>{(['before', 'after'] as const).map((side) => {
      const value = side === 'before' ? change.beforeText : change.afterText, absent = side === 'before' ? change.kind === 'added' : change.kind === 'deleted';
      return <div key={side}><h5>{side === 'after' && afterLabel || t(side === 'before' ? 'textBefore' : 'textAfter')}</h5><pre tabIndex={0}>{absent ? t('noFile') : value?.slice(0, maximum) || t('emptyText')}</pre></div>;
    })}</div>}
    {(change.truncated || (change.beforeText?.length ?? 0) > maximum || (change.afterText?.length ?? 0) > maximum) && <p>{t('truncated')}</p>}
  </section>;
}
