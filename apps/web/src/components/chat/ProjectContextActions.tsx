import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type { DocumentProjectContext, WorkspaceCollabContext } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { workspaceIdentityCacheKey } from '../../collab/workspace-identity';
import { checkProjectContext, DOCUMENT_CONTEXT_UPDATED_EVENT, projectContextReferences, type DocumentContextUpdatedDetail } from '../../providers/project-context-actions';
import { Icon } from '../Icon';
import { ProjectReferenceModal, type ProjectReferenceSelection } from '../ProjectReferenceModal';
import styles from './ProjectContextActions.module.css';

interface Props { projectId: string; workspaceContext?: WorkspaceCollabContext | null; disabled?: boolean }
type RetryAction = 'load' | 'scan' | string[];
type FailureKey = 'documentContext.loadFailed' | 'documentContext.saveFailed' | 'documentContext.checkFailed' | 'documentContext.limit';

/** Saved project context is independent of chat drafts, agent runs and image-intake settings. */
export function ProjectContextActions({ projectId, workspaceContext, disabled = false }: Props) {
  const { t } = useI18n();
  const identity = workspaceIdentityCacheKey(workspaceContext);
  const [references, setReferences] = useState<DocumentProjectContext[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<'load' | 'save' | 'scan' | null>('load');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [failure, setFailure] = useState<{ key: FailureKey; retry?: RetryAction } | null>(null);
  const [status, setStatus] = useState<'documentContext.checked' | 'documentContext.saved' | null>(null);
  const active = useRef<AbortController | null>(null);

  const execute = useCallback(async (action: RetryAction) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setFailure(null); setStatus(null);
    setBusy(action === 'load' ? 'load' : action === 'scan' ? 'scan' : 'save');
    try {
      if (action === 'scan') {
        await checkProjectContext(projectId, workspaceContext, controller.signal);
        if (!controller.signal.aborted) setStatus('documentContext.checked');
      } else {
        const rows = await projectContextReferences(projectId, workspaceContext, action === 'load' ? undefined : action, controller.signal);
        if (!controller.signal.aborted) {
          setReferences(rows); setLoaded(true);
          if (action !== 'load') setStatus('documentContext.saved');
        }
      }
    } catch {
      if (!controller.signal.aborted) setFailure({ key: action === 'load' ? 'documentContext.loadFailed' : action === 'scan' ? 'documentContext.checkFailed' : 'documentContext.saveFailed', retry: action });
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(null);
      }
    }
    // Authority is keyed by the complete identity carried on the wire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, identity]);

  useEffect(() => {
    setReferences([]); setLoaded(false); setPickerOpen(false);
    void execute('load');
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<DocumentContextUpdatedDetail>).detail;
      if (detail?.projectId === projectId && detail.source === 'references' && !active.current) void execute('load');
    };
    window.addEventListener(DOCUMENT_CONTEXT_UPDATED_EVENT, refresh);
    return () => {
      active.current?.abort(); active.current = null;
      window.removeEventListener(DOCUMENT_CONTEXT_UPDATED_EVENT, refresh);
    };
  }, [projectId, execute]);

  function addReferences(items: ProjectReferenceSelection[]) {
    setPickerOpen(false);
    const projectIds = [...new Set([...references.map((row) => row.projectId), ...items.map((item) => item.project.id)])].filter((id) => id !== projectId);
    if (projectIds.length > 10) { setFailure({ key: 'documentContext.limit' }); return; }
    void execute(projectIds);
  }

  const unavailable = disabled || busy !== null;
  return <div className={styles.root} data-testid="project-context-actions" aria-busy={busy !== null}>
    <div className={styles.actions}>
      <Button variant="ghost" title={t('documentContext.rereadHint')} onClick={() => void execute('scan')} disabled={unavailable}>
        <Icon name="search" size={16} />{t(busy === 'scan' ? 'documentContext.checking' : 'documentContext.checkProject')}
      </Button>
      <Button variant="ghost" title={t('documentContext.consultHint')} onClick={() => setPickerOpen(true)} disabled={unavailable || !loaded}>
        <Icon name="folder" size={16} />{t('documentContext.addProject')}
      </Button>
    </div>
    {references.length > 0 ? <ul className={styles.references} aria-label={t('documentContext.references')}>
      {references.map((reference) => <li key={reference.projectId}>
        <span title={reference.name}>{reference.name}</span>
        <Button variant="ghost" aria-label={t('documentContext.remove', { name: reference.name })} disabled={unavailable} onClick={() => void execute(references.filter((row) => row.projectId !== reference.projectId).map((row) => row.projectId))}><Icon name="close" size={13} /></Button>
      </li>)}
    </ul> : null}
    {failure ? <div className={styles.error} role="alert">
      <span>{t(failure.key)}</span>
      {failure.retry ? <Button variant="ghost" disabled={unavailable} onClick={() => void execute(failure.retry!)}>{t('documentContext.retry')}</Button> : null}
    </div> : <span className={styles.status} role="status">
      {busy === 'load' ? t('documentContext.loading') : busy === 'save' ? t('documentContext.saving') : status ? t(status) : ''}
    </span>}
    {pickerOpen ? <ProjectReferenceModal currentProjectId={projectId} workspaceContext={workspaceContext} onClose={() => setPickerOpen(false)} onSelect={addReferences} /> : null}
  </div>;
}
