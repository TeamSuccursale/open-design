import type { DocumentRuleCheck, DocumentRuleCheckRow } from '@open-design/contracts';

// `od export check` prints the rule check row by row: what was measured against what the rule allows, then the rule
// as the engineer confirmed it (quoted verbatim, it is usually Italian) and the file and page it came from.

const LABELS: Record<DocumentRuleCheckRow['kind'], string> = {
  pages: 'Pages', paper: 'Paper', orientation: 'Orientation', font: 'Smallest type', margins: 'Margins',
};
const KINDS = { text: 'text', image: 'image', box: 'framed box', 'header-footer': 'header or footer' } as const;
const MAX_FINDINGS = 5;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const mm = (value: number) => `${Math.round(value * 10) / 10} mm`;
const size = (item: { widthMm: number; heightMm: number }) => `${Math.round(item.widthMm)} × ${Math.round(item.heightMm)} mm`;
const quote = (text?: string) => (text ? ` "${text.length > 60 ? `${text.slice(0, 57)}...` : text}"` : '');
const pageList = (pages: number[]) => (pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.join(', ')}`);

function covers(row: Extract<DocumentRuleCheckRow, { kind: 'pages' }>): string {
  const { covers: excluded, undecidedCovers } = row.measured;
  const notes = [
    ...(excluded ? [excluded === 1 ? 'the cover does not count' : `${excluded} covers do not count`] : []),
    ...(undecidedCovers ? [`${plural(undecidedCovers, 'cover page')} not decided whether to count`] : []),
  ];
  return notes.length ? ` (${notes.join('; ')})` : '';
}

/** One line per row: the measurement, read against the rule when the rule states a value. */
function summary(row: DocumentRuleCheckRow): string[] {
  const findings = (lines: string[]) => [
    ...lines.slice(0, MAX_FINDINGS),
    ...(lines.length > MAX_FINDINGS ? [`... and ${lines.length - MAX_FINDINGS} more`] : []),
  ];
  switch (row.kind) {
    case 'pages':
      return [row.expected
        ? `${row.measured.counted} of ${row.expected.maxPages} allowed${covers(row)}`
        : `${plural(row.measured.total, 'page')}${covers(row)}`];
    case 'paper': {
      const name = row.expected?.name ? `${row.expected.name}, ` : '';
      if (row.findings.length) {
        return findings(row.findings.map((item) => `page ${item.page} is ${size(item)}, expected ${name}${size(row.expected!)}`));
      }
      const sizes = row.measured.sizes;
      return [sizes.length === 1 ? `${name}${size(sizes[0]!)} on every page` : sizes.map((item) => `${size(item)} on ${pageList(item.pages)}`).join('; ')];
    }
    case 'orientation': {
      if (row.findings.length) {
        return findings(row.findings.map((item) => `page ${item.page} is ${item.orientation}, expected ${row.expected}`));
      }
      const { portrait, landscape } = row.measured;
      if (!portrait.length || !landscape.length) return [`${landscape.length ? 'landscape' : 'portrait'} on every page`];
      return [`portrait on ${pageList(portrait)}; landscape on ${pageList(landscape)}`];
    }
    case 'font': {
      if (row.findings.length) {
        return findings(row.findings.map((item) => item.issue === 'size'
          ? `page ${item.page}: ${item.pt} pt ${item.family}${quote(item.label ?? item.text)}, expected at least ${row.expected?.minPt} pt`
          : `page ${item.page}: ${item.family}${quote(item.label ?? item.text)}, expected ${row.expected?.family}`));
      }
      const smallest = row.measured.smallest;
      return [smallest ? `${smallest.pt} pt ${smallest.family} on page ${smallest.page}${quote(smallest.text)}` : 'no text measured'];
    }
    case 'margins': {
      if (row.findings.length) {
        return findings(row.findings.map((item) => `page ${item.page} ${item.side} ${mm(item.mm)}`
          + `${item.expectedMm !== undefined ? `, expected at least ${mm(item.expectedMm)}` : ''}`
          + (item.label ? ` (${item.label})` : item.text ? quote(item.text) : ` (${KINDS[item.kind]})`)));
      }
      const smallest = row.measured.smallest;
      return [smallest ? `closest content ${mm(smallest.mm)} from the ${smallest.side} edge, page ${smallest.page}` : 'no content measured'];
    }
  }
}

function ruleLines(row: DocumentRuleCheckRow): string[] {
  if (!row.rule) return [];
  const sources = row.rule.sources.map((source) => (source.page ? `${source.path}, p. ${source.page}` : source.path));
  const state = row.rule.status && row.rule.status !== 'confirmed' ? ` (${row.rule.status})` : '';
  return [
    row.rule.origin === 'blockout' ? 'Rule: the Blockout safe margin' : `Rule: "${row.rule.text}"${state}`,
    sources.length ? `Source: ${sources.join('; ')}` : 'Source: set in the project setup, no document cited',
  ];
}

export function formatDocumentRuleCheck(check: DocumentRuleCheck): string {
  const warnings = check.rows.filter((row) => row.status === 'warning').length;
  const unchecked = check.rows.filter((row) => row.status === 'unchecked').length;
  const lines = [
    `Rule check for ${check.fileName}: ${plural(check.pages, 'page')}, ${warnings ? plural(warnings, 'warning') : 'no warnings'}`
      + `${unchecked ? `, ${unchecked} unchecked` : ''} (export is not blocked)`,
  ];
  if (check.unreadStylesheets) {
    lines.push(`${plural(check.unreadStylesheets, 'stylesheet')} could not be read; the print may differ from what was measured.`);
  }
  lines.push('');
  for (const row of check.rows) {
    const head = `  ${row.status.padEnd(10)} ${LABELS[row.kind].padEnd(14)} `;
    const indent = ' '.repeat(head.length);
    const [measured = '', ...rest] = summary(row);
    const first = row.status !== 'unchecked' ? measured
      : row.rule ? `${measured}; the rule states no value to measure` : `no rule; measured ${measured}`;
    lines.push(head + first, ...rest.map((line) => indent + line), ...ruleLines(row).map((line) => indent + line));
  }
  return lines.join('\n');
}
