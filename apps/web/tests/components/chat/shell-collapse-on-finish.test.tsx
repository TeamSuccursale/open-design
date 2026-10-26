// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { I18nProvider } from '../../../src/i18n';
import { en } from '../../../src/i18n/locales/en';
import { ExecutionShell } from '../../../src/components/chat/ExecutionShell';
import type { ExecutionShell as Shell } from '../../../src/runtime/chat/contract';
afterEach(cleanup);
const shellOf = (over: Partial<Shell> = {}): Shell => ({ kind: 'shell', id: 'shell-1', status: 'running', thinking: false, stopped: false, elapsedMs: 12000, quietMs: null, segments: [], items: [{ kind: 'text', text: 'Process detail' }], ...over });
const show = (shell: Shell) => <I18nProvider initial="en"><ExecutionShell shell={shell} /></I18nProvider>;
const outer = (root: HTMLElement) => root.querySelector('details')!;
function toggle(el: HTMLDetailsElement) { fireEvent.click(el.querySelector('summary')!); fireEvent(el, new Event('toggle')); }
describe('D53 execution shell disclosure', () => {
  it.each([
    [{ status: 'running' }, 'chat.record.running'], [{ status: 'done' }, 'chat.record.done'],
    [{ status: 'failed' }, 'chat.record.failedTurn'], [{ status: 'done', stopped: true }, 'chat.record.canceled'],
  ] as const)('starts closed with the actual status visible: %j', (state, key) => {
    const { container } = render(show(shellOf(state)));
    expect(outer(container).open).toBe(false);
    expect(outer(container).querySelector('summary')?.textContent).toContain(en[key as keyof typeof en]);
    expect(container.textContent).not.toContain('Process detail');
  });
  it('stays collapsed when live output and terminal status arrive', () => {
    const { container, rerender } = render(show(shellOf()));
    rerender(show(shellOf({ items: [{ kind: 'text', text: 'Growing output' }] })));
    expect(outer(container).open).toBe(false);
    rerender(show(shellOf({ status: 'failed' }))); expect(outer(container).open).toBe(false);
  });
  it('preserves manual expansion through output, completion and failure', () => {
    const { container, rerender } = render(show(shellOf())); const shell = outer(container); toggle(shell);
    expect(shell.open).toBe(true); expect(container.textContent).toContain('Process detail');
    for (const status of ['running', 'done', 'failed'] as const) {
      rerender(show(shellOf({ status, elapsedMs: 13000 }))); expect(outer(container)).toBe(shell); expect(shell.open).toBe(true);
    }
  });
  it('preserves manual collapse when the run resumes or is stopped', () => {
    const { container, rerender } = render(show(shellOf())); const shell = outer(container); toggle(shell); toggle(shell);
    rerender(show(shellOf({ stopped: true }))); expect(shell.open).toBe(false);
    rerender(show(shellOf({ status: 'running' }))); expect(shell.open).toBe(false);
  });
});
