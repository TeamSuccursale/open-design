import { describe, expect, it } from 'vitest';
import { blockoutProposalsInFlight } from '../../src/runtime/blockout-run';

describe('blockoutProposalsInFlight', () => {
  it('is false with no run in flight', () => {
    expect(blockoutProposalsInFlight([{ role: 'assistant', sessionMode: 'blockout' }], false)).toBe(false);
  });
  it('keeps proposals locked while a Blockout run may still be writing them', () => {
    expect(blockoutProposalsInFlight([{ role: 'user' }, { role: 'assistant', sessionMode: 'blockout' }], true)).toBe(true);
  });
  it('frees the other documents’ proposals during a design run', () => {
    expect(blockoutProposalsInFlight([{ role: 'assistant', sessionMode: 'blockout' }, { role: 'user' }, { role: 'assistant', sessionMode: 'design' }], true)).toBe(false);
  });
  it('stays locked when the run’s mode is unknown', () => {
    expect(blockoutProposalsInFlight([{ role: 'user' }, { role: 'assistant' }], true)).toBe(true);
    expect(blockoutProposalsInFlight([], true)).toBe(true);
  });
});
