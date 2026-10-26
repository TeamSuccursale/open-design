import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectCustodianService, type CustodianWorkerRequest } from '../../src/services/project-custodians.js';
import { DocumentResearchService } from '../../src/services/document-research.js';
import type { DocumentResearchSource } from '@open-design/contracts';

const nativeReader = async (source: DocumentResearchSource) => ({ sourceSha256: source.sha256, pagesTotal: 2, complete: true,
  pages: [{ page: 1, text: 'The surface area is 25 square metres.', truncated: false }, { page: 2, text: 'Legend.', truncated: false }] });

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(consent = false) {
  const temp = await mkdtemp(path.join(tmpdir(), 'custodian-query-')); roots.push(temp);
  const root = path.join(temp, 'project'), dataDir = path.join(temp, 'data');
  const setupDir = path.join(root, '.melillodesign/projects/test');
  await mkdir(setupDir, { recursive: true });
  await mkdir(path.join(root, 'intake-assets'), { recursive: true });
  await writeFile(path.join(root, 'source.pdf'), 'source bytes');
  const sha = createHash('sha256').update('source bytes').digest('hex');
  await writeFile(path.join(setupDir, 'document-setup.json'), JSON.stringify({
    version: 1, projectId: 'test', status: 'review', workingDirectory: root, updatedAt: new Date().toISOString(),
    intent: { kind: 'free', subtype: '', purpose: '', contextRoots: [], imageIntakeConsent: consent, imageIntakeDecision: consent ? 'accepted' : 'declined' },
    scan: { status: 'complete', sources: [], constraints: [], warnings: [], textDocuments: [{ title: 'Source', root,
      sourcePath: 'source.pdf', textPath: 'unused.txt', pagesRead: 1, pagesTotal: 2, complete: false, truncated: true }] },
  }));
  const researcher = new DocumentResearchService({ dataDir, extractor: async () => ({ pagesTotal: 2, pages: [{ page: 1, text: 'Area 25 square metres' }, { page: 2, text: 'Legend' }] }),
    runner: async () => ({ summary: 'Area', findings: [{ text: 'The surface area is 25 square metres.', pages: [1], certainty: 'observed' }] }) });
  await researcher.start(root, {}, undefined, 'test');
  await vi.waitFor(async () => expect((await researcher.read(root, 'test'))?.status).toBe('complete'));
  await writeFile(path.join(root, 'intake-assets/crop.png'), 'image-bytes');
  await writeFile(path.join(root, 'intake-assets/catalog.json'), JSON.stringify({ version: 1,
    documents: [{ id: sha.slice(0, 24), sourcePath: 'source.pdf', name: 'Source', status: 'ready', pageCount: 2, completedPages: 1, indexedPages: [1], updatedAt: new Date().toISOString() }],
    assets: [{ id: 'asset-table', documentId: sha.slice(0, 24), sourcePath: 'source.pdf', sourceName: 'Source', page: 1, box: [0, 0, 1000, 1000],
      imagePath: 'intake-assets/crop.png', width: 300, height: 400, kind: 'table', title: 'Surface area', description: 'Area table: 25 m2', tags: ['area'], status: 'ready' }] }));
  return { root, dataDir };
}
const answer = (request: CustodianWorkerRequest) => ({ answer: 'La superficie è 25 m².',
  citations: [{ sourceId: request.evidence[0]!.sourceId, title: 'ignored model title', page: 1,
    ...(request.evidence[0]!.assetId ? { assetId: request.evidence[0]!.assetId } : {}) }],
  assetIds: request.evidence[0]!.assetId ? [request.evidence[0]!.assetId] : [], gaps: [] });

describe('project source custodians', () => {
  it('stops offering cached evidence when an external source folder is no longer authorized', async () => {
    const { root, dataDir } = await fixture();
    const external = await mkdtemp(path.join(tmpdir(), 'custodian-external-')); roots.push(external);
    await writeFile(path.join(external, 'external.txt'), 'External source facts');
    const metadata = { kind: 'prototype' as const, linkedDirs: [external] };
    const researcher = new DocumentResearchService({ dataDir, extractor: async () => ({ pagesTotal: 1, pages: [{ page: 1, text: 'External source facts' }] }),
      runner: async () => ({ summary: 'External', findings: [{ text: 'External source facts', pages: [1], certainty: 'observed' }] }) });
    await researcher.indexSources(root, [{ root: external, sourcePath: 'external.txt', title: 'External' }], metadata, 'test');
    await vi.waitFor(async () => expect((await researcher.read(root, 'test'))?.status).toBe('complete'));
    const runner = vi.fn(), native = vi.fn(nativeReader), service = new ProjectCustodianService({ dataDir, runner, nativeReader: native });
    expect((await service.ledger(root, metadata, 'test')).sources[0]!.status).toBe('current');
    expect((await service.ledger(root, { kind: 'prototype' }, 'test')).sources[0]!.status).toBe('unavailable');
    await service.ask(root, { domain: 'text', question: 'Find external source facts' }, { kind: 'prototype' }, 'test');
    expect(native).not.toHaveBeenCalled(); expect(runner).not.toHaveBeenCalled();
  });
  it('caches actual immutable source bytes by full hash and never offers that cache after the original changes', async () => {
    const { root, dataDir } = await fixture();
    await writeFile(path.join(root, 'actual.txt'), 'Pagina di apertura\nPagina di sintesi\nBoth sections are present.');
    const researcher = new DocumentResearchService({ dataDir, extractor: async () => ({ pagesTotal: 1, pages: [{ page: 1, text: 'Incomplete saved summary without the section names.' }] }),
      runner: async () => ({ summary: 'Short summary', findings: [{ text: 'A demonstration report.', pages: [1], certainty: 'observed' }] }) });
    await researcher.indexSources(root, [{ root, sourcePath: 'actual.txt', title: 'Actual text' }], undefined, 'test');
    await vi.waitFor(async () => expect((await researcher.read(root, 'test'))?.status).toBe('complete'));
    const runner = vi.fn(async (request: CustodianWorkerRequest) => {
      expect(request.evidence[0]!.text).toContain('Pagina di apertura');
      expect(request.evidence[0]!.text).toContain('Pagina di sintesi');
      expect(request.evidence[0]!.basis).toBe('native-page');
      return { answer: 'Both sections exist.', citations: [{ sourceId: request.evidence[0]!.sourceId, title: 'Actual text', page: 1 }], assetIds: [], gaps: [] };
    });
    const service = new ProjectCustodianService({ dataDir, runner });
    await service.ask(root, { domain: 'text', question: 'Does the report have an opening and synthesis?' }, undefined, 'test');
    const source = (await researcher.read(root, 'test'))!.sources[0]!;
    const cache = JSON.parse(await readFile(path.join(dataDir, 'project-custodians/source-pages', source.sha256, 'pages.json'), 'utf8'));
    expect(cache.sourceSha256).toBe(source.sha256); expect(cache.pages[0].text).toContain('Pagina di sintesi');
    await writeFile(path.join(root, 'actual.txt'), 'Revised source with different contents.');
    await service.ask(root, { domain: 'text', question: 'What sections exist now?' }, undefined, 'test');
    expect(runner).toHaveBeenCalledTimes(1);
  });
  it('retrieves actual page clauses omitted by saved summaries before answering counting questions', async () => {
    const { root, dataDir } = await fixture();
    const runner = vi.fn(async (request: CustodianWorkerRequest) => {
      expect(request.evidence.some((entry) => entry.basis === 'native-page' && entry.text.includes('opening and synthesis excluded'))).toBe(true);
      expect(request.evidence.some((entry) => entry.text === 'The surface area is 25 square metres.')).toBe(false);
      return { answer: 'The opening and synthesis are excluded from the page count.', citations: [{ sourceId: request.evidence[0]!.sourceId, title: 'Source', page: 38 }], assetIds: [], gaps: [] };
    });
    const service = new ProjectCustodianService({ dataDir, runner, nativeReader: async (source) => ({ sourceSha256: source.sha256, pagesTotal: 42, complete: true,
      pages: Array.from({ length: 42 }, (_, index) => ({ page: index + 1, text: index === 37 ? 'Page counting: opening and synthesis excluded; 30 pages total for the criteria.' : 'Ordinary document contents.', truncated: false })) }) });
    const result = await service.ask(root, { domain: 'text', question: 'What are the page counting exclusions and total?', limit: 6 }, undefined, 'test');
    expect(result.citations[0]!.page).toBe(38);
    expect(result.gaps.some((gap) => gap.includes('Unoffered pages were not inspected'))).toBe(true);
  });
  it('answers from actual current findings and saves an atomic provenance receipt and diary events', async () => {
    const { root, dataDir } = await fixture(), runner = vi.fn(async (request: CustodianWorkerRequest) => answer(request)), recordEvent = vi.fn(async () => {});
    const service = new ProjectCustodianService({ dataDir, nativeReader, runner, recordEvent });
    const ledger = await service.ledger(root, undefined, 'test');
    expect(ledger.sources).toHaveLength(1);
    expect(ledger.sources[0]!.textAnalyzedPages).toEqual([1, 2]);
    expect(ledger.sources[0]!.visualIndexedPages).toEqual([1]);
    const result = await service.ask(root, { domain: 'text', question: 'What area?' }, undefined, 'test');
    expect(result.citations[0]!.title).toBe('Source');
    expect(runner.mock.calls[0]![0].images).toEqual([]);
    const directory = (await readdir(path.join(dataDir, 'project-custodians')))[0]!;
    const receipt = JSON.parse(await readFile(path.join(dataDir, 'project-custodians', directory, result.receiptId, 'receipt.json'), 'utf8'));
    expect(receipt.result.snapshotRevision).toBe(ledger.snapshotRevision);
    expect(recordEvent).toHaveBeenCalledTimes(2);
  });
  it('blocks visual inspection without persisted consent even when crops already exist', async () => {
    const { root, dataDir } = await fixture(), runner = vi.fn();
    const result = await new ProjectCustodianService({ dataDir, nativeReader, runner }).ask(root, { domain: 'images', question: 'Find the table' }, undefined, 'test');
    expect(runner).not.toHaveBeenCalled(); expect(result.assetIds).toEqual([]);
    expect(result.answer).toContain('Consenti');
  });
  it('passes actual image attachments with exact source and asset links when consent exists', async () => {
    const { root, dataDir } = await fixture(true), runner = vi.fn(async (request: CustodianWorkerRequest) => answer(request));
    const result = await new ProjectCustodianService({ dataDir, nativeReader, runner }).ask(root, { domain: 'images', question: 'Find area table' }, undefined, 'test');
    expect(runner.mock.calls[0]![0].images).toEqual([path.join(root, 'intake-assets/crop.png')]);
    expect(runner.mock.calls[0]![0].imageAssetIds).toEqual(['asset-table']);
    expect(result.assetIds).toEqual(['asset-table']);
    expect(result.assets).toEqual([expect.objectContaining({ id: 'asset-table', title: 'Surface area', imagePath: 'intake-assets/crop.png', kind: 'table', page: 1, tableDataComplete: false })]);
  });
  it('excludes whole-page previews by default and includes them when explicitly requested', async () => {
    const { root, dataDir } = await fixture(true);
    const file = path.join(root, 'intake-assets/catalog.json'), catalog = JSON.parse(await readFile(file, 'utf8'));
    catalog.assets.unshift({ ...catalog.assets[0], id: 'page-preview', kind: 'page', title: 'Whole page' });
    await writeFile(file, JSON.stringify(catalog));
    const runner = vi.fn(async (request: CustodianWorkerRequest) => answer(request)), service = new ProjectCustodianService({ dataDir, nativeReader, runner });
    await service.ask(root, { domain: 'images', question: 'Find images' }, undefined, 'test');
    expect(runner.mock.calls[0]![0].evidence.map((entry) => entry.assetId)).toEqual(['asset-table']);
    await service.ask(root, { domain: 'images', question: 'Show the whole page' }, undefined, 'test');
    expect(runner.mock.calls[1]![0].evidence.some((entry) => entry.assetId === 'page-preview')).toBe(true);
  });
  it('marks truncated table metadata while returning a verified complete sidecar for composition', async () => {
    const { root, dataDir } = await fixture(true);
    const file = path.join(root, 'intake-assets/catalog.json'), catalog = JSON.parse(await readFile(file, 'utf8'));
    const tableData = { headers: [['Area']], rows: Array.from({ length: 400 }, (_, index) => [`Entry ${index}: ${'a'.repeat(40)}`]), notes: [], unreadableCells: [], complete: true };
    catalog.assets[0].tableData = tableData; catalog.assets[0].tableDataPath = 'intake-assets/crop.table.json';
    await writeFile(file, JSON.stringify(catalog)); await writeFile(path.join(root, 'intake-assets/crop.table.json'), JSON.stringify(tableData));
    const runner = vi.fn(async (request: CustodianWorkerRequest) => answer(request));
    const result = await new ProjectCustodianService({ dataDir, nativeReader, runner }).ask(root, { domain: 'images', question: 'Find table' }, undefined, 'test');
    expect(runner.mock.calls[0]![0].evidence[0]).toEqual(expect.objectContaining({ metadataTruncated: true, tableDataComplete: false }));
    expect(result.assets![0]).toEqual(expect.objectContaining({ metadataTruncated: true, tableDataComplete: true, tableDataPath: 'intake-assets/crop.table.json' }));
  });
  it('does not accept model-invented asset descriptors', async () => {
    const { root, dataDir } = await fixture(true);
    const service = new ProjectCustodianService({ dataDir, nativeReader, runner: async (request) => ({ ...answer(request), assets: [{ imagePath: 'fake.png' }] }) });
    await expect(service.ask(root, { domain: 'images', question: 'Find table' }, undefined, 'test')).rejects.toThrow();
  });
  it('reserves visual attachment slots for a map even when similar photos rank first', async () => {
    const { root, dataDir } = await fixture(true);
    const file = path.join(root, 'intake-assets/catalog.json'), catalog = JSON.parse(await readFile(file, 'utf8'));
    const template = catalog.assets[0];
    catalog.assets = [...Array.from({ length: 8 }, (_, index) => ({ ...template, id: `photo-${index}`, kind: 'image', title: 'Interior photograph', tags: [] })),
      { ...template, id: 'map', kind: 'image', title: 'Mappa catastale', tags: ['map'] }];
    await writeFile(file, JSON.stringify(catalog));
    const runner = vi.fn(async (request: CustodianWorkerRequest) => answer(request));
    await new ProjectCustodianService({ dataDir, nativeReader, runner }).ask(root, { domain: 'images', question: 'Choose references', limit: 12 }, undefined, 'test');
    expect(runner.mock.calls[0]![0].imageAssetIds).toContain('map');
    expect(runner.mock.calls[0]![0].images).toHaveLength(6);
  });
  it.each(['page', 'asset', 'source'])('rejects invented %s citations instead of certifying them', async (mode) => {
    const { root, dataDir } = await fixture(true);
    const service = new ProjectCustodianService({ dataDir, nativeReader, runner: async (request) => {
      const value = answer(request);
      if (mode === 'page') value.citations[0]!.page = 999;
      if (mode === 'source') value.citations[0]!.sourceId = 'invented';
      if (mode === 'asset') value.assetIds = ['invented'];
      return value;
    } });
    await expect(service.ask(root, { domain: 'images', question: 'What area?' }, undefined, 'test')).rejects.toThrow(/outside/);
  });
  it('detects changed originals, changes snapshot revision and refuses stale findings', async () => {
    const { root, dataDir } = await fixture(), runner = vi.fn();
    const service = new ProjectCustodianService({ dataDir, nativeReader, runner }), before = await service.ledger(root, undefined, 'test');
    await writeFile(path.join(root, 'source.pdf'), 'new revision');
    const after = await service.ledger(root, undefined, 'test');
    expect(after.snapshotRevision).not.toBe(before.snapshotRevision); expect(after.sources[0]!.status).toBe('changed');
    await service.ask(root, { domain: 'text', question: 'What area?' }, undefined, 'test');
    expect(runner).not.toHaveBeenCalled();
  });
});
