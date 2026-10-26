import { describe, expect, it } from 'vitest';
import type { IntakeAsset, IntakeDocument, ProjectIntakeCatalog } from '@open-design/contracts';
import { projectIntakeProgress } from '../../../src/runtime/chat/project-intake-progress';

const document = (id: string, status: IntakeDocument['status'], pageCount: number, completedPages: number): IntakeDocument => ({ id, status, pageCount, completedPages, name: `${id}.pdf`, sourcePath: `sources/${id}.pdf`, indexedPages: [], updatedAt: '2026-10-23T12:00:00Z' });
const catalog = (documents: IntakeDocument[], assets: IntakeAsset[] = []): ProjectIntakeCatalog => ({ version: 1, documents, assets });

describe('project image intake progress', () => {
  it('weights progress by real pages rather than giving each document equal weight', () => {
    const result = projectIntakeProgress(catalog([document('short', 'ready', 2, 2), document('long', 'processing', 98, 23)]));
    expect(result).toMatchObject({ completedPages: 25, totalPages: 100, percent: 25, ready: 1, processing: 1, active: true });
  });
  it('does not invent a percentage while queued document totals are unknown', () => {
    const result = projectIntakeProgress(catalog([document('known', 'ready', 10, 10), document('new', 'queued', 0, 0)]));
    expect(result).toMatchObject({ unknownTotals: 1, completedPages: 10, totalPages: 10, percent: undefined, active: true });
  });
  it('does not show complete until both document jobs and image jobs settle', () => {
    const docs = [document('done', 'processing', 10, 10)];
    expect(projectIntakeProgress(catalog(docs)).percent).toBe(99);
    const image = { documentId: 'done', status: 'processing' } as IntakeAsset;
    expect(projectIntakeProgress(catalog([{ ...docs[0]!, status: 'ready' }], [image])).percent).toBe(99);
    expect(projectIntakeProgress(catalog([{ ...docs[0]!, status: 'ready' }], [{ ...image, status: 'ready' }])).percent).toBe(100);
  });
  it('keeps failed images visible and retries only their source documents without duplicate paths', () => {
    const docs = [document('good', 'ready', 2, 2), document('bad', 'failed', 8, 6)];
    const assets = [{ documentId: 'bad', status: 'failed' }, { documentId: 'bad', status: 'failed' }] as IntakeAsset[];
    expect(projectIntakeProgress(catalog(docs, assets))).toMatchObject({ active: false, hasFailures: true, failed: 1, failedAssets: 2, percent: 80, retryPaths: ['sources/bad.pdf'] });
    expect(projectIntakeProgress(catalog([document('bad', 'ready', 8, 8)], assets)).percent).toBe(99);
  });
  it('shows a deliberately sampled intake as indexed pages rather than pretending the whole PDF was indexed', () => {
    expect(projectIntakeProgress(catalog([document('sample', 'ready', 100, 3)]))).toMatchObject({ completedPages: 3, totalPages: 100, percent: 3, active: false });
  });
});
