import { Button } from '@open-design/components';
import type { BlockoutFitAssessment, BlockoutFitVariant } from '@open-design/contracts';
import { useT } from '../../i18n';
import { Icon } from '../Icon';
import type { BlockoutReadiness as Readiness } from './useBlockoutReadiness';
import styles from './BlockoutReadiness.module.css';

export function BlockoutReadiness({ value, generating = false, compact = false }: { value: Readiness; generating?: boolean; compact?: boolean }) {
  const t = useT(), { inventory, assessment, legacy, loading, checking, error } = value;
  if (assessment?.basis === 'structure') return null;
  const inventoryDone = inventory?.status === 'ready';
  const needsInput = inventory?.status === 'needs-input' || inventory?.status === 'failed';
  const phase = !inventoryDone ? 0 : !assessment || checking || generating ? 1 : 2;
  const message = legacy ? 'blockoutMaterials.unverified' : error ? error : needsInput ? 'blockoutMaterials.needsInput'
    : !inventoryDone ? 'blockoutMaterials.waitInventory' : checking ? 'blockoutMaterials.checking'
    : assessment ? `blockoutMaterials.${assessment.status}` as const : 'blockoutMaterials.waitProposals';
  return <section className={styles.readiness} aria-label={t('blockoutMaterials.preparation')} data-testid="blockout-readiness">
    {!legacy && !compact && <ol className={styles.phases} aria-label={t('blockoutMaterials.phases')}>
      {(['inventory', 'checks', 'proposals'] as const).map((name, index) => <li key={name} aria-current={phase === index ? 'step' : undefined} data-complete={index < phase || undefined}>{t(`blockoutMaterials.phase.${name}`)}</li>)}
    </ol>}
    <div className={styles.summary} role={error || needsInput ? 'alert' : 'status'}>
      <Icon name={error || needsInput || assessment?.status === 'blocked' || assessment?.status === 'warning' ? 'alert-triangle' : legacy ? 'info' : assessment?.status === 'ready' && !generating ? 'check' : 'history'} size={14} />
      <span>{t(message)}</span>
      {inventory && <span className={styles.count}>{t('blockoutMaterials.sourceCount', { done: inventory.sources.processed, total: inventory.sources.total })}</span>}
      {inventory?.sources.entries.some((entry) => entry.coverage?.images === 'not-requested') && <span className={styles.count}>{t('blockoutMaterials.textOnly')}</span>}
      {(error || needsInput) && <Button variant="ghost" onClick={value.retry}>{t('documentStart.retry')}</Button>}
    </div>
    {value.comparisonError && <p className={styles.previewNotice} role="status">{t('blockoutMaterials.previewNotUpdated')}</p>}
    {!legacy && (loading || !inventoryDone && !needsInput && !error || checking) && <progress className={styles.progress} aria-label={t('blockoutMaterials.preparation')}
      {...(inventory && inventory.sources.total > 0 && !checking ? { max: inventory.sources.total, value: Math.min(inventory.sources.processed, Math.max(0, inventory.sources.total - 0.01)) } : {})} />}
    {(inventory?.gaps.length || assessment?.issues.length || assessment?.limitations.length) ? <details className={styles.details}><summary>{t('blockoutMaterials.details')}</summary>
      <ul>{[...new Set([...(inventory?.gaps ?? []), ...(assessment?.issues.map((issue) => issue.message) ?? []), ...(assessment?.limitations ?? [])])].map((message) => <li key={message}>{message}</li>)}</ul>
    </details> : null}
  </section>;
}

export function BlockoutFitSummary({ assessment, variantId }: { assessment?: BlockoutFitAssessment | null; variantId: string }) {
  const t = useT(), variant: BlockoutFitVariant | undefined = assessment?.variants.find((entry) => entry.variantId === variantId);
  if (!variant) return <p className={styles.fitSummary}>{t('blockoutMaterials.unverifiedShort')}</p>;
  const issues = [...variant.issues, ...variant.pages.flatMap((page) => [...page.issues, ...page.blocks.flatMap((block) => block.issues)])];
  const densities = variant.pages.map((page) => Math.round(page.density * 100));
  return <div className={styles.fitSummary} data-fit-status={variant.status}>
    <strong>{t(`blockoutMaterials.${variant.status}`)}</strong>
    {densities.length > 0 && <span>{t('blockoutMaterials.density', { min: Math.min(...densities), max: Math.max(...densities) })}</span>}
    <details className={styles.details}><summary>{t('blockoutMaterials.pageChecks', { count: variant.pages.length, issues: issues.length })}</summary>
      <ul>{variant.pages.map((page) => <li key={page.pageId}>{t('blockoutMaterials.pageDensity', { page: page.pageNumber, density: Math.round(page.density * 100) })}{page.overflowAreaMm2 > 0 ? ` · ${t('blockoutMaterials.overflow')}` : ''}</li>)}</ul>
      {issues.length > 0 && <ul>{[...new Set(issues.map((issue) => issue.message))].map((message) => <li key={message}>{message}</li>)}</ul>}
    </details>
  </div>;
}
