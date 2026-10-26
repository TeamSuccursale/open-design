import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentResearchService, type DocumentResearchWorkerRunner } from '../../src/services/document-research.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'melillo-research-service-')); temporary.push(root);
  const workspace = path.join(root, 'project'), dataDir = path.join(root, 'data');
  await mkdir(path.join(workspace, '.melillodesign', 'projects', 'test'), { recursive: true });
  await writeFile(path.join(workspace, 'source.pdf'), 'source bytes');
  await writeFile(path.join(workspace, '.melillodesign', 'projects', 'test', 'document-setup.json'), JSON.stringify({
    version: 1, projectId: 'test', status: 'review', workingDirectory: workspace, updatedAt: new Date().toISOString(),
    intent: { kind: 'free', subtype: '', purpose: '', contextRoots: [], imageIntakeConsent: false },
    scan: { status: 'complete', sources: [], constraints: [], warnings: [], textDocuments: [{ title: 'Source', root: workspace,
      sourcePath: 'source.pdf', textPath: 'unused.txt', pagesRead: 1, pagesTotal: 3, complete: false, truncated: true }] },
  }));
  return { workspace, dataDir };
}
const result = { summary: 'Read', findings: [{ text: 'Finding', pages: [1], certainty: 'observed' }] };
const extracted = { pagesTotal: 3, pages: [1, 2, 3].map((page) => ({ page, text: `Native text ${page}` })) };

describe('document research sequence and coverage', () => {
  it('publishes a quick overview before full reading finishes and deduplicates concurrent starts', async () => {
    const { workspace, dataDir } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runner = vi.fn<DocumentResearchWorkerRunner>(async (request) => {
      if (request.worker.phase === 'full') await gate;
      return { ...result, findings: [{ ...result.findings[0], pages: [request.pages[0]!.page] }] };
    });
    const service = new DocumentResearchService({ dataDir, runner, extractor: async () => extracted });
    const [a, b] = await Promise.all([service.start(workspace, {}, undefined, 'test'), service.start(workspace, {}, undefined, 'test')]);
    expect(a.id).toBe(b.id);
    await vi.waitFor(async () => expect((await service.read(workspace, 'test'))?.stage).toBe('full'), { timeout: 3000 });
    const overview = (await service.read(workspace, 'test'))!;
    expect(overview.overview).toHaveLength(2);
    expect(overview.quickCompletedAt).toBeTruthy();
    expect(overview.coverage.pagesAnalyzed).toBe(0);
    release();
    await vi.waitFor(async () => expect((await service.read(workspace, 'test'))?.status).toBe('complete'));
    const full = (await service.read(workspace, 'test'))!;
    expect(full.coverage.sources[0]!.analyzedPages).toEqual([1, 2, 3]);
    expect(full.coverage.visual).toBe('not-performed');
    expect(runner).toHaveBeenCalledTimes(3);
    expect((await service.start(workspace, {}, undefined, 'test')).id).toBe(a.id);
  });
  it('keeps blank, missing and oversized pages pending instead of certifying complete analysis', async () => {
    const { workspace, dataDir } = await fixture();
    const service = new DocumentResearchService({ dataDir, runner: async () => result,
      extractor: async () => ({ pagesTotal: 4, pages: [{ page: 1, text: 'Readable' }, { page: 2, text: '' }, { page: 3, text: 'x'.repeat(30_001) }] }) });
    await service.start(workspace, {}, undefined, 'test');
    await vi.waitFor(async () => expect((await service.read(workspace, 'test'))?.status).toBe('partial'));
    const run = (await service.read(workspace, 'test'))!;
    expect(run.coverage.pagesAnalyzed).toBe(1);
    expect(run.coverage.sources[0]!.unreadablePages).toEqual([2]);
    expect(run.coverage.sources[0]!.pendingPages).toEqual([2, 3, 4]);
  });
  it('rejects an invented citation and retries only failed batches using the same frozen source revision', async () => {
    const { workspace, dataDir } = await fixture();
    let broken = true;
    const runner = vi.fn<DocumentResearchWorkerRunner>(async (request) => ({ ...result, findings: [{ ...result.findings[0], pages: [request.worker.phase === 'full' && broken ? 999 : 1] }] }));
    const service = new DocumentResearchService({ dataDir, runner, extractor: async () => extracted });
    await service.start(workspace, {}, undefined, 'test');
    await vi.waitFor(async () => expect((await service.read(workspace, 'test'))?.status).toBe('partial'));
    expect((await service.read(workspace, 'test'))!.coverage.pagesAnalyzed).toBe(0);
    broken = false;
    await service.start(workspace, { retry: true }, undefined, 'test');
    await vi.waitFor(async () => expect((await service.read(workspace, 'test'))?.status).toBe('complete'));
    expect(runner).toHaveBeenCalledTimes(4);
    expect((await service.read(workspace, 'test'))!.overview).toHaveLength(2);
  });
  it('refuses arbitrary source selection and never calls the model for that input', async () => {
    const { workspace, dataDir } = await fixture(), runner = vi.fn();
    const service = new DocumentResearchService({ dataDir, runner, extractor: async () => extracted });
    await expect(service.start(workspace, { sourcePaths: ['../private.pdf'] }, undefined, 'test')).rejects.toThrow('current project text intake');
    expect(runner).not.toHaveBeenCalled();
  });
  it('does not certify current sources after an original changes during background analysis', async () => {
    const { workspace, dataDir } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const service = new DocumentResearchService({ dataDir, extractor: async () => extracted,
      runner: async (request) => { if (request.worker.phase === 'full') await gate; return result; } });
    await service.start(workspace, {}, undefined, 'test');
    await vi.waitFor(async () => expect((await service.read(workspace, 'test'))?.stage).toBe('full'));
    await writeFile(path.join(workspace, 'source.pdf'), 'revised source'); release();
    await vi.waitFor(async () => expect((await service.read(workspace, 'test'))?.status).toBe('partial'));
    expect((await service.read(workspace, 'test'))!.warnings.join(' ')).toContain('copia congelata');
  });
  it('indexes newly discovered sources while reusing unchanged source workers in stable supplied order', async () => {
    const { workspace, dataDir } = await fixture();
    const runner = vi.fn<DocumentResearchWorkerRunner>(async () => result);
    const service = new DocumentResearchService({ dataDir, runner, extractor: async () => extracted });
    const first = { root: workspace, sourcePath: 'source.pdf', title: 'Original source' };
    await service.indexSources(workspace, [first], undefined, 'test');
    await vi.waitFor(async () => expect((await service.read(workspace, 'test'))?.status).toBe('complete'));
    const original = (await service.read(workspace, 'test'))!;
    expect(runner).toHaveBeenCalledTimes(3);
    await writeFile(path.join(workspace, 'new.pdf'), 'new source bytes');
    await service.indexSources(workspace, [first, { root: workspace, sourcePath: 'new.pdf', title: 'New source' }], undefined, 'test');
    await vi.waitFor(async () => expect((await service.read(workspace, 'test'))?.status).toBe('complete'));
    const updated = (await service.read(workspace, 'test'))!;
    expect(updated.sources.map((source) => source.path)).toEqual(['source.pdf', 'new.pdf']);
    expect(runner).toHaveBeenCalledTimes(6);
    expect(runner.mock.calls.slice(3).every(([request]) => request.source.path === 'new.pdf')).toBe(true);
    expect(updated.findings.some((finding) => finding.sourceId === original.sources[0]!.id)).toBe(true);
    expect(updated.coverage.pagesAnalyzed).toBe(6);
    await service.indexSources(workspace, [first, { root: workspace, sourcePath: 'new.pdf', title: 'New source' }], undefined, 'test');
    expect(runner).toHaveBeenCalledTimes(6);
  });
  it('refuses watcher sources outside registered roots before invoking a model', async () => {
    const { workspace, dataDir } = await fixture(), runner = vi.fn();
    await writeFile(path.join(dataDir, '..', 'outside.pdf'), 'outside bytes');
    const service = new DocumentResearchService({ dataDir, runner, extractor: async () => extracted });
    await expect(service.indexSources(workspace, [{ root: path.dirname(workspace), sourcePath: 'outside.pdf', title: 'Outside' }], undefined, 'test')).rejects.toThrow('authorized project folder');
    expect(runner).not.toHaveBeenCalled();
  });
});
