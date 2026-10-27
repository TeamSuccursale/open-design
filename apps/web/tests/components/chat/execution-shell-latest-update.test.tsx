// @vitest-environment jsdom
/**
 * MelilloDesign (D54): a running record keeps «In corso» and stays collapsed (D53), and its header
 * adds the agent's latest sentence on the same line, so a turn of several minutes is not silent.
 */
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { PersistedAgentEvent } from '@open-design/contracts';
import { I18nProvider } from '../../../src/i18n';
import { ExecutionShell } from '../../../src/components/chat/ExecutionShell';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import type { ExecutionShell as Shell } from '../../../src/runtime/chat/contract';

afterEach(() => { cleanup(); });

const events: PersistedAgentEvent[] = [
  { kind: 'text', text: 'Il disciplinare prevede per il criterio B un elaborato A4 di massimo 8 pagine. Verifico il resto.' },
  { kind: 'tool_use', id: 'a', name: 'Bash', input: { command: 'ls' } },
  { kind: 'tool_result', toolUseId: 'a', content: 'ok', isError: false },
];
function head(runStatus: 'running' | 'succeeded') {
  const shell = buildTurnBlocks({ events, runStatus, nowMs: 60_000 }).find((block): block is Shell => block.kind === 'shell')!;
  render(<I18nProvider initial="it"><ExecutionShell shell={shell} deferCollapsedBodies={false} /></I18nProvider>);
  return document.querySelector('details > summary')!;
}

it('shows the latest sentence after «In corso» while the record stays collapsed', () => {
  const summary = head('running');
  expect(summary.textContent).toContain('In corso');
  const update = summary.querySelector('[data-testid="chat-record-latest-update"]');
  expect(update?.textContent).toBe('Il disciplinare prevede per il criterio B un elaborato A4 di massimo 8 pagine.');
  expect(update?.getAttribute('title')).toBe(update?.textContent);
  expect(document.querySelector('details')!.open).toBe(false);
});

it('drops the sentence once the turn is over', () => {
  const summary = head('succeeded');
  expect(summary.querySelector('[data-testid="chat-record-latest-update"]')).toBeNull();
});
