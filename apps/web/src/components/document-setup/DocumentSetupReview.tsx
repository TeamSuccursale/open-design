import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type { DocumentSetup, WorkspaceCollabContext } from '@open-design/contracts';
import { useT } from '../../i18n';
import { DOCUMENT_PREPARATION_RESUME_EVENT, documentSetupRequest } from '../../providers/document-setup';
import { hasPendingHeaderFooter } from '../../runtime/document-preparation-continuation';
import { fetchIntakeSettings, fetchProjectIntake, PROJECT_INTAKE_RETRY_EVENT, PROJECT_INTAKE_UPDATED_EVENT } from '../../providers/project-intake';
import { Icon } from '../Icon';
import { ProjectLogoSources } from '../header-footer/ProjectLogoSources';
import styles from './DocumentSetup.module.css';

interface Props {
  projectId: string; workspaceContext?: WorkspaceCollabContext | null; expectedWorkingDirectory?: string;
  enabled: boolean; canStart: boolean; onExit: () => void;
  hasActiveQuestion?: boolean;
  onPrepareChat: (setup: DocumentSetup) => Promise<boolean>;
  onStart: (setup: DocumentSetup) => Promise<boolean | 'header-footer'>;
  onPendingChange?: (pending: boolean) => void;
}
const loads = new Map<string, Promise<DocumentSetup | null>>();

/** The only setup control is Continue. All brief questions belong to the agent conversation. */
export function DocumentSetupReview({ projectId, workspaceContext, expectedWorkingDirectory, enabled, canStart, hasActiveQuestion = false, onExit, onPrepareChat, onStart, onPendingChange }: Props) {
  const t = useT();
  const [setup, setSetup] = useState<DocumentSetup | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [prepareImages, setPrepareImages] = useState(true), [attempt, setAttempt] = useState(0);
  const latest = useRef<DocumentSetup | null>(null), intakeStarted = useRef(false), intakeRunning = useRef(false), dispatching = useRef(false);
  const callbacks = useRef({ onPrepareChat, onStart, onPendingChange, canStart });
  callbacks.current = { onPrepareChat, onStart, onPendingChange, canStart };
  const contextKey = JSON.stringify(workspaceContext ?? null);
  const apply = (value: DocumentSetup | null) => {
    const normalize = (path: string) => path.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
    if (value && expectedWorkingDirectory && normalize(value.workingDirectory) !== normalize(expectedWorkingDirectory)) throw new Error(t('documentStart.destinationMismatch'));
    latest.current = value; setSetup(value);
    callbacks.current.onPendingChange?.(Boolean(value && value.status !== 'confirmed'));
  };
  const startIntake = useCallback(async (value: DocumentSetup, retry = false) => {
    if (!value.intent.imageIntakeConsent || intakeRunning.current || (intakeStarted.current && !retry)) return;
    intakeRunning.current = true; intakeStarted.current = true;
    try {
      const settings = await fetchIntakeSettings(projectId, workspaceContext);
      const sourceDirs = [...new Set([...settings.sourceDirs, ...value.intent.contextRoots])];
      if (JSON.stringify(sourceDirs) !== JSON.stringify(settings.sourceDirs)) await fetchIntakeSettings(projectId, workspaceContext, { version: 1, sourceDirs, outputDir: settings.outputDir });
      await fetchProjectIntake(projectId, workspaceContext, retry ? { retry: true } : {});
    } catch (failure) {
      window.dispatchEvent(new CustomEvent(PROJECT_INTAKE_UPDATED_EVENT, { detail: { projectId, launchError: failure instanceof Error ? failure.message : String(failure) } }));
    } finally { intakeRunning.current = false; }
  }, [projectId, workspaceContext]);

  async function save(intent: Partial<DocumentSetup['intent']>) {
    const result = await documentSetupRequest(projectId, workspaceContext, 'intent', intent);
    if (!result) throw new Error(t('documentStart.loadFailed'));
    apply(result); return result;
  }
  async function dispatch(value: DocumentSetup) {
    if (dispatching.current || !callbacks.current.canStart) return;
    dispatching.current = true; setBusy(true); setError('');
    try {
      let current = value;
      let marker = current.intent.preparationConversation;
      if (!marker) {
        marker = { requestId: crypto.randomUUID(), dispatched: false, blockoutRequestId: crypto.randomUUID(), headerFooterRequestId: crypto.randomUUID() };
        current = await save({ preparationConversation: marker });
      }
      if (current.status === 'confirmed') {
        if (!marker.dispatched || marker.blockoutDispatched) return;
        if (marker.headerFooterDispatched && hasPendingHeaderFooter(current)) return;
        if (!marker.blockoutRequestId || !marker.headerFooterRequestId) {
          marker = { ...marker, blockoutRequestId: marker.blockoutRequestId ?? crypto.randomUUID(), headerFooterRequestId: marker.headerFooterRequestId ?? crypto.randomUUID() };
          current = await save({ preparationConversation: marker });
        }
        const result = await callbacks.current.onStart(current);
        if (!result) throw new Error(t('documentStart.sendFailed'));
        await save({ preparationConversation: result === 'header-footer' ? { ...marker, headerFooterDispatched: true } : { ...marker, blockoutDispatched: true } });
      } else if (!marker.dispatched || (marker.resumeRequestId && !marker.resumeDispatched)) {
        window.dispatchEvent(new CustomEvent('melillodesign:document-preparation-started', { detail: { projectId } }));
        if (!await callbacks.current.onPrepareChat(current)) throw new Error(t('documentChat.agentStartFailed'));
        await save({ preparationConversation: { ...marker, dispatched: true, ...(marker.resumeRequestId ? { resumeDispatched: true } : {}) } });
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('documentChat.agentStartFailed')); }
    finally { dispatching.current = false; setBusy(false); }
  }

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    setLoading(true); setError('');
    const key = `${projectId}:${contextKey}`;
    let request = loads.get(key);
    if (!request) {
      request = documentSetupRequest(projectId, workspaceContext).then(async (value) => {
        const normalize = (path: string) => path.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
        if (value && expectedWorkingDirectory && normalize(value.workingDirectory) !== normalize(expectedWorkingDirectory)) throw new Error(t('documentStart.destinationMismatch'));
        if (value) void startIntake(value);
        return value?.scan.status === 'not-run' ? documentSetupRequest(projectId, workspaceContext, 'scan') : value;
      });
      loads.set(key, request);
      void request.finally(() => { if (loads.get(key) === request) loads.delete(key); }).catch(() => {});
    }
    void request.then((value) => { if (!disposed) apply(value); })
      .catch((failure) => { if (!disposed) setError(failure instanceof Error ? failure.message : t('documentStart.loadFailed')); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  // The serialized workspace identity prevents rediscovery on parent renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, projectId, contextKey, expectedWorkingDirectory, attempt]);

  useEffect(() => {
    if (!setup || loading || error || !canStart) return;
    if (setup.status === 'confirmed' && !setup.intent.preparationConversation) return;
    if (setup.intent.imageIntakeDecision || setup.intent.imageIntakeConsent) void dispatch(setup);
  // Saved markers, not component mount count, govern dispatch and recovery.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup?.updatedAt, loading, canStart, error]);

  const previousReady = useRef(canStart);
  useEffect(() => {
    const wasReady = previousReady.current; previousReady.current = canStart;
    if (wasReady || !canStart || !latest.current || loading) return;
    let disposed = false;
    void documentSetupRequest(projectId, workspaceContext).then((value) => { if (!disposed) apply(value); })
      .catch((failure) => { if (!disposed) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { disposed = true; };
  // Read agent-authored confirmations after its preparation turn settles.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canStart]);
  useEffect(() => {
    const changed = (event: Event) => { if ((event as CustomEvent<{ projectId: string }>).detail?.projectId === projectId) setAttempt((value) => value + 1); };
    const retry = (event: Event) => { if ((event as CustomEvent<{ projectId: string }>).detail?.projectId === projectId && latest.current) void startIntake(latest.current, true); };
    window.addEventListener('melillodesign:document-context-updated', changed);
    window.addEventListener(PROJECT_INTAKE_RETRY_EVENT, retry);
    return () => { window.removeEventListener('melillodesign:document-context-updated', changed); window.removeEventListener(PROJECT_INTAKE_RETRY_EVENT, retry); };
  }, [projectId, startIntake]);

  async function resumePreparation() {
    if (busy || dispatching.current) return;
    setBusy(true); setError('');
    try {
      const current = await documentSetupRequest(projectId, workspaceContext);
      if (!current) throw new Error(t('documentStart.loadFailed'));
      apply(current);
      if (current.status !== 'confirmed') {
        const marker = current.intent.preparationConversation ?? { requestId: crypto.randomUUID(), dispatched: true };
        await save({ preparationConversation: { ...marker, resumeRequestId: marker.resumeRequestId && !marker.resumeDispatched ? marker.resumeRequestId : crypto.randomUUID(), resumeDispatched: false } });
      }
      // A confirmed brief needs no new consent. Its saved dispatch effect resumes
      // only the still-authorized step; an unconfirmed brief gets a new chat turn.
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('documentStart.loadFailed')); }
    finally { setBusy(false); }
  }
  const resumeRef = useRef(resumePreparation); resumeRef.current = resumePreparation;
  useEffect(() => {
    const resume = (event: Event) => { if ((event as CustomEvent<{ projectId: string }>).detail?.projectId === projectId) void resumeRef.current(); };
    window.addEventListener(DOCUMENT_PREPARATION_RESUME_EVENT, resume);
    return () => window.removeEventListener(DOCUMENT_PREPARATION_RESUME_EVENT, resume);
  }, [projectId]);

  async function retryPreparation() {
    if (busy || dispatching.current) return;
    setBusy(true); setError('');
    try {
      const current = await documentSetupRequest(projectId, workspaceContext);
      apply(current);
      if (!current) throw new Error(t('documentStart.loadFailed'));
      await dispatch(current);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('documentStart.loadFailed')); }
    finally { setBusy(false); }
  }

  async function proceed() {
    if (!setup || busy) return;
    setBusy(true); setError('');
    try {
      const value = await save({ imageIntakeConsent: prepareImages, imageIntakeDecision: prepareImages ? 'accepted' : 'declined',
        preparationConversation: setup.intent.preparationConversation ?? { requestId: crypto.randomUUID(), dispatched: false, blockoutRequestId: crypto.randomUUID() } });
      if (prepareImages) void startIntake(value);
      // dispatch is deferred to the saved-revision effect to avoid two model requests.
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('documentStart.loadFailed')); }
    finally { setBusy(false); }
  }
  if (!enabled || (!loading && !setup && !error)) return null;
  if (!loading && setup?.status === 'confirmed' && !setup.intent.preparationConversation) return null;
  const prepared = Boolean(setup && (setup.intent.imageIntakeDecision || setup.intent.imageIntakeConsent));
  if (!loading && prepared) {
    if (error) return <section className={styles.resumeAction} aria-label={t('documentChat.title')}><p role="alert" className={styles.error}>{error}</p><Button variant="secondary" disabled={busy || !canStart} onClick={() => void retryPreparation()}>{t('documentStart.retry')}</Button></section>;
    if (setup?.status === 'confirmed' || !setup?.intent.preparationConversation?.dispatched || !canStart || hasActiveQuestion) return null;
    return <div className={styles.resumeAction}><Button variant="ghost" disabled={busy} onClick={() => void resumePreparation()}>{t('documentChat.resumeBrief')}</Button></div>;
  }
  return <section aria-label={t('documentChat.title')} className={styles.conversation}>
    <h2>{t('documentChat.title')}</h2>
    {loading ? <p role="status">{t('documentChat.reading')}</p> : <>
      <p>{t('documentChat.conversationIntro')}</p>
      {setup?.scan.textDocuments?.length ? <><h3 className={styles.sourceHeading}>{t('documentChat.sourceFiles')}</h3><ul className={styles.sourceFiles} aria-label={t('documentChat.sourceFiles')}>
        {setup.scan.textDocuments.map((source) => <li key={source.sourcePath}><Icon name="file-text" size={17} /><span>{source.title}</span><small>{t('documentChat.extractedPages', { read: source.pagesRead, total: source.pagesTotal })}</small></li>)}
      </ul></> : null}
      <ProjectLogoSources projectId={projectId} context={workspaceContext} />
      <label className={styles.inlineChoice}><input type="checkbox" checked={prepareImages} disabled={busy} onChange={(event) => setPrepareImages(event.target.checked)} />{t('documentChat.prepareImages')}</label>
      <p className={styles.intakeNote}>{t('documentChat.prepareHint')}</p>
    </>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <footer className={styles.footer}><Button variant="ghost" disabled={busy} onClick={onExit}>{t('documentWizard.leaveReview')}</Button>
      {error ? <Button variant="primary" disabled={busy || !canStart} onClick={() => { setError(''); if (latest.current && prepared) void dispatch(latest.current); else setAttempt((value) => value + 1); }}>{t('documentStart.retry')}</Button>
        : <Button variant="primary" disabled={loading || busy || !canStart} onClick={() => void proceed()}>{busy ? t('common.loading') : t('documentChat.prepareContinue')}</Button>}
    </footer>
  </section>;
}
