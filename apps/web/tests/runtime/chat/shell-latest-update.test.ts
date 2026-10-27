/**
 * MelilloDesign (D54): the line a running execution record shows after «In corso».
 *
 * In the night run of 27 October every turn lasted four to six minutes and the chat showed only
 * «In corso» and a timer, while the agent was narrating each step in the collapsed record. The
 * shells below come from real event shapes through `buildTurnBlocks`, as in `execution-shell.test.tsx`.
 */
import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent } from '@open-design/contracts';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import type { ExecutionShell } from '../../../src/runtime/chat/contract';
import { shellLatestUpdate } from '../../../src/runtime/chat/shell-latest-update';

// The running one: a plan opens a second record and the first one closes (D29).
function shell(events: PersistedAgentEvent[]): ExecutionShell {
  const found = buildTurnBlocks({ events, runStatus: 'running', nowMs: 60_000 }).filter((block): block is ExecutionShell => block.kind === 'shell').at(-1);
  if (!found) throw new Error('no shell');
  expect(found.status).toBe('running');
  return found;
}
const bash = (id: string, command: string): PersistedAgentEvent[] => [
  { kind: 'tool_use', id, name: 'Bash', input: { command } },
  { kind: 'tool_result', toolUseId: id, content: 'ok', isError: false },
];
const todos = (id: string, items: Array<[string, string]>): PersistedAgentEvent => (
  { kind: 'tool_use', id, name: 'TodoWrite', input: { todos: items.map(([content, status]) => ({ content, status })) } });

describe('shellLatestUpdate', () => {
  it('repeats the first sentence of the latest narration, without its markdown', () => {
    expect(shellLatestUpdate(shell([
      { kind: 'text', text: '\nControllo quali elaborati prevedono i materiali. Poi ti propongo le scelte.' },
      ...bash('a', 'ls'),
      { kind: 'text', text: 'Il **disciplinare** prevede per il criterio B un elaborato A4 di massimo 8 pagine. Il testo è in `estratto.txt`.' },
      ...bash('b', 'cat estratto.txt'),
    ]))).toBe('Il disciplinare prevede per il criterio B un elaborato A4 di massimo 8 pagine.');
  });

  it('names the plan step under way when nothing was said since it began', () => {
    expect(shellLatestUpdate(shell([
      { kind: 'text', text: 'Controllo i materiali.' },
      todos('p1', [['Accertare gli elaborati e i vincoli', 'completed'], ['Proporre le scelte editoriali', 'pending']]),
      ...bash('a', 'ls'),
    ]))).toBe('Proporre le scelte editoriali');
  });

  it('prefers what the agent said inside the step under way', () => {
    expect(shellLatestUpdate(shell([
      todos('p1', [['Accertare gli elaborati e i vincoli', 'in_progress'], ['Proporre le scelte editoriali', 'pending']]),
      ...bash('a', 'ls'),
      { kind: 'text', text: 'La tabella conferma Arial 11 e interlinea 1,5 per la relazione A4.' },
    ]))).toBe('La tabella conferma Arial 11 e interlinea 1,5 per la relazione A4.');
  });

  it('never shows the reasoning, and says nothing when there is nothing to say', () => {
    expect(shellLatestUpdate(shell([{ kind: 'thinking', text: '**Planning tool usage**\n\nI need to read the files.' }, ...bash('a', 'ls')]))).toBeNull();
  });

  it('cuts a long sentence at a word with an ellipsis', () => {
    const sentence = `Preparo tre strutture complete per ciascun elaborato ${'conservando le fasce già applicate '.repeat(6)}e distinguendo le pagine`;
    const line = shellLatestUpdate(shell([{ kind: 'text', text: sentence }, ...bash('a', 'ls')]))!;
    expect(line.length).toBeLessThanOrEqual(141);
    expect(line.endsWith('…')).toBe(true);
    expect(sentence.startsWith(line.slice(0, -1))).toBe(true);
    expect(line.at(-2)).not.toBe(' ');
  });
});
