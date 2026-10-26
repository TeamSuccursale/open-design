import { describe, expect, it, vi } from 'vitest';
import { recordHeaderFooterDraftRunDelivery } from '../../src/services/header-footer-run-delivery.js';

describe('native header/footer delivery receipt', () => {
  const base = { runId: 'run-1', requestedProjectId: 'child', collectionId: 'parent', setId: 'model-1', draftVersion: 3, stage: 'graphic' as const,
    collectionForProject: (id: string) => ['parent', 'child'].includes(id) ? 'parent' : id };

  it('records a successfully saved native draft in its own parent library', () => {
    const run = { projectId: 'child', status: 'running' }, emit = vi.fn();
    expect(recordHeaderFooterDraftRunDelivery({ ...base, getRun: () => run, emit })).toBe(true);
    expect(emit).toHaveBeenCalledWith(run, { name: 'header_footer_draft_saved', source: 'daemon-header-footer', shape: {
      projectId: 'parent', setId: 'model-1', draftVersion: 3, stage: 'graphic',
    } });
  });

  it.each([
    { runId: undefined, run: { projectId: 'child', status: 'running' } },
    { runId: 'run-1', run: undefined },
    { runId: 'run-1', run: { projectId: 'foreign', status: 'running' } },
    { runId: 'run-1', run: { projectId: 'child', status: 'failed' } },
    { runId: 'run-1', run: { projectId: 'child', status: 'succeeded' } },
  ])('does not attribute manual, absent, foreign or ended writes: %j', ({ runId, run }) => {
    const emit = vi.fn();
    const { runId: _runId, ...withoutRun } = base;
    expect(recordHeaderFooterDraftRunDelivery({ ...withoutRun, ...(runId ? { runId } : {}), getRun: () => run, emit })).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
});
