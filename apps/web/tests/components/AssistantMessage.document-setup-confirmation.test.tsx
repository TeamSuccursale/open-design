// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderDocumentSetupConfirmationForm } from '@open-design/contracts';
import { AssistantMessage } from '../../src/components/AssistantMessage';
import { I18nProvider } from '../../src/i18n';
import type { ChatMessage } from '../../src/types';

beforeAll(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
});
afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks(); });

describe('host brief confirmation form', () => {
  // Accepting it saves the brief and seeds every document's pages before the Blockout request starts.
  it('says what it is doing while the host confirms the brief', async () => {
    const text = renderDocumentSetupConfirmationForm();
    const message = { id: 'confirmation', role: 'assistant', content: text, startedAt: 1700000000, endedAt: 1700000005, events: [{ kind: 'text', text }] } as ChatMessage;
    const onSubmit = vi.fn(() => new Promise<boolean>(() => undefined));
    const view = render(<I18nProvider initial="it"><AssistantMessage message={message} streaming={false} projectId="project" conversationId="conversation" isLast onSubmitQuestionForm={onSubmit} /></I18nProvider>);
    const controls = within(view.container);
    fireEvent.click(controls.getByRole('radio', { name: 'Sì, confermo il brief' }));
    fireEvent.click(controls.getByRole('radio', { name: 'Tre strutture complete per ogni documento' }));
    fireEvent.click(view.container.querySelector('.qf-primary-action')!);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(controls.getByRole('status')).toHaveTextContent('Registro il brief e preparo le pagine…');
    expect(view.container.querySelector('.qf-primary-action')).toHaveTextContent('Registro il brief e preparo le pagine…');
  });
});
