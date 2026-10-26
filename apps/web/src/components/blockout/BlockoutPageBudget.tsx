import { Button, Input, Select, Textarea } from '@open-design/components';
import { getBlockoutPageBudgetStatus, type BlockoutDocument } from '@open-design/contracts';
import { useT } from '../../i18n';
import styles from './BlockoutWorkspace.module.css';

export function BlockoutBudgetCount({ document, variantId }: { document: BlockoutDocument; variantId: string }) {
  const t = useT(), status = getBlockoutPageBudgetStatus(document, variantId);
  return <span className={styles.budgetCount} data-warning={status.over > 0 || status.unfilled > 0 || undefined}>
    {status.limit !== undefined ? t('blockout.budgetCount', { count: status.counted, limit: status.limit }) : status.target !== undefined ? t('blockout.budgetTargetCount', { count: status.counted, target: status.target }) : t('blockout.budgetUnset', { count: status.counted })}
    {status.excluded > 0 && <span> · {t('blockout.budgetExcluded', { count: status.excluded })}</span>}
  </span>;
}

export function BlockoutPageBudget({ document, busy, onChange, onAddPages, embedded = false }: {
  document: BlockoutDocument; busy: boolean; onChange: (document: BlockoutDocument) => void; onAddPages: (count: number) => void;
  embedded?: boolean;
}) {
  const t = useT(), status = getBlockoutPageBudgetStatus(document, document.activeVariantId), budget = document.pageBudget;
  const variant = document.variants.find((item) => item.id === document.activeVariantId)!;
  function patch(value: Partial<NonNullable<BlockoutDocument['pageBudget']>>) {
    const next = { mode: budget?.mode ?? 'flexible' as const, ...budget, ...value };
    if (next.mode !== 'flexible' && !next.limit) next.limit = Math.max(1, status.counted);
    if (next.mode === 'exact') next.target = next.limit;
    if (next.limit && next.target && next.mode !== 'flexible') next.target = Math.min(next.target, next.limit);
    onChange({ ...document, pageBudget: next });
  }
  const warning = status.over > 0 ? t('blockout.budgetOver', { count: status.over }) : status.unfilled > 0 ? t('blockout.budgetUnder', { count: status.unfilled }) : budget ? t('blockout.budgetReady') : '';
  return <section className={styles.budgetBar} aria-label={t('blockout.budget')}>
    {!embedded && <div className={styles.budgetSummary}><strong>{t('blockout.budget')}</strong><BlockoutBudgetCount document={document} variantId={document.activeVariantId} />
      {warning && <span className={styles.budgetWarning} data-warning={status.over > 0 || status.unfilled > 0 || undefined} role="status">{warning}</span>}
      {status.unfilled > 0 && variant.pages.length + status.unfilled <= 60 && <Button variant="ghost" disabled={busy} onClick={() => onAddPages(status.unfilled)}>{t('blockout.addTargetPages', { count: status.unfilled })}</Button>}
    </div>}
    <details className={styles.budgetSettings} open={embedded || undefined}><summary>{t('blockout.budgetSettings')}</summary>
      <fieldset disabled={busy} className={styles.budgetFields}>
        {embedded && status.unfilled > 0 && variant.pages.length + status.unfilled <= 60 && <Button variant="ghost" disabled={busy} onClick={() => onAddPages(status.unfilled)}>{t('blockout.addTargetPages', { count: status.unfilled })}</Button>}
        <label>{t('blockout.budgetMode')}<Select aria-label={t('blockout.budgetMode')} value={budget?.mode ?? 'flexible'} onChange={(event) => patch({ mode: event.target.value as NonNullable<BlockoutDocument['pageBudget']>['mode'] })}>
          <option value="maximum">{t('blockout.budgetMaximum')}</option><option value="exact">{t('blockout.budgetExact')}</option><option value="flexible">{t('blockout.budgetFlexible')}</option>
        </Select></label>
        <label>{t('blockout.budgetLimit')}<Input aria-label={t('blockout.budgetLimit')} type="number" min={1} max={60} value={budget?.limit ?? ''} onChange={(event) => {
          const value = Number(event.target.value); if (!Number.isInteger(value) || value < 1 || value > 60) return;
          patch({ limit: value, target: !budget?.target || budget.target === budget.limit ? value : budget.target, mode: budget?.mode ?? 'maximum' });
        }} /></label>
        <label>{t('blockout.budgetTarget')}<Input aria-label={t('blockout.budgetTarget')} type="number" min={1} max={budget?.mode === 'flexible' ? 60 : budget?.limit ?? 60} value={budget?.target ?? ''} disabled={budget?.mode === 'exact'} onChange={(event) => {
          if (!event.target.value) { patch({ target: undefined }); return; }
          const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 60) patch({ target: value });
        }} /></label>
        {budget?.limit && budget.mode !== 'exact' && <label className={styles.budgetCheck}><input type="checkbox" checked={budget.target === budget.limit} onChange={(event) => patch({ target: event.target.checked ? budget.limit : undefined })} />{t('blockout.budgetFull')}</label>}
        {budget?.source && <p className={styles.budgetSource}><strong>{t('blockout.budgetSource')}</strong> {budget.source}</p>}
        <label className={styles.budgetNotes}>{t('blockout.budgetNote')}<Textarea aria-label={t('blockout.budgetNote')} rows={2} maxLength={4000} value={budget?.note ?? ''} onChange={(event) => patch({ note: event.target.value })} /></label>
        <p className={styles.budgetHelp}>{t('blockout.budgetDraftHint')}</p>
      </fieldset>
    </details>
  </section>;
}
