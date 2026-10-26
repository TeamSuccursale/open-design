import { documentPresentationPageState, renderAppliedHeaderFooterSvg, type DocumentPresentation, type WorkspaceCollabContext } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { projectFileUrl } from '../../providers/registry';
import styles from './BlockoutWorkspace.module.css';

/** Schematic editorial chrome only: no supplied text, images or final design. */
export function BlockoutPagePresentation({ presentation, index, role, widthMm = 210, heightMm = 297, totalPages = index + 1, workspaceContext }: { presentation?: DocumentPresentation; index: number; role?: string; widthMm?: number; heightMm?: number; totalPages?: number; workspaceContext?: WorkspaceCollabContext | null }) {
  const { locale } = useI18n(), italian = locale === 'it';
  const state = documentPresentationPageState(presentation, { index, role });
  if (!presentation) return null;
  const applied = presentation.headerFooter;
  const svg = applied ? renderAppliedHeaderFooterSvg(applied, { widthMm, heightMm, documentName: presentation.name, index, totalPages, isCover: state.isCover, visibleNumber: state.visibleNumber,
    assetUrl: (file) => projectFileUrl(applied.projectId, file, workspaceContext) }) : '';
  return <span className={styles.pagePresentation} data-testid="blockout-page-presentation" data-cover={state.isCover || undefined} data-counted={state.countsTowardPageLimit === null ? 'unknown' : String(state.countsTowardPageLimit)} data-sequence={state.sequenceNumber ?? undefined}>
    {svg && <span className={styles.appliedHeaderFooter} data-testid="applied-header-footer" dangerouslySetInnerHTML={{ __html: svg }} />}
    {!applied && state.header === true && <span className={styles.presentationHeader}>{italian ? 'Intestazione da configurare' : 'Header to configure'}</span>}
    {state.isCover && <span className={styles.presentationCover}><strong>{italian ? 'Copertina' : 'Cover'}</strong><span>{presentation.name}</span><small>{state.countsTowardPageLimit === false ? italian ? 'Fuori dal limite di pagine' : 'Outside the page limit' : state.countsTowardPageLimit === true ? italian ? 'Nel limite di pagine' : 'Included in the page limit' : italian ? 'Conteggio da confermare' : 'Counting to confirm'}</small></span>}
    {!applied && state.footer === true && <span className={styles.presentationFooter}>{italian ? 'Piè di pagina da configurare' : 'Footer to configure'}</span>}
    {state.visibleNumber !== null && (!applied || !applied.design.variants.some((variant) => variant.blocks.some((block) => block.kind === 'field' && block.field === 'pageNumber'))) && <span className={styles.presentationNumber} aria-label={`${italian ? 'Numero di pagina' : 'Page number'} ${state.visibleNumber}`}>{state.visibleNumber}</span>}
  </span>;
}
