import { useEffect, useId, useState } from 'react';
import { Button, Dialog } from '@open-design/components';
import type { DocumentRuleCheck, DocumentRuleCheckRow, WorkspaceCollabContext } from '@open-design/contracts';
import { useI18n } from '../i18n';
import type { Dict } from '../i18n/types';
import { checkDocumentRules } from '../runtime/document-rule-check';
import styles from './DocumentRuleCheckDialog.module.css';

type Translate = (key: keyof Dict, vars?: Record<string, string | number>) => string;
type CheckState = { status: 'measuring' } | { status: 'done'; check: DocumentRuleCheck | null } | { status: 'failed'; reason: 'no-browser' | 'failed' };
const MAX_FINDINGS = 5;

/** What was measured on a row, read against its rule when the rule states a value. */
function measuredLines(row: DocumentRuleCheckRow, t: Translate, mm: (value: number) => string): string[] {
  const size = (item: { widthMm: number; heightMm: number }) => `${mm(item.widthMm)} × ${mm(item.heightMm)} mm`;
  const findings = (lines: string[]) => [...lines.slice(0, MAX_FINDINGS), ...(lines.length > MAX_FINDINGS ? [t('ruleCheck.moreFindings', { count: lines.length - MAX_FINDINGS })] : [])];
  switch (row.kind) {
    case 'pages': {
      const { total, counted, covers, undecidedCovers } = row.measured;
      return [
        row.expected ? t('ruleCheck.pages.limit', { counted, max: row.expected.maxPages }) : t('ruleCheck.pages.count', { count: total }),
        ...(covers ? [t('ruleCheck.pages.coversExcluded', { count: covers })] : []),
        ...(undecidedCovers ? [t('ruleCheck.pages.coversUndecided', { count: undecidedCovers })] : []),
      ];
    }
    case 'paper': {
      const expected = row.expected && (row.expected.name ? `${row.expected.name} (${size(row.expected)})` : size(row.expected));
      if (row.findings.length) return findings(row.findings.map((item) => t('ruleCheck.paper.finding', { page: item.page, size: size(item), expected: expected ?? '' })));
      const sizes = row.measured.sizes;
      return sizes.length === 1
        ? [t('ruleCheck.paper.every', { size: row.expected?.name ? `${row.expected.name}, ${size(sizes[0]!)}` : size(sizes[0]!) })]
        : sizes.map((item) => t('ruleCheck.paper.pages', { size: size(item), pages: item.pages.join(', ') }));
    }
    case 'orientation': {
      const name = (value: 'portrait' | 'landscape') => t(value === 'portrait' ? 'ruleCheck.orientation.portrait' : 'ruleCheck.orientation.landscape');
      if (row.findings.length) return findings(row.findings.map((item) => t('ruleCheck.orientation.finding', { page: item.page, orientation: name(item.orientation), expected: row.expected ? name(row.expected) : '' })));
      const { portrait, landscape } = row.measured;
      return [portrait.length && landscape.length
        ? t('ruleCheck.orientation.mixed', { portrait: portrait.join(', '), landscape: landscape.join(', ') })
        : t('ruleCheck.orientation.every', { orientation: name(landscape.length ? 'landscape' : 'portrait') })];
    }
    case 'font': {
      if (row.findings.length) {
        return findings(row.findings.map((item) => (item.issue === 'size'
          ? t('ruleCheck.font.sizeFinding', { page: item.page, pt: mm(item.pt), family: item.family, min: mm(row.expected?.minPt ?? 0) })
          : t('ruleCheck.font.familyFinding', { page: item.page, family: item.family, expected: row.expected?.family ?? '' }))
          + (item.label ? ` · ${item.label}` : item.text ? ` · «${item.text}»` : '')));
      }
      const smallest = row.measured.smallest;
      return [smallest ? t('ruleCheck.font.smallest', { pt: mm(smallest.pt), family: smallest.family, page: smallest.page }) : t('ruleCheck.font.none')];
    }
    case 'margins': {
      const side = (value: 'left' | 'right' | 'top' | 'bottom') => t(`ruleCheck.side.${value}`);
      if (row.findings.length) {
        return findings(row.findings.map((item) => t('ruleCheck.margins.finding', { page: item.page, side: side(item.side), mm: mm(item.mm), expected: mm(item.expectedMm ?? 0) })
          + (item.label ? ` · ${item.label}` : item.text ? ` · «${item.text}»` : ` · ${t(`ruleCheck.kind.${item.kind}`)}`)));
      }
      const smallest = row.measured.smallest;
      return [smallest ? t('ruleCheck.margins.smallest', { mm: mm(smallest.mm), side: side(smallest.side), page: smallest.page }) : t('ruleCheck.margins.none')];
    }
  }
}

function RuleRow({ row, t, mm }: { row: DocumentRuleCheckRow; t: Translate; mm: (value: number) => string }) {
  const label = t(`ruleCheck.row.${row.kind}`);
  const rule = row.rule;
  const sources = rule?.sources.map((source) => (source.page ? t('ruleCheck.sourcePage', { path: source.path, page: source.page }) : source.path)) ?? [];
  const state = rule?.status === 'suggested' ? ` (${t('ruleCheck.ruleSuggested')})` : rule?.status === 'conflict' ? ` (${t('ruleCheck.ruleConflict')})` : '';
  return <li aria-label={label} className={styles.row} data-status={row.status}>
    <div className={styles.head}><strong>{label}</strong><span className={styles.status}>{t(`ruleCheck.status.${row.status}`)}</span></div>
    {measuredLines(row, t, mm).map((line, index) => <p key={index}>{line}</p>)}
    {!rule ? <p className={styles.source}>{t('ruleCheck.noRule')}</p>
      : rule.origin === 'blockout' ? <p className={styles.rule}>{t('ruleCheck.blockoutRule')}</p>
      : <>
        <p className={styles.rule}>«{rule.text}»{state}</p>
        {row.status === 'unchecked' && <p className={styles.source}>{t('ruleCheck.vagueRule')}</p>}
        <p className={styles.source}>{sources.length ? t('ruleCheck.source', { sources: sources.join('; ') }) : t('ruleCheck.noSource')}</p>
      </>}
  </li>;
}

/**
 * The check shown when a designed document is exported to PDF: page count against the limit, paper, orientation,
 * smallest type and margins, each with the rule it was read against and where that rule came from. The export button
 * works from the first moment, while the pages are still being measured and whatever the rows say.
 */
export function DocumentRuleCheckDialog({ projectId, fileName, versionId, workspaceContext, onExport, onClose }: {
  projectId: string; fileName: string; versionId?: string; workspaceContext?: WorkspaceCollabContext | null;
  onExport: () => void; onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const [state, setState] = useState<CheckState>({ status: 'measuring' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'measuring' });
    void checkDocumentRules({ projectId, fileName, ...(versionId ? { versionId } : {}), workspaceContext }).then((result) => {
      if (!live) return;
      if (!result.ok) console.warn('[rule-check] the check could not run:', result.detail);
      setState(result.ok ? { status: 'done', check: result.check } : { status: 'failed', reason: result.reason });
    });
    return () => { live = false; };
  }, [projectId, fileName, versionId, workspaceContext, attempt]);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const mm = (value: number) => number.format(value);
  const check = state.status === 'done' ? state.check : null;
  const warnings = check?.rows.filter((row) => row.status === 'warning').map((row) => t(`ruleCheck.row.${row.kind}`)) ?? [];
  return <Dialog ariaLabelledBy={titleId} onClose={onClose} closeOnEscape className={styles.dialog}>
    <h2 id={titleId}>{t('ruleCheck.title')}</h2>
    <p className={styles.intro}>{t('ruleCheck.intro')}</p>
    {state.status === 'measuring' && <p role="status">{t('ruleCheck.measuring')}</p>}
    {state.status === 'failed' && <p role="alert" className={styles.alert}>{t(state.reason === 'no-browser' ? 'ruleCheck.noBrowser' : 'ruleCheck.failed')}</p>}
    {check && <>
      <p role="status" className={styles.summary}>{warnings.length ? t('ruleCheck.summaryWarnings', { rows: warnings.join(', ') }) : t('ruleCheck.summaryOk')}</p>
      {check.unreadStylesheets > 0 && <p className={styles.intro}>{t('ruleCheck.unreadStylesheets', { count: check.unreadStylesheets })}</p>}
      <ul className={styles.rows}>{check.rows.map((row) => <RuleRow key={row.kind} row={row} t={t} mm={mm} />)}</ul>
    </>}
    <footer className={styles.footer}>
      <Button variant="ghost" disabled={state.status === 'measuring'} onClick={() => setAttempt((value) => value + 1)}>{t('ruleCheck.recheck')}</Button>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" onClick={onExport}>{t('ruleCheck.export')}</Button>
    </footer>
  </Dialog>;
}
