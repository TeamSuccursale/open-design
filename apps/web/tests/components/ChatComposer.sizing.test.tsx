// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatComposer } from '../../src/components/ChatComposer';
import { I18nProvider } from '../../src/i18n';
import { composerText, flushMounts, typeAndSettle } from '../helpers/lexical-composer';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
function setup(activeFile: string | null = null) {
  const onSend = vi.fn();
  const element = (file: string | null) => <I18nProvider initial="en"><ChatComposer projectId="compact-project" projectFiles={[]} activeProjectFileName={file} streaming={false} onEnsureProject={async () => 'compact-project'} onSend={onSend} onStop={vi.fn()} /></I18nProvider>;
  const view = render(element(activeFile));
  return { onSend, ...view, selectFile: (file: string | null) => view.rerender(element(file)) };
}
function resize() {
  const input = screen.getByTestId('chat-composer-input');
  vi.spyOn(input.parentElement!, 'getBoundingClientRect').mockReturnValue({ height: 48 } as DOMRect);
  fireEvent.mouseDown(screen.getByTestId('composer-editor-shell'), { button: 0, clientY: 500 });
  fireEvent.mouseMove(window, { clientY: 350 });
  fireEvent.mouseUp(window);
}

describe('content-sized chat composer', () => {
  it('keeps an empty textbox content-sized when focused or given an active file', async () => {
    const view = setup(); await flushMounts();
    fireEvent.focus(screen.getByTestId('chat-composer-input'));
    view.selectFile('report.html');
    expect(screen.getByTestId('chat-composer')).toHaveAttribute('data-draft-empty', 'true');
    expect(screen.getByTestId('chat-composer')).toHaveAttribute('data-editor-sizing', 'content');
    resize();
    expect(screen.getByTestId('chat-composer')).toHaveAttribute('data-editor-sizing', 'content');
  });
  it('preserves deliberate resizing while drafting, then returns to content sizing after clearing', async () => {
    setup('report.html'); await flushMounts(); await typeAndSettle('Draft page feedback');
    resize();
    expect(screen.getByTestId('chat-composer')).toHaveAttribute('data-editor-sizing', 'manual');
    await typeAndSettle('Draft page feedback\nWith another paragraph');
    expect(screen.getByTestId('chat-composer')).toHaveAttribute('data-editor-sizing', 'manual');
    await typeAndSettle('');
    expect(screen.getByTestId('chat-composer')).toHaveAttribute('data-editor-sizing', 'content');
    await typeAndSettle('A new short draft');
    expect(screen.getByTestId('chat-composer')).toHaveAttribute('data-editor-sizing', 'content');
  });
  it('clears a manually resized draft on submit and lets the next draft grow naturally', async () => {
    const view = setup('report.html'); await flushMounts(); await typeAndSettle('Ready to submit'); resize();
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(view.onSend).toHaveBeenCalledOnce());
    await waitFor(() => expect(composerText().trim()).toBe(''));
    expect(screen.getByTestId('chat-composer')).toHaveAttribute('data-editor-sizing', 'content');
    await typeAndSettle('Next draft');
    expect(screen.getByTestId('chat-composer')).toHaveAttribute('data-editor-sizing', 'content');
  });
});
