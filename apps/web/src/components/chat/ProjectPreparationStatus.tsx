import { useEffect, useId, useState } from 'react';
import { Button } from '@open-design/components';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { useT } from '../../i18n';
import { workspaceIdentityCacheKey } from '../../collab/workspace-identity';
import { isImageIntakeSource, projectPreparationStatus, type CustodianStatusSnapshot, type IntakeStatusSnapshot, type PreparationState, type ResearchStatusSnapshot } from '../../runtime/chat/project-preparation-status';
import { projectPreparationSources } from '../../runtime/chat/project-preparation-sources';
import { ProjectIntakeProgress } from './ProjectIntakeProgress';
import { DocumentResearchStatus } from './DocumentResearchStatus';
import { Icon, type IconName } from '../Icon';
import styles from './ProjectPreparationStatus.module.css';

interface Props { projectId: string; workspaceContext?: WorkspaceCollabContext | null; onIntakeSnapshot?: (snapshot: IntakeStatusSnapshot) => void }
const stateIcons: Record<PreparationState, IconName> = { waiting: 'history', working: 'refresh', ready: 'check', attention: 'alert-triangle', none: 'minus' };

export function ProjectPreparationStatus(props: Props) {
  return <PreparationStatusScope key={`${props.projectId}\0${workspaceIdentityCacheKey(props.workspaceContext)}`} {...props} />;
}

/** Existing detail components own each data stream once, even while the drawer is closed. */
function PreparationStatusScope({ projectId, workspaceContext, onIntakeSnapshot }: Props) {
  const t = useT(), detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  const [intake, setIntake] = useState<IntakeStatusSnapshot | null>(null);
  useEffect(() => { if (intake) onIntakeSnapshot?.(intake); }, [intake, onIntakeSnapshot]);
  const [research, setResearch] = useState<ResearchStatusSnapshot | null>(null);
  const [custodian, setCustodian] = useState<CustodianStatusSnapshot | null>(null);
  const status = projectPreparationStatus(intake, research, custodian);
  const sources = projectPreparationSources(intake, research, custodian);
  return <section className={styles.root} aria-label={t('projectStatus.title')} data-testid="project-preparation-status">
    <Button variant="ghost" className={styles.toggle} aria-label={t('projectStatus.title')} aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((open) => !open)}>
      <span className={styles.indicators} role="status" aria-live="polite" aria-atomic="true">
        {(['text', 'images'] as const).map((domain) => <span key={domain} className={styles.indicator} data-state={status[domain]} data-testid={`project-status-${domain}`}>
          <Icon name={stateIcons[status[domain]]} size={13} /><span>{t(`projectStatus.${domain}`)}: <span className={styles.state}>{t(`projectStatus.${status[domain]}`)}</span></span>
        </span>)}
      </span>
      <Icon name="chevron-down" size={14} className={expanded ? styles.expanded : undefined} />
    </Button>
    <div id={detailsId} className={styles.details} hidden={!expanded}>
      <div className={styles.detailHeading}><strong>{t('projectStatus.details')}</strong><Button variant="ghost" aria-label={t('projectStatus.closeDetails')} onClick={() => setExpanded(false)}><Icon name="close" size={15} /></Button></div>
      {sources.length ? <table className={styles.sources} aria-label={t('projectStatus.sources')}>
        <thead><tr><th>{t('projectStatus.sources')}</th><th>{t('projectStatus.text')}</th><th>{t('projectStatus.images')}</th></tr></thead>
        <tbody>{sources.map((source) => <tr key={source.path} data-testid="preparation-source">
          <th scope="row"><span>{source.title}</span><small>{source.path}</small>{source.stale || source.failed ? <span className={styles.sourceWarning}><Icon name="alert-triangle" size={12} />{t('projectStatus.attention')}</span> : null}</th>
          <td>{source.total ? `${source.textPages} / ${source.total}` : t('projectStatus.waiting')}</td>
          <td>{custodian?.ledger?.imageConsent === false ? t('projectStatus.imagesOff') : !isImageIntakeSource(source.path) ? t('projectStatus.imagesNotApplicable') : source.total ? `${source.imagePages} / ${source.total}` : t('projectStatus.waiting')}</td>
        </tr>)}</tbody>
      </table> : <p className={styles.emptySources}>{t(status.text === 'working' || status.images === 'working' ? 'projectStatus.discoveringSources' : 'projectStatus.noIndexedSources')}</p>}
      <ProjectIntakeProgress projectId={projectId} workspaceContext={workspaceContext} onSnapshot={setIntake} />
      <DocumentResearchStatus projectId={projectId} workspaceContext={workspaceContext} onResearchSnapshot={setResearch} onCustodianSnapshot={setCustodian} />
    </div>
  </section>;
}
