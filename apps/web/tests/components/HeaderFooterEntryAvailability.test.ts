import { describe, expect, it } from 'vitest';
import { headerFooterEntryAvailable } from '../../src/components/header-footer/entry-availability';

const question = (targeted = false, required = true) => ({ role: 'assistant', content: `<question-form id="presentation" title="Presentation">${JSON.stringify({
  questions: [{ id: 'cover', type: 'select', label: 'Cover?', options: ['Yes', 'No'], required }],
  ...(targeted ? { headerFooterTarget: { documentId: 'doc', setId: 'set', region: 'header' } } : {}),
})}</question-form>` });
const base = { applied: false, busy: false, messages: [] };

describe('header/footer first-composition entry', () => {
  it('waits for the real editorial questions and running preparation to finish', () => {
    expect(headerFooterEntryAvailable({ ...base, busy: true })).toBe(false);
    expect(headerFooterEntryAvailable({ ...base, messages: [question()] })).toBe(false);
    expect(headerFooterEntryAvailable({ ...base, messages: [question(), { role: 'assistant', content: 'Saved' }] })).toBe(false);
    expect(headerFooterEntryAvailable({ ...base, messages: [question(), { role: 'user', content: '[form answers]\nNo cover' }] })).toBe(true);
  });
  it('keeps an already-applied model reachable while other work or questions run', () => {
    expect(headerFooterEntryAvailable({ ...base, applied: true, busy: true, messages: [question()] })).toBe(true);
  });
  it('does not gate the dedicated targeted header/footer question workflow', () => {
    expect(headerFooterEntryAvailable({ ...base, messages: [question(true)] })).toBe(true);
  });
  it('keeps the draft library reachable when the agent only offers optional additions', () => {
    expect(headerFooterEntryAvailable({ ...base, messages: [question(false, false)] })).toBe(true);
    expect(headerFooterEntryAvailable({ ...base, messages: [question(false, true)] })).toBe(false);
  });
});
