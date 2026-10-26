// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import { QuestionFormView, parseSubmittedAnswers, summarizeQuestionFormAnswers } from '../../src/components/QuestionForm';
import { AssistantMessage } from '../../src/components/AssistantMessage';
import { splitOnQuestionForms, type QuestionForm } from '../../src/artifacts/question-form';

const payload = {
  layout: 'grouped', lang: 'it', questions: [
    { id: 'scope', label: 'Quali elaborati prepariamo ora?', type: 'radio', default: 'report_only', required: true, options: [{ label: 'Solo relazione; fascicolo rinviato', value: 'report_only' }, { label: 'Entrambi gli elaborati', value: 'both' }] },
    { id: 'name', label: 'Nome della relazione', type: 'text', default: 'Relazione tecnica', required: true },
    ...[['header', 'Relazione: intestazione?'], ['footer', 'Relazione: piè di pagina?'], ['cover', 'Relazione: copertina?'], ['numbers', 'Relazione: numeri di pagina?']].map(([id, label]) => ({ id, label, type: 'radio', default: 'yes', required: true, options: [{ label: 'Sì', value: 'yes' }, { label: 'No', value: 'no' }] })),
  ],
};
const markup = `<question-form id="editorial" title="Ambito e impostazione della relazione">${JSON.stringify(payload)}</question-form>`;
function parsedForm() { const segment = splitOnQuestionForms(markup).find((entry) => entry.kind === 'form'); if (segment?.kind !== 'form') throw new Error('Native form expected'); return segment.form; }
afterEach(cleanup);
describe('grouped editorial choices reviewed together', () => {
  it('submits all six visible defaults after changing only the scope, then retains them all in the confirmation summary', () => {
    const onSubmit = vi.fn(), form = parsedForm(); render(<I18nProvider initial="it"><QuestionFormView form={form} interactive onSubmit={onSubmit} /></I18nProvider>);
    expect(screen.getByRole('radio', { name: 'Entrambi gli elaborati' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getAllByRole('radio', { name: 'Sì' }).every((radio) => radio.getAttribute('aria-checked') === 'true')).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Entrambi gli elaborati' })); fireEvent.click(screen.getByRole('button', { name: 'Invia risposte' }));
    const [text, answers] = onSubmit.mock.calls[0]!;
    expect(answers).toEqual({ scope: 'both', name: 'Relazione tecnica', header: 'yes', footer: 'yes', cover: 'yes', numbers: 'yes' });
    const replay = parseSubmittedAnswers(form, text as string); expect(replay).toEqual(answers);
    expect(summarizeQuestionFormAnswers(form, replay!).items).toHaveLength(6);
    cleanup();
    render(<I18nProvider initial="it"><AssistantMessage message={{ id: 'assistant-editorial', role: 'assistant', content: markup, runStatus: 'succeeded', events: [] }} nextUserContent={text as string} streaming={false} projectId="project" conversationId="chat" isLast /></I18nProvider>);
    const summary = screen.getByTestId('question-form-summary');
    for (const label of ['Relazione: intestazione?', 'Relazione: piè di pagina?', 'Relazione: copertina?', 'Relazione: numeri di pagina?']) expect(within(summary).getByText(label)).toBeTruthy();
  });
  it('uses the longest complete label when a shorter question label is also its prefix and retains colons in the answer', () => {
    const form: QuestionForm = { id: 'overlap', title: 'Labels', questions: [{ id: 'short', label: 'Relazione', type: 'text' }, { id: 'long', label: 'Relazione: codice', type: 'text' }] };
    expect(parseSubmittedAnswers(form, '[form answers — overlap]\n- Relazione: tecnica\n- Relazione: codice: B:1')).toEqual({ short: 'tecnica', long: 'B:1' });
  });
});
