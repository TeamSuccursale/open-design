import { describe, expect, it } from 'vitest';
import { resolveSvgExecutionPolicy } from '../src/api/svg-execution.js';

const defaults = { agentId: 'codex', model: 'gpt-6-luna', reasoning: 'low' };
describe('per-turn SVG execution quality', () => {
  it.each(['Create an SVG icon', 'Make a simple SVG', 'Rielabora il grafico in SVG', 'Convert this to vectorial geometry'])(
    'raises Luna/Low to Sol/XHigh for %s', (prompt) => {
      expect(resolveSvgExecutionPolicy({ ...defaults, prompt })).toEqual({ model: 'gpt-6.1-sol', reasoning: 'xhigh', complexity: 'standard' });
    });
  it.each(['Reconstruct the map as SVG', 'Rielabora la planimetria in SVG', 'Trace a faithful detailed SVG', 'Convert a dense table from PDF to SVG'])(
    'automatically routes complex work to Max: %s', (prompt) => {
      expect(resolveSvgExecutionPolicy({ ...defaults, prompt })?.reasoning).toBe('max');
    });
  it('treats intake reconstruction as complex even with a short generic prompt', () => {
    expect(resolveSvgExecutionPolicy({ ...defaults, prompt: 'Rielabora in SVG', attachments: ['intake-assets\\doc\\crop.png'] })?.reasoning).toBe('max');
  });
  it('preserves a stronger model and effort', () => {
    expect(resolveSvgExecutionPolicy({ ...defaults, prompt: 'Create SVG', model: 'gpt-6-astra', reasoning: 'ultra' })).toMatchObject({ model: 'gpt-6-astra', reasoning: 'ultra' });
    expect(resolveSvgExecutionPolicy({ ...defaults, prompt: 'Create SVG', model: 'gpt-6-sol', reasoning: 'max' })).toMatchObject({ model: 'gpt-6-sol', reasoning: 'max' });
  });
  it('covers follow-up edits through an attached SVG', () => {
    expect(resolveSvgExecutionPolicy({ ...defaults, prompt: 'Move the legend to the left', attachments: ['designs/vector/source/v1.svg'] })?.reasoning).toBe('xhigh');
  });
  it('retains Max for short follow-ups, and releases the floor for a new output format', () => {
    const previousPolicy = resolveSvgExecutionPolicy({ ...defaults, prompt: 'Reconstruct the detailed map as SVG' });
    expect(resolveSvgExecutionPolicy({ ...defaults, prompt: 'Move the legend to the left', previousPolicy })?.reasoning).toBe('max');
    expect(resolveSvgExecutionPolicy({ ...defaults, prompt: 'Now create an HTML report', previousPolicy })).toBeNull();
  });
  it.each(['Tag these extracted photos', 'Write a report', 'What is SVG?'])(
    'leaves unrelated work unchanged: %s', (prompt) => expect(resolveSvgExecutionPolicy({ ...defaults, prompt })).toBeNull(),
  );
  it('does not assign Codex model names to other runtimes', () => {
    expect(resolveSvgExecutionPolicy({ ...defaults, agentId: 'claude', prompt: 'Create SVG' })).toBeNull();
  });
});
