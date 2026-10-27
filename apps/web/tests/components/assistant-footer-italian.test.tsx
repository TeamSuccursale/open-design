// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AssistantFooter } from '../../src/components/AssistantMessage';
import { I18nProvider } from '../../src/i18n';

afterEach(cleanup);

describe('Italian turn status with unfinished items', () => {
  // Flow run 2 (27 October): the header/footer turn ended with one open step and read
  // "restano ancora 1 elementi da completare".
  it.each([1, 3])('reads correctly with %i open item(s)', (n) => {
    render(<I18nProvider initial="it"><AssistantFooter streaming={false} hasUnfinishedTodos unfinishedTodoCount={n} hasEmptyResponse={false} /></I18nProvider>);
    const detail = screen.getByTestId('assistant-label-detail').textContent ?? '';
    expect(detail).toContain(String(n));
    expect(detail).not.toMatch(/\b1 elementi\b/);
  });
});
