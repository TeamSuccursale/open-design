// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AssistantMessage } from '../../src/components/AssistantMessage';
import { QuestionFormView } from '../../src/components/QuestionForm';
import { pendingHeaderFooterQuestion } from '../../src/components/header-footer/events';
import { pendingBlockoutQuestion } from '../../src/components/blockout/events';
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
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('targeted question pending state through AssistantMessage', () => {
  it.each(['header/footer', 'blockout'] as const)('keeps the %s chat and published editor form pending until an explicit refusal', async (targetType) => {
    const projectId = `targeted-pending-${targetType}`;
    const conversationId = 'conversation';
    const target = targetType === 'header/footer'
      ? { headerFooterTarget: { documentId: 'report', region: 'header', blockId: 'logo' } }
      : { blockoutTarget: { documentId: 'report', pageId: 'page-1', blockId: 'figure' } };
    const text = [
      '<question-form id="targeted-pending" title="Targeted question">',
      JSON.stringify({ ...target, submitLabel: 'Send answers', questions: [{ id: 'caption', label: 'Caption', type: 'text', required: true }] }),
      '</question-form>',
    ].join('\n');
    const message = { id: 'targeted-message', role: 'assistant', content: text, startedAt: 1700000000, endedAt: 1700000005, events: [{ kind: 'text', text }] } as ChatMessage;
    let refuse!: (accepted: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>(resolve => { refuse = resolve; }));
    const pending = () => targetType === 'header/footer'
      ? pendingHeaderFooterQuestion(projectId, conversationId)
      : pendingBlockoutQuestion(projectId, conversationId);
    const chat = render(<I18nProvider initial="en"><AssistantMessage message={message} streaming={false} projectId={projectId} conversationId={conversationId} isLast onSubmitQuestionForm={onSubmit} /></I18nProvider>);
    const chatControls = within(chat.container);
    fireEvent.change(chatControls.getByRole('textbox', { name: 'Caption' }), { target: { value: 'Keep the original caption.' } });
    fireEvent.click(chatControls.getByRole('button', { name: 'Send answers' }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(chatControls.getByRole('status')).toHaveTextContent('Submitting…');
    expect(chatControls.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    await vi.waitFor(() => expect(pending()?.props.submitting).toBe(true));
    expect(pending()?.props.submitDisabled).toBe(false);
    expect(pending()?.props.draftAnswers).toEqual({ caption: 'Keep the original caption.' });

    // Consume the exact props published to an already open editor; no mock bridge.
    const pendingProps = pending()!.props;
    const editor = render(<I18nProvider initial="en"><QuestionFormView {...pendingProps} autoContinueAfterTimeout={false} /></I18nProvider>);
    const editorControls = within(editor.container);
    expect(editorControls.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    expect(editorControls.getByRole('status')).toHaveTextContent('Submitting…');
    expect(editorControls.getByRole('status').closest('[aria-busy="true"]')).toBeNull();
    expect(editorControls.queryByTitle('Fill in the required fields first')).toBeNull();
    fireEvent.click(editorControls.getByRole('button', { name: 'Submitting…' }));
    expect(onSubmit).toHaveBeenCalledOnce();

    await act(async () => refuse(false));
    await vi.waitFor(() => expect(pending()?.props.submitting).toBe(false));
    expect(pending()?.props.submitDisabled).toBe(false);
    expect(pending()?.props.draftAnswers).toEqual({ caption: 'Keep the original caption.' });
    expect(chatControls.queryByRole('status')).toBeNull();
    expect(chatControls.getByRole('button', { name: 'Send answers' })).toBeEnabled();
    expect(chatControls.getByRole('textbox', { name: 'Caption' })).toHaveValue('Keep the original caption.');
    editor.rerender(<I18nProvider initial="en"><QuestionFormView {...pending()!.props} autoContinueAfterTimeout={false} /></I18nProvider>);
    expect(editorControls.queryByRole('status')).toBeNull();
    expect(editorControls.getByRole('button', { name: 'Send answers' })).toBeEnabled();
    expect(editorControls.getByRole('textbox', { name: 'Caption' })).toHaveValue('Keep the original caption.');
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
