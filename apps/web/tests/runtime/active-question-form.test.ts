import { describe, expect, it } from 'vitest';
import { hasActiveQuestionForm } from '../../src/runtime/chat/active-question-form';

const form = (id = 'brief') => `<question-form id="${id}" title="Document brief">${JSON.stringify({ questions: [{ id: 'scope', type: 'select', label: 'What should we prepare?', options: ['Report', 'Both'] }] })}</question-form>`;
const assistant = (content: string) => ({ role: 'assistant', content });
const user = (content: string) => ({ role: 'user', content });

describe('active preparation question ownership', () => {
  it('recognizes a complete answerable question even when a host assistant notice follows it', () => {
    expect(hasActiveQuestionForm([user('Begin'), assistant(form())])).toBe(true);
    expect(hasActiveQuestionForm([user('Begin'), assistant(form()), assistant('Project memory saved')])).toBe(true);
  });
  it('restores recovery after a later user turn retires the historical question', () => {
    expect(hasActiveQuestionForm([assistant(form()), user('Work on the header first'), assistant('Header prepared')])).toBe(false);
    expect(hasActiveQuestionForm([assistant(form()), user('[form answers — brief]\nReport')])).toBe(false);
    expect(hasActiveQuestionForm([assistant(form()), user('Continue'), assistant(form('new-question'))])).toBe(true);
  });
  it('does not suppress recovery for incomplete, quoted, artifact-owned or locked direction questions', () => {
    expect(hasActiveQuestionForm([assistant('<question-form>{"questions":[')])).toBe(false);
    expect(hasActiveQuestionForm([assistant(`\`\`\`html\n${form()}\n\`\`\``)])).toBe(false);
    expect(hasActiveQuestionForm([assistant(`<artifact type="text/html"><html><body>${form()}</body></html></artifact>`)])).toBe(false);
    expect(hasActiveQuestionForm([assistant(form('direction'))], true)).toBe(false);
    expect(hasActiveQuestionForm([assistant(form('direction'))])).toBe(true);
  });
});
