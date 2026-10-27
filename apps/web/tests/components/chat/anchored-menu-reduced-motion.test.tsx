// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnchoredMenuShell } from '../../../src/components/chat/AnchoredMenuShell';

// Under `prefers-reduced-motion` (Windows with animation effects off) base.css gives every element a 0.01ms
// transition, so a new `left` on the menu's wrapper is laid out only on the next frame. The toolbar's Export and
// Share menus then opened off the right edge of the window, as if the buttons did nothing.

const ANCHOR = new DOMRect(1253, 51, 100, 30);
const MENU_WIDTH = 248;

let restoreRect: typeof HTMLElement.prototype.getBoundingClientRect;
let restoreComputed: typeof window.getComputedStyle;
let frames: FrameRequestCallback[];
// Where each wrapper is laid out right now: inline styles reach it only when a frame is painted.
let laidOut: Map<HTMLElement, { left: number; width: number }>;

const inline = (el: HTMLElement) => ({
  left: Number.parseFloat(el.style.left) || 0,
  width: Number.parseFloat(el.style.width) || 0,
});
function layoutOf(el: HTMLElement) {
  if (!laidOut.has(el)) laidOut.set(el, inline(el));
  return laidOut.get(el)!;
}
function frame() {
  const callbacks = frames;
  frames = [];
  for (const callback of callbacks) callback(performance.now());
  for (const el of laidOut.keys()) laidOut.set(el, inline(el));
}

beforeEach(() => {
  frames = [];
  laidOut = new Map();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  restoreRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.getAttribute('role') !== 'menu') return restoreRect.call(this);
    const host = layoutOf(this.parentElement as HTMLElement);
    return new DOMRect(host.left + host.width - MENU_WIDTH, ANCHOR.bottom + 6, MENU_WIDTH, 172);
  };
  restoreComputed = window.getComputedStyle;
  window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
    const style = restoreComputed.call(window, el, pseudo);
    if (!(el instanceof HTMLElement) || !el.hasAttribute('data-anchored-menu')) return style;
    const box = layoutOf(el);
    return new Proxy(style, {
      get(target, key) {
        if (key === 'left') return `${box.left}px`;
        if (key === 'width') return `${box.width}px`;
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }) as typeof window.getComputedStyle;
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-artifact-anchor]').forEach((anchor) => anchor.remove());
  HTMLElement.prototype.getBoundingClientRect = restoreRect;
  window.getComputedStyle = restoreComputed;
  vi.unstubAllGlobals();
});

it('opens the menu under its button when the wrapper reaches its place a frame late', () => {
  const anchor = document.createElement('button');
  anchor.setAttribute('data-artifact-anchor', 'toolbar');
  anchor.getBoundingClientRect = () => ANCHOR;
  document.body.appendChild(anchor);
  render(<AnchoredMenuShell anchorId="toolbar" className="" wrapperClassName="" testId="toolbar-menu">Esporta in PDF</AnchoredMenuShell>);
  for (let i = 0; i < 3; i++) act(() => { frame(); });
  const menu = screen.getByTestId('toolbar-menu').getBoundingClientRect();
  expect(menu.right).toBe(ANCHOR.right);
  expect(menu.right).toBeLessThanOrEqual(window.innerWidth);
});
