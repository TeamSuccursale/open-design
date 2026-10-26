// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionFormView } from '../../src/components/QuestionForm';
import { I18nProvider } from '../../src/i18n';
import { splitOnQuestionForms, formatFormAnswers, visibleFormQuestions, type QuestionForm } from '../../src/artifacts/question-form';
afterEach(cleanup);
const form: QuestionForm = { id: 'cover', title: 'Editorial settings', layout: 'grouped', submitLabel: 'Confirm settings', questions: [
  { id: 'cover', label: 'Include a cover?', type: 'radio', defaultValue: 'no', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }], required: true },
  { id: 'cover-limit', label: 'Does the cover count toward the limit?', type: 'text', required: true, showWhen: { questionId: 'cover', equals: 'yes' } },
  { id: 'cover-number', label: 'Print a cover number?', type: 'switch', defaultValue: 'true', showWhen: { questionId: 'cover', equals: 'yes' } },
] };
function mount(onSubmit = vi.fn(), submittedAnswers?: Record<string, string | string[]>) {
  render(<I18nProvider initial="en"><QuestionFormView form={form} interactive onSubmit={onSubmit} submittedAnswers={submittedAnswers} /></I18nProvider>); return onSubmit;
}
describe('conditional questions', () => {
  it('hides cover-only required fields, excludes preset answers and submits immediately when cover is no', () => {
    const submit = mount(); expect(screen.queryByText('Print a cover number?')).toBeNull();
    const button = screen.getByRole('button', { name: 'Confirm settings' }); expect((button as HTMLButtonElement).disabled).toBe(false); fireEvent.click(button);
    expect(submit).toHaveBeenCalledWith('[form answers — cover]\n- Include a cover?: No [value: no]', { cover: 'no' }, 'submit');
  });
  it('reveals required controls for yes and omits their edited values after switching back to no', () => {
    const submit = mount(); fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(screen.getByText('Print a cover number?')).toBeTruthy(); expect((screen.getByRole('button', { name: 'Confirm settings' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Yes, within the limit' } });
    fireEvent.click(screen.getByRole('radio', { name: 'No' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm settings' }));
    expect(submit.mock.calls[0]![1]).toEqual({ cover: 'no' }); expect(submit.mock.calls[0]![0]).not.toContain('cover count');
  });
  it('keeps hidden historical answers out of the submitted summary', () => {
    mount(vi.fn(), { cover: 'no', 'cover-limit': 'stale answer', 'cover-number': 'true' });
    expect(screen.queryByText('Does the cover count toward the limit?')).toBeNull(); expect(screen.queryByText('stale answer')).toBeNull();
    expect(formatFormAnswers(form, { cover: 'no', 'cover-limit': 'stale answer' })).not.toContain('stale answer');
  });
  it('parses boolean switch conditions and rejects unknown references, malformed conditions and cycles', () => {
    const parse = (questions: unknown[]) => splitOnQuestionForms(`<question-form>${JSON.stringify({ questions })}</question-form>`).some((segment) => segment.kind === 'form');
    expect(parse([{ id: 'switch', type: 'switch', label: 'Cover' }, { id: 'count', type: 'text', label: 'Count', showWhen: { questionId: 'switch', equals: true } }])).toBe(true);
    expect(parse([{ id: 'child', label: 'Child', showWhen: { questionId: 'missing', equals: 'yes' } }])).toBe(false);
    expect(parse([{ id: 'child', label: 'Child', showWhen: { questionId: 'child', equals: 'yes' } }])).toBe(false);
    expect(parse([{ id: 'a', label: 'A', showWhen: { questionId: 'b', equals: 'yes' } }, { id: 'b', label: 'B', showWhen: { questionId: 'a', equals: 'yes' } }])).toBe(false);
    expect(parse([{ id: 'a', label: 'A', showWhen: { questionId: 'b', equals: 1 } }, { id: 'b', label: 'B' }])).toBe(false);
  });
  it('preserves legacy unconditional fields', () => {
    const unchanged = { ...form, questions: form.questions.map(({ showWhen: _condition, ...question }) => question) };
    expect(formatFormAnswers(unchanged, { cover: 'no' })).toContain('- Does the cover count toward the limit?: (skipped)');
  });
  it('matches boolean switch answers and hides descendants of a hidden parent', () => {
    const nested: QuestionForm = { id: 'nested', title: '', questions: [{ id: 'cover', label: 'Cover', type: 'switch' }, { id: 'number', label: 'Number', type: 'switch', showWhen: { questionId: 'cover', equals: true } }, { id: 'start', label: 'Start', type: 'number', showWhen: { questionId: 'number', equals: true } }] };
    expect(visibleFormQuestions(nested, { cover: 'false', number: 'true' }).map((question) => question.id)).toEqual(['cover']);
    expect(visibleFormQuestions(nested, { cover: 'true', number: 'true' }).map((question) => question.id)).toEqual(['cover', 'number', 'start']);
  });
});
