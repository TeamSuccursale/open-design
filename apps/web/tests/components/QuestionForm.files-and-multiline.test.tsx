// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import { QuestionFormView, parseSubmittedAnswers } from '../../src/components/QuestionForm';
import { AssistantMessage } from '../../src/components/AssistantMessage';
import { formatFormAnswers, type QuestionForm } from '../../src/artifacts/question-form';
import { acceptedFileTypes } from '../../src/runtime/chat/accepted-file-types';

afterEach(cleanup);
describe('file questions and multiline confirmation', () => {
  it.each(['.svg,.png,.zip', 'image/*,.svg,.zip', 'image/svg+xml,image/png,application/zip'])('shows recognizable logo and ZIP formats for accept %s', (accept) => {
    const form: QuestionForm = { id: 'logos', title: 'Loghi', questions: [{ id: 'files', label: 'Allega i file dei loghi', type: 'file', multiple: true, accept }] };
    render(<I18nProvider initial="it"><QuestionFormView form={form} interactive onSubmit={vi.fn()} /></I18nProvider>);
    const file = screen.getByLabelText('Allega i file dei loghi'); expect(file.getAttribute('accept')).toBe(accept);
    const hint = screen.getByText(/^Puoi caricare:/); for (const name of ['SVG', 'PNG', 'ZIP']) expect(hint.textContent).toContain(name);
    expect(hint.textContent).not.toMatch(/image\/|application\//); expect(file.getAttribute('aria-describedby')).toBe(hint.id);
  });
  it('does not expose raw unknown MIME strings as format advice', () => { expect(acceptedFileTypes('application/vnd.proprietary-unknown')).toBe(''); });
  it('retains textarea lines and a question-looking note in the stored answer and visible history summary', () => {
    const form: QuestionForm = { id: 'header-guidance', title: 'Loghi e indicazioni', layout: 'grouped', questions: [{ id: 'notes', label: 'Informazioni e indicazioni', type: 'textarea' }, { id: 'name', label: 'Nome del documento', type: 'text' }] };
    const notes = 'Progetto: Antro\nDocumento: titolo locale\nPagina: numero e totale\n- Nome del documento: è soltanto un esempio nella nota\n\nMantieni entrambi i loghi.';
    const text = formatFormAnswers(form, { notes, name: 'Relazione tecnica' });
    expect(text).toContain('\n  - Nome del documento: è soltanto un esempio nella nota');
    expect(parseSubmittedAnswers(form, text)).toEqual({ notes, name: 'Relazione tecnica' });
    const markup = `<question-form id="header-guidance">${JSON.stringify(form)}</question-form>`;
    render(<I18nProvider initial="it"><AssistantMessage message={{ id: 'assistant', role: 'assistant', content: markup, runStatus: 'succeeded', events: [] }} nextUserContent={text} streaming={false} projectId="project" conversationId="chat" isLast /></I18nProvider>);
    const summary = screen.getByTestId('question-form-summary'); const values = [...summary.querySelectorAll('b')].map((element) => element.textContent);
    expect(values).toContain(notes); expect(values).toContain('Relazione tecnica'); expect(values).not.toContain('è soltanto un esempio nella nota');
  });
  it('recovers older unindented guidance lines and stops before upload and routing metadata', () => {
    const form: QuestionForm = { id: 'notes', title: '', questions: [{ id: 'notes', label: 'Indicazioni', type: 'textarea' }] };
    expect(parseSubmittedAnswers(form, '[form answers — notes]\n- Indicazioni: Progetto: Antro\nDocumento: titolo locale\nPagina: numero e totale\n[header/footer target] {"documentId":"doc","region":"header"}\n[uploaded design files]\n- Logo: logo.svg')).toEqual({ notes: 'Progetto: Antro\nDocumento: titolo locale\nPagina: numero e totale' });
  });
});
