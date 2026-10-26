// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../src/i18n';
import { ToolRow } from '../../../src/components/chat/primitives/ToolRow';
import type { ToolRow as ToolRowData } from '../../../src/runtime/chat/contract';
afterEach(cleanup);
const row = (over: Partial<ToolRowData> = {}): ToolRowData => ({ kind: 'tool', id: 'tool-1', tool: 'exec', name: 'Bash', title: 'Install dependencies', rawTitle: false, file: null, pattern: null, hits: null, delta: null, elapsedMs: 4100, pending: true, failed: false, failReason: null, command: 'pnpm install', terminal: 'Packages: +37', ...over });
const show = (value: ToolRowData, running: boolean) => <I18nProvider initial="en"><ToolRow row={value} running={running} /></I18nProvider>;
function toggle(el: HTMLDetailsElement) { fireEvent.click(el.querySelector('summary')!); fireEvent(el, new Event('toggle')); }
describe('D53 tool disclosure across lifecycle states', () => {
  it.each([false, true])('keeps described and raw commands collapsed while running: raw=%s', (rawTitle) => {
    const { container } = render(show(row({ rawTitle }), true));
    expect(container.querySelector('details')?.open).toBe(false);
    expect(container.textContent).not.toContain('Packages: +37'); expect(container.textContent).toContain('4.1s');
  });
  it('does not expand when a tool result fails, but keeps failure status visible', () => {
    const { container, rerender } = render(show(row(), true));
    rerender(show(row({ pending: false, failed: true, terminal: 'Command failed' }), false));
    expect(container.querySelector('details')?.open).toBe(false); expect(screen.getByText('Failed')).toBeTruthy();
    expect(container.textContent).not.toContain('Command failed');
  });
  it('preserves manual expansion through output updates and a stopped run', () => {
    const { container, rerender } = render(show(row(), true)); const fold = container.querySelector('details')!; toggle(fold);
    expect(fold.open).toBe(true); expect(container.textContent).toContain('Packages: +37');
    rerender(show(row({ terminal: 'Packages: +38' }), true)); expect(fold.open).toBe(true); expect(container.textContent).toContain('Packages: +38');
    rerender(show(row(), false)); expect(fold.open).toBe(true);
  });
  it('preserves manual collapse through failure and later status updates', () => {
    const { container, rerender } = render(show(row(), true)); const fold = container.querySelector('details')!; toggle(fold); toggle(fold);
    rerender(show(row({ pending: false, failed: true }), false)); expect(fold.open).toBe(false);
    rerender(show(row({ pending: false, failed: false }), false)); expect(fold.open).toBe(false);
  });
});
