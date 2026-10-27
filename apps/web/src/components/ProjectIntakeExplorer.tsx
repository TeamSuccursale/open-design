import { useEffect, useState } from 'react';
import { Button } from '@open-design/components';
import { intakeSourceLabel, type IntakeAsset, type WorkspaceCollabContext } from '@open-design/contracts';
import { fetchProjectIntake, OPEN_PROJECT_GALLERY_EVENT } from '../providers/project-intake';
import { projectRawUrl } from '../providers/registry';
import { useT } from '../i18n';
import styles from './ProjectGalleryDrawer.module.css';

interface Props { projectId: string; workspaceContext?: WorkspaceCollabContext | null; onOpenFile: (name: string) => void }
/** Extracted source material belongs in the file explorer, never the chat transcript. */
export function ProjectIntakeExplorer({ projectId, workspaceContext, onOpenFile }: Props) {
  const t = useT();
  const [assets, setAssets] = useState<IntakeAsset[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const catalog = await fetchProjectIntake(projectId, workspaceContext, undefined, controller.signal);
        if (!controller.signal.aborted) setAssets(catalog.assets.filter((asset) => asset.kind !== 'page' && asset.status === 'ready'));
      } catch { /* Gallery reports intake errors; ordinary file browsing stays available. */ }
      if (!controller.signal.aborted) timer = setTimeout(() => { void refresh(); }, 5000);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId, workspaceContext]);
  if (!assets.length) return null;
  return <section className={styles.explorer} aria-label={t('intake.recognizedAssets')}>
    <header><h3>{t('intake.recognizedAssets')} <span>{assets.length}</span></h3><Button variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PROJECT_GALLERY_EVENT, { detail: { projectId } }))}>{t('intake.openGallery')}</Button></header>
    <div className={styles.explorerGrid}>{assets.map((asset) => <button type="button" key={asset.id} className={styles.explorerAsset} aria-label={t('intake.previewAsset', { title: asset.title })} title={asset.description} onClick={() => onOpenFile(asset.imagePath)}>
      <img src={projectRawUrl(projectId, asset.imagePath, workspaceContext)} alt="" loading="lazy" />
      <strong>{asset.title}</strong><span>{intakeSourceLabel(asset, (name, page) => `${name} · ${t('intake.page', { page })}`)}</span>
    </button>)}</div>
  </section>;
}
