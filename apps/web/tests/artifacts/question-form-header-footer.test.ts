import { describe, expect, it } from 'vitest';
import { formAnswersDisplayBody, formatFormAnswers, splitOnQuestionForms } from '../../src/artifacts/question-form';
function form(target: unknown) {
  const result = splitOnQuestionForms(`<question-form id="header-choice">${JSON.stringify({ title: 'Logo placement', headerFooterTarget: target, questions: [{ id: 'position', type: 'radio', label: 'Keep the logo on the left?', options: ['Yes', 'No'] }] })}</question-form>`).find((entry) => entry.kind === 'form');
  if (result?.kind !== 'form') throw new Error('Expected a native question form'); return result.form;
}
describe('header/footer question targets', () => {
  it('routes a valid region/block target without exposing routing JSON in failed answer messages', () => {
    const parsed = form({ documentId: 'report', setId: 'studio', region: 'header', blockId: 'logo' });
    expect(parsed.headerFooterTarget).toEqual({ documentId: 'report', setId: 'studio', region: 'header', blockId: 'logo' });
    const submitted = formatFormAnswers(parsed, { position: 'Yes' });
    expect(submitted).toContain('[header/footer target]'); expect(submitted).toContain('"blockId":"logo"');
    expect(formAnswersDisplayBody(submitted)).toBe('- Keep the logo on the left?: Yes');
  });
  it.each([{ documentId: '../report', region: 'header' }, { documentId: 'report', region: 'body' }, { documentId: 'report' }, { documentId: 'report', region: 'footer', unknown: true }])('retains the question but discards invalid metadata %j', (target) => { expect(form(target).headerFooterTarget).toBeUndefined(); });
});
