import { useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { recordProjectHistoryActivity } from '../../providers/project-history';
import { Icon } from '../Icon';
import { ProjectHistoryPanel } from './ProjectHistoryPanel';
import { OPEN_PROJECT_HISTORY_EVENT, openProjectHistory, type OpenProjectHistoryDetail } from './events';

export function ProjectHistoryButton({ projectId }: { projectId: string }) {
  const { locale } = useI18n();
  return <Button variant="ghost" onClick={() => openProjectHistory({ projectId })} title={locale === 'it' ? 'Cronologia del progetto' : 'Project history'}><Icon name="history" size={15} />{locale === 'it' ? 'Cronologia progetto' : 'Project history'}</Button>;
}

/** Actual interactions advance work time; a visible-but-idle tab emits no heartbeat. */
export function ProjectHistoryController({ projectId, workspaceContext, enabled, onRestored }: {
  projectId: string; workspaceContext?: WorkspaceCollabContext | null; enabled: boolean; onRestored?: () => void;
}) {
  const [open, setOpen] = useState(false), lastSent = useRef(0);
  const scope = JSON.stringify(workspaceContext ?? null);
  useEffect(() => {
    setOpen(false); lastSent.current = 0;
    if (!enabled) return;
    const controller = new AbortController();
    const show = (event: Event) => { if ((event as CustomEvent<OpenProjectHistoryDetail>).detail?.projectId === projectId) setOpen(true); };
    const active = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastSent.current < 30_000) return;
      lastSent.current = Date.now();
      void recordProjectHistoryActivity(projectId, workspaceContext, controller.signal).catch(() => { /* The panel and save boundary report recovery failures. */ });
    };
    window.addEventListener(OPEN_PROJECT_HISTORY_EVENT, show);
    for (const event of ['keydown', 'pointerdown', 'input', 'wheel']) window.addEventListener(event, active, { passive: true });
    active();
    return () => {
      controller.abort(); window.removeEventListener(OPEN_PROJECT_HISTORY_EVENT, show);
      for (const event of ['keydown', 'pointerdown', 'input', 'wheel']) window.removeEventListener(event, active);
    };
    // Authority is keyed by its serialized identity, not render-object allocation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, scope, enabled]);
  return open && enabled ? <ProjectHistoryPanel projectId={projectId} workspaceContext={workspaceContext} onClose={() => setOpen(false)} onRestored={() => onRestored?.()} /> : null;
}
