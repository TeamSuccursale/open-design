// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionFormView } from '../../src/components/QuestionForm';
import { splitOnQuestionForms, type QuestionForm } from '../../src/artifacts/question-form';
import { I18nProvider } from '../../src/i18n';

function pageRules(layout?: 'grouped' | 'stepped'): QuestionForm {
  const raw = `<question-form id="page-rules">${JSON.stringify({
    title: 'Related page rules', submitLabel: 'Confirm all page rules', ...(layout ? { layout } : {}),
    questions: [
      { id: 'pages', label: 'Page count', type: 'number', min: 1, default: 8, required: true },
      { id: 'orientation', label: 'Orientation', type: 'radio', options: ['Portrait', 'Landscape'], default: 'Portrait', required: true, allowCustom: false },
      { id: 'paper', label: 'Paper size', type: 'radio', options: ['A4', 'A3'], default: 'A4', required: true, customLabel: 'Custom paper size' },
      { id: 'type', label: 'Typography', type: 'text', required: true },
    ],
  })}</question-form>`;
  const result = splitOnQuestionForms(raw).find((item) => item.kind === 'form');
  if (result?.kind !== 'form') throw new Error('Expected native form');
  return result.form;
}
afterEach(cleanup);

describe('related native questions answered together', () => {
  it.each([['en', 'Send answers'], ['it', 'Invia risposte']] as const)('uses a clear grouped submit fallback in %s and preserves an explicit override', (locale, label) => {
    const form = { ...pageRules('grouped'), submitLabel: undefined };
    const view = (current: QuestionForm) => <I18nProvider initial={locale}><QuestionFormView form={current} interactive onSubmit={vi.fn()} /></I18nProvider>;
    const { rerender } = render(view(form));
    expect(screen.getByRole('button', { name: label })).toBeTruthy();
    rerender(view({ ...form, submitLabel: 'Confirm all page rules' }));
    expect(screen.getByRole('button', { name: 'Confirm all page rules' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: label })).toBeNull();
  });

  // The grouped button reads "Invia risposte" while its hover said "Avanti", as if another step followed.
  it('does not contradict its label on hover, and still says why it is disabled', () => {
    render(<I18nProvider initial="it"><QuestionFormView form={{ ...pageRules('grouped'), submitLabel: undefined }} interactive onSubmit={vi.fn()} /></I18nProvider>);
    const submit = screen.getByRole('button', { name: 'Invia risposte' });
    expect(submit.getAttribute('title')).toBe('Compila prima i campi richiesti');
    fireEvent.change(screen.getByRole('textbox', { name: 'Typography' }), { target: { value: 'Arial 11' } });
    expect(submit.hasAttribute('disabled')).toBe(false);
    expect(submit.getAttribute('title')).toBeNull();
  });

  it('shows all related fields and validates them together before one submission', () => {
    const onSubmit = vi.fn();
    render(<I18nProvider initial="en"><QuestionFormView form={pageRules('grouped')} interactive onSubmit={onSubmit} /></I18nProvider>);
    expect(screen.getByRole('spinbutton', { name: 'Page count' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Orientation' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Paper size' })).toBeTruthy();
    const typography = screen.getByRole('textbox', { name: 'Typography' });
    const submit = screen.getByRole('button', { name: 'Confirm all page rules' });
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.change(typography, { target: { value: 'Calibri 11 pt' } });
    expect(submit.hasAttribute('disabled')).toBe(false);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Page count' }), { target: { value: '' } });
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Page count' }), { target: { value: '12' } });
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ pages: '12', orientation: 'Portrait', paper: 'A4', type: 'Calibri 11 pt' });
    expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('keeps edited defaults and custom answers when the same form receives later default suggestions', () => {
    const onSubmit = vi.fn(), form = pageRules('grouped');
    const view = (current: QuestionForm) => <I18nProvider initial="en"><QuestionFormView form={current} interactive onSubmit={onSubmit} /></I18nProvider>;
    const { rerender } = render(view(form));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Page count' }), { target: { value: '12' } });
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Orientation' })).getByRole('radio', { name: 'Landscape' }));
    fireEvent.click(screen.getByRole('button', { name: 'Custom paper size' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Paper size: Custom paper size' }), { target: { value: '210 × 210 mm' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Typography' }), { target: { value: 'Source Sans 11 pt' } });
    rerender(view({ ...form, questions: form.questions.map((q) => ({ ...q, defaultValue: q.id === 'pages' ? '10' : q.id === 'type' ? 'Arial 10 pt' : q.defaultValue })) }));
    expect((screen.getByRole('spinbutton', { name: 'Page count' }) as HTMLInputElement).value).toBe('12');
    expect((screen.getByRole('textbox', { name: 'Paper size: Custom paper size' }) as HTMLTextAreaElement).value).toBe('210 × 210 mm');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm all page rules' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ pages: '12', orientation: 'Landscape', paper: '210 × 210 mm', type: 'Source Sans 11 pt' });
  });

  it.each([undefined, 'stepped'] as const)('keeps the ordinary multi-question %s layout stepped', (layout) => {
    render(<I18nProvider initial="en"><QuestionFormView form={pageRules(layout)} interactive onSubmit={vi.fn()} /></I18nProvider>);
    expect(screen.getByRole('spinbutton', { name: 'Page count' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Orientation' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Typography' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Next step' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByRole('radiogroup', { name: 'Orientation' })).toBeTruthy();
    expect(screen.queryByRole('spinbutton', { name: 'Page count' })).toBeNull();
  });
});
