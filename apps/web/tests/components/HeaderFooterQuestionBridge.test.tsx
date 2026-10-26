// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import { HeaderFooterQuestionBridge } from '../../src/components/header-footer/HeaderFooterQuestionBridge';
import { HEADER_FOOTER_QUESTION_EVENT, type HeaderFooterQuestionEvent } from '../../src/components/header-footer/events';
vi.mock('../../src/components/QuestionForm', () => ({ QuestionFormView: ({ autoContinueAfterTimeout }: { autoContinueAfterTimeout: boolean }) => <div data-testid="native-question" data-timer={String(autoContinueAfterTimeout)} /> }));
afterEach(cleanup);
describe('targeted header/footer questions', () => {
  it('republishes pending-only changes without reopening or enabling timeout continuation', async () => {
    const events: HeaderFooterQuestionEvent[] = [];
    const listener = (event: Event) => events.push((event as CustomEvent<HeaderFooterQuestionEvent>).detail);
    window.addEventListener(HEADER_FOOTER_QUESTION_EVENT, listener);
    const form = { id: 'pending-logo', title: 'Logo position', headerFooterTarget: { documentId: 'report', region: 'header' as const, blockId: 'logo' }, questions: [{ id: 'side', label: 'Side', type: 'text' as const }] };
    const content = (submitting: boolean) => <I18nProvider initial="en"><HeaderFooterQuestionBridge form={form} interactive projectId="pending-project" conversationId="pending-chat" occurrenceKey="pending-only" submitting={submitting} submitDisabled={false} autoContinueAfterTimeout /></I18nProvider>;
    const view = render(content(false));
    await waitFor(() => expect(events.filter(event => !event.clear)).toHaveLength(1));
    expect(events[0]!.open).toBe(true);
    view.rerender(content(true));
    await waitFor(() => expect(events.filter(event => !event.clear)).toHaveLength(2));
    expect(events[1]!.open).toBe(false);
    expect(events[1]!.request.props).toMatchObject({ submitting: true, submitDisabled: false, autoContinueAfterTimeout: false });
    view.rerender(content(false));
    await waitFor(() => expect(events.filter(event => !event.clear)).toHaveLength(3));
    expect(events[2]!.open).toBe(false);
    expect(events[2]!.request.props).toMatchObject({ submitting: false, submitDisabled: false, autoContinueAfterTimeout: false });
    view.unmount();
    window.removeEventListener(HEADER_FOOTER_QUESTION_EVENT, listener);
  });
  it('opens once, updates controlled answers without reopening, and clears the dock on completion', async () => {
    const events: HeaderFooterQuestionEvent[] = []; const listener = (event: Event) => events.push((event as CustomEvent<HeaderFooterQuestionEvent>).detail); window.addEventListener(HEADER_FOOTER_QUESTION_EVENT, listener);
    const form = { id: 'logo', title: 'Where should the logo go?', headerFooterTarget: { documentId: 'report', setId: 'studio', region: 'header' as const, blockId: 'logo-one' }, questions: [{ id: 'side', label: 'Side', type: 'text' as const }] };
    const view = render(<I18nProvider initial="en"><HeaderFooterQuestionBridge form={form} interactive projectId="project" conversationId="chat" occurrenceKey="one" draftAnswers={{}} /></I18nProvider>);
    await waitFor(() => expect(events.filter((entry) => !entry.clear)).toHaveLength(1)); expect(events[0]!.open).toBe(true); expect(events[0]!.request.props.autoContinueAfterTimeout).toBe(false);
    view.rerender(<I18nProvider initial="en"><HeaderFooterQuestionBridge form={form} interactive projectId="project" conversationId="chat" occurrenceKey="one" draftAnswers={{ side: 'Left' }} /></I18nProvider>);
    await waitFor(() => expect(events.filter((entry) => !entry.clear)).toHaveLength(2)); expect(events[1]!.open).toBe(false); expect(events[1]!.request.props.draftAnswers).toEqual({ side: 'Left' });
    view.unmount(); expect(events.at(-1)?.clear).toBe(true); window.removeEventListener(HEADER_FOOTER_QUESTION_EVENT, listener);
  });
});
