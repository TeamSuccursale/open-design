import { useState } from 'react';
import { Button } from '@open-design/components';
import { intakeSourceLabel, isIntakeImageSource, type ProjectIntakeCatalog, type WorkspaceCollabContext } from '@open-design/contracts';
import { useT } from '../../i18n';
import { projectRawUrl } from '../../providers/registry';
import { fetchProjectIntake, OPEN_PROJECT_GALLERY_EVENT } from '../../providers/project-intake';
import { projectIntakeProgress } from '../../runtime/chat/project-intake-progress';
import type { IntakeStatusSnapshot } from '../../runtime/chat/project-preparation-status';
import { Icon } from '../Icon';
import { ProjectLogoSources } from '../header-footer/ProjectLogoSources';
import styles from './ProjectIntakeCard.module.css';

/** A Fast project always has the card; a document chat gets it for PDFs taken in, not for the images its chats send quietly to the gallery. */
export function intakeCardShown(fast: boolean, catalog: ProjectIntakeCatalog | null | undefined): boolean {
  return fast || Boolean(catalog?.documents.some((document) => !isIntakeImageSource(document.sourcePath)));
}

export function ProjectIntakeCard({ projectId, workspaceContext, snapshot, sourceNames }: {
  projectId: string; workspaceContext?: WorkspaceCollabContext | null; snapshot: IntakeStatusSnapshot | null; sourceNames: string[];
}) {
  const t = useT(), [starting, setStarting] = useState(false), [startError, setStartError] = useState('');
  const catalog = snapshot?.catalog;
  const progress = catalog ? projectIntakeProgress(catalog) : null;
  const [dismissed, setDismissed] = useState(false);
  const [failedPreview, setFailedPreview] = useState<string | null>(null);
  if (dismissed || (!sourceNames.length && !catalog?.documents.length)) return null;
  const readyImages = catalog?.assets.filter((asset) => asset.status === 'ready' && asset.kind !== 'page') ?? [];
  const preview = catalog?.assets.find((asset) => asset.kind === 'page' && asset.imagePath) ?? readyImages[0];
  const active = Boolean(progress?.active || starting);
  const attention = Boolean(progress?.hasFailures || snapshot?.error || snapshot?.launchError || startError);
  const state = active ? 'working' : attention ? 'attention' : catalog?.documents.length ? 'ready' : 'idle';
  const names = catalog?.documents.length ? catalog.documents.map((item) => item.name) : sourceNames;
  const openGallery = () => window.dispatchEvent(new CustomEvent(OPEN_PROJECT_GALLERY_EVENT, { detail: { projectId } }));
  async function prepare() {
    setStarting(true); setStartError('');
    try { await fetchProjectIntake(projectId, workspaceContext, attention ? { retry: true } : {}); }
    catch (error) { setStartError(error instanceof Error ? error.message : String(error)); }
    finally { setStarting(false); }
  }
  return <section className={styles.card} aria-label={t('intakeCard.title')} data-testid="project-intake-card" data-state={state}>
    <div className={styles.preview}>
      {preview && failedPreview !== preview.imagePath ? <img src={projectRawUrl(projectId, preview.imagePath, workspaceContext)} alt={t('intakeCard.preview')} onError={() => setFailedPreview(preview.imagePath)} /> : <Icon name="image" size={30} />}
    </div>
    <div className={styles.body}>
      <div className={styles.heading}><h3 aria-live="polite">{t(`intakeCard.${state}`)}</h3><Button variant="ghost" aria-label={t('common.close')} onClick={() => setDismissed(true)}><Icon name="close" size={15} /></Button></div>
      <p>{t(`intakeCard.${state}Hint`)}</p>
      <span className={styles.counts}>{t('intakeCard.counts', { documents: names.length, images: readyImages.length })}</span>
      {active && <><progress max={100} {...(progress?.percent !== undefined ? { value: progress.percent } : {})} aria-label={t('intake.progress.bar')} /><span className={styles.steps}>{t('intakeCard.steps')}</span></>}
      {preview && <span className={styles.source}>{intakeSourceLabel(preview, (name, page) => t('intakeCard.source', { name, page }))}</span>}
      {startError && <p role="alert">{startError}</p>}
      <ProjectLogoSources projectId={projectId} context={workspaceContext} />
      <div className={styles.actions}><Button variant="secondary" disabled={starting} onClick={catalog?.documents.length ? openGallery : () => void prepare()}>{t(catalog?.documents.length ? 'intakeCard.gallery' : 'intakeCard.prepare')}<Icon name="arrow-right" size={14} /></Button></div>
    </div>
  </section>;
}
