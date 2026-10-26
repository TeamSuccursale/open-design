// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionFormView } from '../../src/components/QuestionForm';
import type { QuestionForm } from '../../src/artifacts/question-form';
import { I18nProvider, type Locale } from '../../src/i18n';

const form: QuestionForm = {
  id: 'submit-state', title: 'Document settings', lang: 'zh-CN', layout: 'grouped',
  submitLabel: 'Complete brief',
  questions: [{ id: 'name', label: 'Document name', type: 'text', required: true, defaultValue: 'Report' }],
};
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('question form submission status', () => {
  it.each([
    ['en', 'Submitting…'],
    ['it', 'Invio in corso…'],
  ] satisfies Array<[Locale, string]>)('uses the %s host locale for a pending complete form', (locale, label) => {
    const view = render(<I18nProvider initial={locale}><QuestionFormView form={form} interactive submitting onSubmit={vi.fn()} /></I18nProvider>);
    const submit = screen.getByRole('button', { name: label });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('title', label);
    expect(screen.queryByTitle('Fill in the required fields first')).toBeNull();
    expect(screen.queryByTitle('Compila prima i campi richiesti')).toBeNull();
    expect(view.container.querySelector('[data-form-id="submit-state"]')).toHaveAttribute('aria-busy', 'true');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(label);
    // A live region below aria-busy can be deferred until busy clears.
    expect(status.closest('[aria-busy="true"]')).toBeNull();
  });

  it('keeps the required-field hint for genuinely incomplete answers', () => {
    const incomplete = { ...form, questions: [{ ...form.questions[0]!, defaultValue: undefined }] };
    render(<I18nProvider initial="en"><QuestionFormView form={incomplete} interactive onSubmit={vi.fn()} /></I18nProvider>);
    expect(screen.getByRole('button', { name: 'Complete brief' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Complete brief' })).toHaveAttribute('title', 'Fill in the required fields first');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not claim missing fields or a submission when a ready form is disabled by its host', () => {
    render(<I18nProvider initial="en"><QuestionFormView form={form} interactive submitDisabled onSubmit={vi.fn()} /></I18nProvider>);
    const submit = screen.getByRole('button', { name: 'Complete brief' });
    expect(submit).toBeDisabled();
    expect(submit).not.toHaveAttribute('title');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('restores the original label and complete draft when pending is released', () => {
    const onSubmit = vi.fn();
    const content = (submitting: boolean) => <I18nProvider initial="en"><QuestionFormView form={form} interactive submitting={submitting} onSubmit={onSubmit} /></I18nProvider>;
    const view = render(content(true));
    view.rerender(content(false));
    expect(screen.queryByRole('status')).toBeNull();
    expect(view.container.querySelector('[data-form-id="submit-state"]')).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('textbox')).toHaveValue('Report');
    expect(screen.getByRole('button', { name: 'Complete brief' })).toBeEnabled();
  });

  it('shows the same pending state on a stepped final submit and disables back and skip', () => {
    const stepped: QuestionForm = { ...form, layout: undefined, questions: [
      form.questions[0]!, { id: 'purpose', label: 'Purpose', type: 'text', defaultValue: 'Explain findings' },
    ] };
    const content = (submitting: boolean) => <I18nProvider initial="en"><QuestionFormView form={stepped} interactive submitting={submitting} onSubmit={vi.fn()} /></I18nProvider>;
    const view = render(content(false));
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByRole('button', { name: 'Complete brief' })).toBeEnabled();
    view.rerender(content(true));
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submitting…' })).toHaveAttribute('title', 'Submitting…');
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeDisabled();
  });

  it('shows pending on the shared submit button delegated to a visual-direction footer', () => {
    const visual: QuestionForm = { id: 'visual-submit', title: 'Direction', questions: [{ id: 'tone', label: 'Direction', type: 'direction-cards' }] };
    render(<I18nProvider initial="en"><QuestionFormView form={visual} interactive submitting visualStyleContext="prototype" onSubmit={vi.fn()} /></I18nProvider>);
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submitting…' })).toHaveAttribute('title', 'Submitting…');
    expect(screen.getByRole('status')).toHaveTextContent('Submitting…');
  });

  it('does not start timeout continuation while a submitted answer is outstanding', () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();
    render(<I18nProvider initial="en"><QuestionFormView form={form} interactive submitting autoContinueAfterTimeout onSubmit={onSubmit} /></I18nProvider>);
    act(() => vi.advanceTimersByTime(20 * 60 * 1000));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
  });
});
