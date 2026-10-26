import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentResearchRun } from '@open-design/contracts';
import type { ProjectCustodianWatchOptions } from '../../src/services/project-custodian-watch.js';
import type { DocumentResearchService } from '../../src/services/document-research.js';
import type { ProjectIntakeService } from '../../src/services/project-intake.js';
import * as documentSetup from '../../src/services/document-setup.js';

const harness = vi.hoisted(() => ({ options: null as ProjectCustodianWatchOptions | null,
  entries: [] as Array<{ path: string; hash: string; kind: 'document'; size: number; mtimeMs: number }> }));
vi.mock('../../src/services/project-custodian-watch.js', () => ({
  ProjectCustodianWatch: class { constructor(options: ProjectCustodianWatchOptions) { harness.options = options; } close() {} },
  scanCustodianManifest: async () => ({ entries: harness.entries, gaps: [] }),
}));
import { createProjectCustodianCoordinator } from '../../src/services/project-custodian-coordinator.js';
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'custodian-coordinator-')); roots.push(root);
  await writeFile(path.join(root, 'source.pdf'), 'updated bytes');
  const hash = createHash('sha256').update('updated bytes').digest('hex');
  harness.entries = [{ path: path.join(root, 'source.pdf'), hash, kind: 'document', size: 13, mtimeMs: 1 }];
  const current = { version: 1, id: 'current', status: 'complete', sources: [{ id: 'source', title: 'Source', root, path: 'source.pdf', sha256: hash, pagesTotal: 1 }], coverage: { pagesAnalyzed: 1, pagesTotal: 1 } } as DocumentResearchRun;
  return { root, current, request: { projectId: 'project', root, metadata: { kind: 'prototype' as const }, changedPaths: [path.join(root, 'source.pdf')] } };
}
describe('custodian indexing coordinator', () => {
  it('does not start visual indexing when persisted image decision is declined even with a legacy true consent bit', async () => {
    const { root } = await fixture();
    vi.spyOn(documentSetup, 'readDocumentSetup').mockResolvedValue({ intent: { imageIntakeConsent: true, imageIntakeDecision: 'declined' } } as Awaited<ReturnType<typeof documentSetup.readDocumentSetup>>);
    const coordinator = createProjectCustodianCoordinator({ dataDir: root, intake: {} as ProjectIntakeService, research: {} as DocumentResearchService });
    expect(await harness.options!.imageConsent(root, 'project')).toBe(false); coordinator.watch.close();
  });
  it('refreshes a same-path source when the completed active job returned an older hash', async () => {
    const { root, current, request } = await fixture();
    const stale = { ...current, sources: [{ ...current.sources[0]!, sha256: 'a'.repeat(64) }] };
    const indexSources = vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(current);
    const coordinator = createProjectCustodianCoordinator({ dataDir: root, intake: {} as ProjectIntakeService,
      research: { indexSources } as unknown as DocumentResearchService });
    const result = await harness.options!.enqueueText(request);
    expect(indexSources).toHaveBeenCalledTimes(2); expect(result?.partial).toBe(false);
    coordinator.watch.close();
  });
  it('does not restart an already current text job unnecessarily', async () => {
    const { root, current, request } = await fixture(), indexSources = vi.fn().mockResolvedValue(current);
    const coordinator = createProjectCustodianCoordinator({ dataDir: root, intake: {} as ProjectIntakeService,
      research: { indexSources } as unknown as DocumentResearchService });
    await harness.options!.enqueueText(request); expect(indexSources).toHaveBeenCalledTimes(1);
    coordinator.watch.close();
  });
  it('does not certify the captured source revision if both indexing attempts return stale evidence', async () => {
    const { root, current, request } = await fixture();
    const stale = { ...current, sources: [{ ...current.sources[0]!, sha256: 'a'.repeat(64) }] };
    const indexSources = vi.fn().mockResolvedValue(stale);
    const coordinator = createProjectCustodianCoordinator({ dataDir: root, intake: {} as ProjectIntakeService,
      research: { indexSources } as unknown as DocumentResearchService });
    const result = await harness.options!.enqueueText(request);
    expect(indexSources).toHaveBeenCalledTimes(2); expect(result?.partial).toBe(true);
    expect(result?.message).toContain('Current source revisions remain unindexed'); coordinator.watch.close();
  });
  it('reports missing structured table extraction as partial and excludes stale unrelated crops from counts', async () => {
    const { root, current, request } = await fixture(), id = current.sources[0]!.sha256.slice(0, 24);
    const intake = { start: vi.fn(async () => ({ version: 1, documents: [{ id, status: 'ready', completedPages: 1, pageCount: 1 }],
      assets: [{ id: 'table', documentId: id, kind: 'table', status: 'ready' }, { id: 'old', documentId: 'stale', kind: 'image', status: 'ready' }] })) };
    const coordinator = createProjectCustodianCoordinator({ dataDir: root, intake: intake as unknown as ProjectIntakeService,
      research: {} as DocumentResearchService });
    const result = await harness.options!.enqueueImages(request);
    expect(result?.partial).toBe(true); expect(result?.message).toContain('1 reusable crops'); expect(result?.message).toContain('1 table transcriptions');
    coordinator.watch.close();
  });
});
