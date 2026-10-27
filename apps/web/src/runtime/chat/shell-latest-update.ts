/**
 * MelilloDesign (D54): the one line a running execution record adds after «In corso».
 *
 * The record starts collapsed (D53) and the agent's narration lives inside it (D43), so a turn of four
 * to six minutes showed only «In corso» and a timer while the agent was writing sentences such as «Il
 * disciplinare prevede per il criterio B un elaborato A4 di massimo 8 pagine». The header now repeats
 * the first sentence of the latest narration, or names the plan step under way when nothing was said
 * since it began. These are the agent's own words: reasoning (`thinking`) never reaches this line.
 */
import type { ExecutionShell, ShellItem } from './contract';

const LIMIT = 140;
// A sentence ends before a capital, a quote or the end; «p. 37» and «B.1» do not end one.
const SENTENCE_END = /[.!?…](?=\s+[A-ZÀ-ÖØ-Þ«"“(]|\s*$)/;

export function shellLatestUpdate(shell: Pick<ExecutionShell, 'items'>): string | null {
  let latest: string | null = null;
  const visit = (items: readonly ShellItem[]) => {
    for (const item of items) {
      if (item.kind === 'text' && !item.thinking) latest = narrationLine(item.text) ?? latest;
      else if (item.kind === 'todo') {
        if (item.segment.status === 'in_progress' && !item.segment.abandoned) latest = clip(plain(item.segment.content)) || latest;
        visit(item.segment.items);
      }
    }
  };
  visit(shell.items);
  return latest;
}

function narrationLine(text: string): string | null {
  // A question form streams as text too; only the prose before it is narration.
  const prose = text.split(/<question-form\b/)[0]!.replace(/```[\s\S]*?(?:```|$)/g, ' ');
  for (const raw of prose.split('\n')) {
    const line = plain(raw);
    if (!line || raw.trim().startsWith('|')) continue;
    const end = SENTENCE_END.exec(line);
    return clip(end ? line.slice(0, end.index + 1) : line);
  }
  return null;
}

function plain(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\s][^*]*)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(line: string): string {
  if (line.length <= LIMIT) return line;
  const cut = line.slice(0, LIMIT), space = cut.lastIndexOf(' ');
  return `${(space > LIMIT / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, '')}…`;
}
