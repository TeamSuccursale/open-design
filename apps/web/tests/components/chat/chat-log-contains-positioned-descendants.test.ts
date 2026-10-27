/**
 * The chat log must be the positioning box for what it scrolls.
 *
 * Screen-reader spans inside `.chat-log` are absolutely positioned. With the log
 * `position: static`, their containing block was `.chat-log-viewport`, outside
 * the scroll container, so they escaped its clip and grew the chat pane's
 * scrollable overflow (5,552 px against 800 measured live). The pane has
 * `overflow: hidden`, which still allows programmatic scrolling: a focus or
 * scroll-into-view inside the log slid the whole pane, pushed the status bar
 * above the top and left the portalled composer covering a form's
 * "Invia risposte". With the log positioned, the same page measured 800 px and
 * scroll-into-view left the pane still.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const chatCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/styles/chat.css'), 'utf-8');

describe('chat log containing block', () => {
  it('positions the scrolling log so absolutely positioned rows stay inside its clip', () => {
    const rule = /(?:^|\n)\.chat-log \{([^}]*)\}/.exec(chatCss)?.[1] ?? '';
    expect(rule).toContain('overflow-y: auto');
    expect(rule).toMatch(/position:\s*relative/);
  });
});
