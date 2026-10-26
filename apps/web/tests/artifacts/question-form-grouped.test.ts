import { describe, expect, it } from 'vitest';
import { parsePartialQuestionForm, splitOnQuestionForms } from '../../src/artifacts/question-form';

function parsed(layout?: unknown) {
  const raw = `<question-form id="page-rules">${JSON.stringify({
    ...(layout === undefined ? {} : { layout }), title: 'Page rules',
    questions: [{ id: 'paper', label: 'Paper size', type: 'radio', options: ['A4', 'A3'], default: 'A4' }, { id: 'pages', label: 'Page count', type: 'number', default: 8 }],
  })}</question-form>`;
  const result = splitOnQuestionForms(raw).find((item) => item.kind === 'form');
  if (result?.kind !== 'form') throw new Error('Expected a native question form');
  return result.form;
}

describe('opt-in related question layout', () => {
  it('keeps the grouped layout and editable defaults in the parsed native form', () => {
    expect(parsed('grouped')).toMatchObject({ layout: 'grouped', questions: [{ id: 'paper', defaultValue: 'A4' }, { id: 'pages', defaultValue: '8' }] });
  });
  it.each([undefined, 'grid', true, { grouped: true }])('leaves unsupported or missing layout %j on the default stepped path', (layout) => {
    expect(parsed(layout).layout).toBeUndefined();
    expect(parsed(layout).questions).toHaveLength(2);
  });
  it('accepts an explicit stepped preference too', () => { expect(parsed('stepped').layout).toBe('stepped'); });
  it('adopts grouped streaming layout only after its top-level string is complete', () => {
    expect(parsePartialQuestionForm('<question-form id="page-rules">{"layout":"group')?.layout).toBeUndefined();
    expect(parsePartialQuestionForm('<question-form id="page-rules">{"layout":"grouped","questions":[')?.layout).toBe('grouped');
    expect(parsePartialQuestionForm('<question-form id="page-rules">{"questions":[{"id":"paper","layout":"grouped"')?.layout).toBeUndefined();
  });
});
