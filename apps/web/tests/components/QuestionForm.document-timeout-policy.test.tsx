// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import { QuestionFormView } from '../../src/components/QuestionForm';
import { allowQuestionTimeout } from '../../src/runtime/chat/question-timeout-policy';
import type { QuestionForm } from '../../src/artifacts/question-form';
afterEach(() => { cleanup(); vi.useRealTimers(); });
const editorial: QuestionForm = { id: 'editorial', title: 'Header and footer', layout: 'grouped', questions: [{ id: 'header', label: 'Header?', type: 'radio', required: true, defaultValue: 'yes', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] }] };
describe('document choices never answer themselves', () => {
  it('keeps a Fast editorial form pending after ten minutes instead of submitting its visible default', () => {
    vi.useFakeTimers(); const onSubmit = vi.fn();
    render(<I18nProvider initial="en"><QuestionFormView form={editorial} interactive onSubmit={onSubmit} autoContinueAfterTimeout={allowQuestionTimeout({ projectMetadata: { kind: 'other', projectMode: 'fast' } })} /></I18nProvider>);
    act(() => vi.advanceTimersByTime(10 * 60 * 1000 + 1000)); expect(onSubmit).not.toHaveBeenCalled();
  });
  it('keeps a targeted header/footer question pending even if a generic host enables timeout', () => {
    vi.useFakeTimers(); const onSubmit = vi.fn();
    render(<I18nProvider initial="en"><QuestionFormView form={{ ...editorial, headerFooterTarget: { documentId: 'report', region: 'header', blockId: 'logo' } }} interactive onSubmit={onSubmit} autoContinueAfterTimeout /></I18nProvider>);
    act(() => vi.advanceTimersByTime(10 * 60 * 1000 + 1000)); expect(onSubmit).not.toHaveBeenCalled();
  });
  it('preserves the existing generic non-document timeout while document context disables it', () => {
    expect(allowQuestionTimeout({ projectMetadata: { kind: 'prototype' }, sessionMode: 'design' })).toBe(true);
    expect(allowQuestionTimeout({ projectMetadata: { kind: 'other', intent: 'document' } })).toBe(false); expect(allowQuestionTimeout({ activeProjectDocumentId: 'report' })).toBe(false); expect(allowQuestionTimeout({ sessionMode: 'blockout' })).toBe(false);
    vi.useFakeTimers(); const onSubmit = vi.fn(); render(<I18nProvider initial="en"><QuestionFormView form={editorial} interactive onSubmit={onSubmit} autoContinueAfterTimeout={allowQuestionTimeout({})} /></I18nProvider>);
    act(() => vi.advanceTimersByTime(10 * 60 * 1000 + 1000)); expect(onSubmit).toHaveBeenCalledWith(expect.any(String), { header: 'yes' }, 'auto');
  });
});
