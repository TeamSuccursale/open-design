// @vitest-environment jsdom
// D53 supersedes automatic task expansion: disclosure is always user controlled.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nProvider } from '../../../src/i18n';
import { ExecutionShell } from '../../../src/components/chat/ExecutionShell';
import type {
  ExecutionShell as Shell,
  ShellItem,
  TodoStatus,
} from '../../../src/runtime/chat/contract';

afterEach(cleanup);

const tool = (id: string): ShellItem => ({
  kind: 'tool', id, tool: 'read', title: `读取 ${id}`, name: 'Read', rawTitle: false,
  file: null, delta: null, hits: null, pattern: null, elapsedMs: 400,
  failed: false, failReason: null, command: null, terminal: null,
} as ShellItem);

/**
 * 同一条 todo 的两个相位。**内容和位置一个字都不变** —— 这是这条测试的前提:
 * key 不变 = 同一个 React 实例,`defaultOpen` 因此救不了。
 */
const shellOf = (status: TodoStatus): Shell => ({
  kind: 'shell', id: 'shell-1', status: status === 'in_progress' ? 'running' : 'done',
  thinking: false, stopped: false, elapsedMs: 12_000, quietMs: null,
  segments: [],
  items: [{
    kind: 'todo',
    segment: {
      content: '复刻商品列表页',
      status,
      recalled: false,
      abandoned: false,
      implicit: false,
      items: [tool('a.png'), tool('b.png')],
      elapsedMs: 18_200,
    },
  } as ShellItem],
});

const show = (shell: Shell): ReactElement => (
  <I18nProvider initial="zh-CN"><ExecutionShell shell={shell} deferCollapsedBodies={false} /></I18nProvider>
);

/** 抽屉那一层:壳是 `details.flat`,todo 抽屉是它里面那只 */
const drawer = (root: HTMLElement): HTMLDetailsElement => {
  const el = root.querySelector<HTMLDetailsElement>('details[class*="flat"] details[class*="stepRow"]');
  if (!el) throw new Error('todo 抽屉没渲染出来');
  return el;
};

/** 浏览器在 `open` 属性被写回时派发的那一次 —— 不是用户点的 */
const echoToggle = (el: HTMLDetailsElement): void => {
  fireEvent(el, new Event('toggle', { bubbles: false }));
};

describe('D53 task drawer disclosure', () => {
  it('starts collapsed while the task is running and stays collapsed on completion', () => {
    const { container, rerender } = render(show(shellOf('in_progress')));
    expect(drawer(container).open).toBe(false); rerender(show(shellOf('completed')));
    expect(drawer(container).open).toBe(false);
  });
  it('preserves a manually opened drawer across task completion', () => {
    const { container, rerender } = render(show(shellOf('in_progress'))); const el = drawer(container);
    fireEvent.click(el.querySelector('summary')!); echoToggle(el); expect(el.open).toBe(true);
    rerender(show(shellOf('completed'))); expect(drawer(container)).toBe(el); expect(el.open).toBe(true);
  });
  it('preserves manual collapse when a task returns to running', () => {
    const { container, rerender } = render(show(shellOf('completed'))); const el = drawer(container);
    fireEvent.click(el.querySelector('summary')!); echoToggle(el);
    fireEvent.click(el.querySelector('summary')!); echoToggle(el);
    rerender(show(shellOf('in_progress'))); expect(drawer(container).open).toBe(false);
  });
});
