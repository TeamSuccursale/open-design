import type { CustodianIndexingStatus, DocumentResearchRun, ProjectCustodianLedger, ProjectIntakeCatalog } from '@open-design/contracts';
import { projectIntakeProgress } from './project-intake-progress';

export type PreparationState = 'waiting' | 'working' | 'ready' | 'attention';
export interface IntakeStatusSnapshot { catalog: ProjectIntakeCatalog; loaded: boolean; error: boolean; launchError: boolean }
export interface ResearchStatusSnapshot { run: DocumentResearchRun | null; busy: 'read' | 'start' | 'retry' | null; error: boolean; unavailable: boolean; pending: boolean }
export interface CustodianStatusSnapshot { ledger: ProjectCustodianLedger | null; indexing: CustodianIndexingStatus | null; error: boolean }

/** A completed label requires positive coverage, not merely the absence of a running job. */
export function projectPreparationStatus(intake: IntakeStatusSnapshot | null, research: ResearchStatusSnapshot | null, custodian: CustodianStatusSnapshot | null): { text: PreparationState; images: PreparationState } {
  const ledger = custodian?.ledger;
  const indexing = custodian?.indexing;
  const stale = ledger?.sources.some((source) => source.status !== 'current') ?? false;
  // A partial pass also covers qualitative review gaps after all pages were
  // indexed. Only its explicitly pending domains have unfinished work; a
  // failed job with no known domain remains an unresolved failure for both.
  const indexingFailedFor = (domain: 'text' | 'images') => indexing?.phase === 'failed'
    ? !indexing.pendingDomains.length || indexing.pendingDomains.includes(domain)
    : indexing?.phase === 'partial' && indexing.pendingDomains.includes(domain);
  const textActive = indexing?.indexing && (indexing.phase === 'text' || indexing.pendingDomains.includes('text'));
  const imagesActive = indexing?.indexing && (indexing.phase === 'images' || indexing.pendingDomains.includes('images'));
  const run = research?.run;
  const textStatus = run?.status ?? ledger?.textStatus;
  let text: PreparationState = 'waiting', images: PreparationState = 'waiting';

  if (custodian?.error || research?.error || research?.unavailable || indexingFailedFor('text') || textStatus === 'failed' || textStatus === 'partial') text = 'attention';
  else if (textActive || research?.pending || research?.busy === 'start' || research?.busy === 'retry' || ['queued', 'quick', 'full'].includes(textStatus ?? '')) text = 'working';
  else if (stale) text = 'attention';
  else if (run?.status === 'complete' && run.coverage.sourcesTotal > 0 && run.coverage.pagesTotal > 0 && run.coverage.pagesAnalyzed >= run.coverage.pagesTotal && !run.coverage.pendingPages && !run.coverage.pagesUnreadable) text = 'ready';
  else if (!run && ledger?.textStatus === 'complete' && ledger.sources.length > 0 && ledger.sources.every((source) => source.pagesTotal > 0 && source.textAnalyzedPages.length >= source.pagesTotal)) text = 'ready';

  const progress = intake ? projectIntakeProgress(intake.catalog) : null;
  if (custodian?.error || intake?.error || intake?.launchError || indexingFailedFor('images') || progress?.hasFailures || (!intake?.loaded && ['partial', 'failed'].includes(ledger?.imagesStatus ?? ''))) images = 'attention';
  else if (ledger?.imageConsent !== false && (imagesActive || progress?.active || (!intake?.loaded && ledger?.imagesStatus === 'indexing'))) images = 'working';
  else if (stale) images = 'attention';
  else if (intake?.loaded && intake.catalog.documents.length > 0 && progress && !progress.unknownTotals && progress.totalPages > 0 && progress.completedPages >= progress.totalPages && progress.ready === intake.catalog.documents.length) images = 'ready';
  return { text, images };
}
