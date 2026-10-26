import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent } from '@open-design/contracts';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import type { ShellItem, TurnBlock } from '../../../src/runtime/chat/contract';
const KEY = 'first-run-key';
const FORM = '<question-form id="confirm">{"questions":[{"id":"answer","type":"text","label":"Is this brief correct?"}]}</question-form>';
const RECAP = 'Resolved brief: A3, eight pages. Source: disciplinare.pdf, p. 7.\n';
const key = (value = KEY): PersistedAgentEvent => ({ kind: 'done_key', key: value });
const text = (value: string): PersistedAgentEvent => ({ kind: 'text', text: value });
const tool = (id = 'read-1'): PersistedAgentEvent[] => [{ kind: 'tool_use', id, name: 'Read', input: { file_path: 'disciplinare.pdf' } }, { kind: 'tool_result', toolUseId: id, content: 'Internal extraction output', isError: false }];
const plain = (blocks: TurnBlock[]) => blocks.flatMap((block) => block.kind === 'prose' ? [block.text] : []);
function inside(blocks: TurnBlock[]): string {
  function walk(items: ShellItem[]): string[] { return items.flatMap((item): string[] => item.kind === 'text' ? [item.text] : item.kind === 'todo' ? walk(item.segment.items) : []); }
  return blocks.flatMap((block) => block.kind === 'shell' ? walk(block.items) : []).join('\n');
}
describe('terminal question-preface visibility with collapsed execution', () => {
  it('lifts only the adjacent final prose before a real question while thinking and earlier process stay inside', () => {
    const events: PersistedAgentEvent[] = [key(), { kind: 'thinking', text: 'Private reasoning' }, text('Earlier process note'), ...tool(), text(RECAP + FORM)];
    const blocks = buildTurnBlocks({ events, runStatus: 'succeeded' });
    expect(plain(blocks)).toEqual([RECAP + FORM]);
    expect(inside(blocks)).toContain('Private reasoning'); expect(inside(blocks)).toContain('Earlier process note');
    expect(inside(blocks)).not.toContain(RECAP); expect(plain(blocks).join('')).not.toContain('Private reasoning');
  });
  it('does not move streamed prose until the terminal boundary, then lifts it once across delta splits', () => {
    const events: PersistedAgentEvent[] = [key(), ...tool(), text(RECAP), text(FORM.slice(0, 15)), text(FORM.slice(15))];
    const live = buildTurnBlocks({ events, runStatus: 'running' });
    expect(inside(live)).toContain(RECAP); expect(plain(live)).toEqual([FORM]);
    const done = buildTurnBlocks({ events, runStatus: 'succeeded' });
    expect(plain(done)).toEqual([RECAP + FORM]); expect(inside(done)).not.toContain(RECAP);
  });
  it('keeps the recap visible for a completed legacy native stream without an authenticated done key', () => {
    const events: PersistedAgentEvent[] = [{ kind: 'thinking', text: 'Private legacy reasoning' }, ...tool(), text(RECAP + FORM)];
    const blocks = buildTurnBlocks({ events, runStatus: 'succeeded' });
    expect(plain(blocks)).toEqual([RECAP + FORM]);
    expect(inside(blocks)).toContain('Private legacy reasoning');
    expect(inside(blocks)).not.toContain(RECAP);
  });
  it('lifts a question recap from the current task without exposing its other contents', () => {
    const events: PersistedAgentEvent[] = [key(), { kind: 'tool_use', id: 'plan', name: 'TodoWrite', input: { todos: [{ content: 'Read context', status: 'in_progress' }] } }, { kind: 'thinking', text: 'Task reasoning' }, ...tool(), text(RECAP + FORM)];
    const blocks = buildTurnBlocks({ events, runStatus: 'succeeded' });
    expect(plain(blocks)).toEqual([RECAP + FORM]); expect(inside(blocks)).toContain('Task reasoning');
  });
  it.each(['<question-form id="unfinished">{"questions":', '<question-form>not JSON</question-form>'])('does not lift prose before an incomplete or invalid form: %s', (form) => {
    const blocks = buildTurnBlocks({ events: [key(), ...tool(), text(RECAP + form)], runStatus: 'succeeded' });
    expect(inside(blocks)).toContain(RECAP); expect(plain(blocks)).not.toContain(RECAP);
  });
  it('keeps code-fenced protocol examples masked before the authenticated conclusion', () => {
    const example = `Protocol example:\n\n\`\`\`html\n${FORM}\n\`\`\`\n`;
    const blocks = buildTurnBlocks({ events: [key(), text(example), text(`<od-done key="${KEY}"/>Actual answer`)], runStatus: 'succeeded' });
    expect(inside(blocks)).toContain(example); expect(plain(blocks)).toEqual(['Actual answer']);
  });
  it('finalizes the adjacent recap within its own physical run, before the following run’s answer', () => {
    const blocks = buildTurnBlocks({ events: [key(), ...tool(), text(RECAP + FORM), key('second-run-key'), ...tool('read-2'), text('<od-done key="second-run-key"/>Second answer')], runStatus: 'succeeded' });
    expect(plain(blocks)).toEqual([RECAP + FORM, 'Second answer']); expect(inside(blocks)).not.toContain(RECAP);
    expect(blocks.filter((block) => block.kind === 'shell')).toHaveLength(2);
  });
  it('does not change the artifact-preface boundary', () => {
    const artifact = '<artifact identifier="result" type="text/html" title="Result"><html></html></artifact>';
    const blocks = buildTurnBlocks({ events: [key(), ...tool(), text(RECAP + artifact)], runStatus: 'succeeded' });
    expect(inside(blocks)).toContain(RECAP); expect(plain(blocks)).toEqual([artifact]);
  });
});
