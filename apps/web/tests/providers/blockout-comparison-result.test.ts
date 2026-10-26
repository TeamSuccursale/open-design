// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLOCKOUT_COMPARISON_RESULT_EVENT, loadBlockout, saveBlockout, type BlockoutComparisonResult } from '../../src/providers/blockout';
import { invalidateProjectFilesCache } from '../../src/providers/registry';
import { materialAssessment, materialDocument } from '../helpers/blockout-materials-fixtures';

vi.mock('../../src/providers/registry', () => ({ invalidateProjectFilesCache: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('committed layout and derived comparison result', () => {
  it('preserves the committed revision and assessment when rendering fails, then emits scoped recovery on the next save', async () => {
    const document = materialDocument(), assessment = materialAssessment(document), raw = JSON.stringify(document);
    const failure = { document, raw, comparisonError: 'The preview renderer is unavailable', assessment };
    const success = { document, raw: `${raw}\n`, comparisonPath: 'documents/survey/blockout-comparison.html', assessment };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(failure)).mockResolvedValueOnce(Response.json(failure)).mockResolvedValueOnce(Response.json(success));
    vi.stubGlobal('fetch', fetch);
    expect(await loadBlockout('project')).toMatchObject(failure);
    const events: BlockoutComparisonResult[] = [];
    const capture = (event: Event) => events.push((event as CustomEvent<BlockoutComparisonResult>).detail);
    window.addEventListener(BLOCKOUT_COMPARISON_RESULT_EVENT, capture);
    try {
      await expect(saveBlockout('project', document, 'old revision')).resolves.toBe(raw);
      await expect(saveBlockout('project', document, raw)).resolves.toBe(`${raw}\n`);
      expect(JSON.parse(fetch.mock.calls[2]![1].body).baseRaw).toBe(raw);
      expect(events).toEqual([
        { projectId: 'project', documentId: 'document-1', error: 'The preview renderer is unavailable' },
        { projectId: 'project', documentId: 'document-1', path: 'documents/survey/blockout-comparison.html' },
      ]);
      expect(invalidateProjectFilesCache).toHaveBeenCalledTimes(2);
    } finally { window.removeEventListener(BLOCKOUT_COMPARISON_RESULT_EVENT, capture); }
  });
});
