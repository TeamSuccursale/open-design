// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPane } from '../../src/components/ChatPane';
import { AssistantMessage } from '../../src/components/AssistantMessage';
import { I18nProvider } from '../../src/i18n';
import type { ChatMessage } from '../../src/types';

vi.mock('../../src/components/ChatComposer', () => ({ ChatComposer: forwardRef(() => null) }));
vi.mock('../../src/components/chat/ProjectIntakeProgress', () => ({ ProjectIntakeProgress: () => null }));
let occurrence = 0;
beforeEach(() => { vi.useFakeTimers(); occurrence += 1; });
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });

function question(blockout = false): ChatMessage {
  const content = `<question-form id="document-purpose" title="Document purpose">${JSON.stringify({
    submitLabel: 'Confirm document purpose',
    ...(blockout ? { blockoutTarget: { pageId: 'page-1', blockId: 'block-1' } } : {}),
    questions: [{ id: 'purpose', type: 'text', label: 'What should this document communicate?', required: true }],
  })}</question-form>`;
  return { id: `preparation-question-${occurrence}`, role: 'assistant', content, createdAt: 1000, startedAt: 1000, endedAt: 2000, runStatus: 'succeeded', events: [{ kind: 'text', text: content }] };
}
function pane(messages: ChatMessage[], pending: boolean, onSubmit: ComponentProps<typeof ChatPane>['onSubmitQuestionForm']) {
  return <I18nProvider initial="en"><ChatPane messages={messages} streaming={false} error={null} projectId="project" projectFiles={[]} documentPreparationPending={pending} onEnsureProject={async () => 'project'} onSend={vi.fn()} onStop={vi.fn()} conversations={[]} activeConversationId="conversation" onSelectConversation={vi.fn()} onDeleteConversation={vi.fn()} onSubmitQuestionForm={onSubmit} /></I18nProvider>;
}
async function passTime(milliseconds: number) { await act(async () => { vi.advanceTimersByTime(milliseconds); await Promise.resolve(); }); }

describe('document preparation waits for the user', () => {
  it('has no countdown or automatic answer after ten minutes, and accepts a real answer through the existing form', async () => {
    const onSubmit = vi.fn(async (_text: string) => true);
    render(pane([question()], true, onSubmit));
    expect(screen.queryByLabelText(/Auto-continues when the timer ends/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirm document purpose' }).hasAttribute('disabled')).toBe(true);
    await passTime(20 * 60 * 1000);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Explain the survey findings to the client' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm document purpose' })); await Promise.resolve(); });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0]?.[0]).toContain('Explain the survey findings to the client');
  });

  it('preserves ordinary chat timeout continuation', async () => {
    const onSubmit = vi.fn(async (_text: string) => true);
    render(pane([question()], false, onSubmit));
    expect(screen.getByLabelText(/Auto-continues when the timer ends 10:00/)).toBeTruthy();
    await passTime(10 * 60 * 1000);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0]?.[0]).toContain('(skipped)');
  });

  it('removes an already-running timer when only the memoized assistant timeout policy changes', async () => {
    const message = question(), onSubmit = vi.fn(async () => true);
    const view = (enabled: boolean) => <I18nProvider initial="en"><AssistantMessage message={message} streaming={false} isLast projectId="project" conversationId="conversation" onSubmitQuestionForm={onSubmit} questionFormAutoContinueAfterTimeout={enabled} /></I18nProvider>;
    const { rerender } = render(view(true));
    expect(screen.getByLabelText(/Auto-continues when the timer ends/)).toBeTruthy();
    await passTime(9 * 60 * 1000);
    rerender(view(false));
    expect(screen.queryByLabelText(/Auto-continues when the timer ends/)).toBeNull();
    await passTime(20 * 60 * 1000);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps explicit blockout questions free of timeout even outside preparation', async () => {
    const onSubmit = vi.fn(async () => true);
    render(<I18nProvider initial="en"><AssistantMessage message={question(true)} streaming={false} isLast projectId="project" conversationId="conversation" onSubmitQuestionForm={onSubmit} /></I18nProvider>);
    expect(screen.queryByLabelText(/Auto-continues when the timer ends/)).toBeNull();
    await passTime(10 * 60 * 1000);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
