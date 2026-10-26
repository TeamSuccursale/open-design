import { useEffect, useState } from 'react';
import { Button } from '@open-design/components';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { loadBlockout } from '../../providers/blockout';
import { useT } from '../../i18n';
import styles from './BlockoutWorkspace.module.css';

export function BlockoutStartChoice({ projectId, workspaceContext, onBuild, onAgent }: { projectId: string; workspaceContext?: WorkspaceCollabContext | null; onBuild: () => void; onAgent: () => void }) {
  const t = useT(), [empty, setEmpty] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const check = () => { void loadBlockout(projectId, workspaceContext, controller.signal).then(({ document }) => {
      if (!controller.signal.aborted) setEmpty(!document?.variants.some((variant) => variant.pages.some((page) => page.blocks.length)));
    }).catch(() => {}); };
    check(); window.addEventListener('melillodesign:blockout-saved', check);
    return () => { controller.abort(); window.removeEventListener('melillodesign:blockout-saved', check); };
  }, [projectId, workspaceContext]);
  return empty ? <section className={styles.startChoice}><strong>{t('blockout.startTitle')}</strong><p>{t('blockout.startHint')}</p><div><Button variant="secondary" onClick={onBuild}>{t('blockout.startBuild')}</Button><Button variant="ghost" onClick={onAgent}>{t('blockout.startAgent')}</Button></div></section> : null;
}
