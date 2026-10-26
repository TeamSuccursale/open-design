import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express, { type Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { BlockoutInventoryResponseSchema, type BlockoutMaterialInventory, type DocumentResearchSource, type ProjectIntakeCatalog } from '@open-design/contracts';
import { BlockoutMaterialsService, blockoutTextParagraphs } from '../src/services/blockout-materials.js';
import { registerBlockoutMaterialRoutes, type RegisterBlockoutMaterialRoutesDeps } from '../src/routes/blockout-materials.js';
import { runBlockoutCli } from '../src/services/blockout-cli.js';

const roots: string[] = [], servers: Server[] = [];
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
async function folder() { const root = await mkdtemp(path.join(tmpdir(), 'blockout-materials-')); roots.push(root); return root; }
afterEach(async () => { vi.restoreAllMocks(); for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function settled(service: BlockoutMaterialsService, root: string, projectId = 'project'): Promise<BlockoutMaterialInventory> {
  for (let count = 0; count < 200; count += 1) {
    const value = await service.get(root, undefined, projectId);
    if (value.status !== 'preparing') return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Inventory did not finish');
}
const nativeReader = async (source: DocumentResearchSource) => ({ sourceSha256: source.sha256, pagesTotal: 1,
  complete: true, pages: [{ page: 1, text: await readFile(path.join(source.root, source.path), 'utf8'), truncated: false }] });

describe('source-backed Blockout materials', () => {
  it('preserves every original character and UTF-16 paragraph offsets instead of excerpting text', async () => {
    const root = await folder(), dataDir = await folder();
    const text = `Prima riga 😀 e qualità.\r\n\r\n${'Materiale originale completo. '.repeat(400)}\n\nUltimo paragrafo oltre gli estratti.`;
    await writeFile(path.join(root, 'source.txt'), text);
    await mkdir(path.join(root, 'blockout/.context'), { recursive: true });
    await writeFile(path.join(root, 'blockout/.context/generated.txt'), 'Never include generated context');
    const read = vi.fn(nativeReader), service = new BlockoutMaterialsService({ dataDir, nativeReader: read });
    const first = await service.get(root); expect(first.status).toBe('preparing');
    await Promise.all([service.get(root), service.get(root), service.refresh(root)]);
    const inventory = await settled(service, root);
    expect(inventory.status).toBe('ready');
    expect(read).toHaveBeenCalledTimes(1);
    expect(inventory.sources).toMatchObject({ processed: 1, total: 1 });
    expect(inventory.sources.entries[0]!.coverage).toEqual({ text: 'complete', images: 'not-applicable' });
    const items = inventory.items.filter((item) => item.kind === 'text');
    expect(items.map((item) => item.text).join('')).toBe(text);
    for (const item of items) expect(item.text).toBe(text.slice(item.offsetStart, item.offsetEnd));
    const stable = await service.refresh(root); expect(stable.status).toBe('preparing');
    const refreshed = await settled(service, root);
    expect(refreshed.revision).toBe(inventory.revision);
    expect(refreshed.items.map((item) => item.id)).toEqual(inventory.items.map((item) => item.id));
    await writeFile(path.join(root, 'source.txt'), `${text}\nNuovo contenuto reale.`);
    expect((await service.get(root)).status).toBe('preparing');
    const changed = await settled(service, root); expect(changed.revision).not.toBe(inventory.revision);
    await expect(new BlockoutMaterialsService({ dataDir }).read(root)).resolves.toMatchObject({ revision: changed.revision });
    expect(blockoutTextParagraphs('  testo\n\n\n')).toEqual([{ text: '  testo\n\n\n', offsetStart: 0, offsetEnd: 10 }]);
  });

  it('reports partial, blank and truncated native coverage without claiming readiness', async () => {
    const root = await folder(), dataDir = await folder(); await writeFile(path.join(root, 'source.pdf'), 'original');
    const service = new BlockoutMaterialsService({ dataDir, nativeReader: async (source) => ({ sourceSha256: source.sha256, pagesTotal: 3,
      complete: false, pages: [{ page: 1, text: 'Prefix only', truncated: true }, { page: 2, text: '', truncated: false }] }) });
    const inventory = await settled(service, root);
    expect(inventory.status).toBe('needs-input');
    expect(inventory.sources.entries[0]!.coverage).toEqual({ text: 'partial', images: 'not-requested' });
    expect(inventory.gaps.join(' ')).toMatch(/truncated.*partial.*no searchable/s);
    expect(inventory.items).toMatchObject([{ kind: 'text', text: 'Prefix only' }]);
  });

  it('uses only selected roots and invalidates a snapshot changed while extraction is in progress', async () => {
    const root = await folder(), dataDir = await folder(), selected = await folder(), outside = await folder();
    await writeFile(path.join(root, 'own.txt'), 'Own material'); await writeFile(path.join(selected, 'selected.txt'), 'Selected material');
    await writeFile(path.join(outside, 'not-selected.txt'), 'Never read this');
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let started = false;
    const read = vi.fn(async (source: DocumentResearchSource) => { if (!started) { started = true; await blocked; } return nativeReader(source); });
    const service = new BlockoutMaterialsService({ dataDir, nativeReader: read });
    const metadata = { kind: 'other' as const, linkedDirs: [selected] };
    expect((await service.get(root, metadata)).status).toBe('preparing');
    await writeFile(path.join(root, 'own.txt'), 'Own changed material'); release();
    let changed: BlockoutMaterialInventory | null = null;
    for (let i = 0; i < 100; i += 1) { changed = await service.read(root); if (changed?.status === 'waiting') break; await new Promise((resolve) => setTimeout(resolve, 5)); }
    expect(changed?.status).toBe('waiting'); expect(changed?.gaps.join(' ')).toContain('changed during preparation');
    const final = await service.refresh(root, metadata); expect(['preparing', 'waiting']).toContain(final.status);
    let ready = final;
    for (let i = 0; i < 100; i += 1) { ready = await service.get(root, metadata); if (ready.status !== 'preparing' && ready.status !== 'waiting') break; await new Promise((resolve) => setTimeout(resolve, 5)); }
    expect(ready.status).toBe('ready'); expect(ready.sources.total).toBe(2);
    expect(read.mock.calls.every(([source]) => source.root !== outside)).toBe(true);
    expect(ready.items.some((item) => item.sourcePath === path.join(selected, 'selected.txt'))).toBe(true);
  });

  it('binds real gallery files only to the verified source and uses decoded image dimensions', async () => {
    const root = await folder(), dataDir = await folder(), source = 'PDF original';
    await writeFile(path.join(root, 'source.pdf'), source);
    await mkdir(path.join(root, 'intake-assets/doc'), { recursive: true });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    await writeFile(path.join(root, 'intake-assets/doc/image.png'), png);
    const catalog: ProjectIntakeCatalog = { version: 1, documents: [{ id: 'doc', sourcePath: 'source.pdf', name: 'Original', sha256: sha(source), status: 'ready', pageCount: 1, completedPages: 1, indexedPages: [1], updatedAt: 'now' }],
      assets: [{ id: 'figure', documentId: 'doc', sourcePath: 'source.pdf', sourceName: 'Original', page: 1, box: [0, 0, 1000, 1000], imagePath: 'intake-assets/doc/image.png', width: 999, height: 999,
        kind: 'table', title: 'Tabella originale', description: '', tags: [], status: 'ready', analysis: { stage: 'crop', sourceSha256: sha(source), model: 'fixture', effort: 'low', analyzedAt: 'now' } }] };
    const service = new BlockoutMaterialsService({ dataDir, nativeReader: async (item) => ({ sourceSha256: item.sha256, pagesTotal: 1, complete: true, pages: [{ page: 1, text: 'Source body', truncated: false }] }), intake: { catalog: async () => catalog } });
    const ready = await settled(service, root);
    expect(ready.status).toBe('ready');
    expect(ready.sources.entries[0]!.coverage).toEqual({ text: 'complete', images: 'complete' });
    expect(ready.items.find((item) => item.kind === 'table')).toMatchObject({ width: 1, height: 1, sourceHash: sha(source), imagePath: 'intake-assets/doc/image.png', assetId: 'figure' });
    catalog.documents[0]!.status = 'processing'; catalog.documents[0]!.completedPages = 0;
    const waiting = await settled(service, root); expect(waiting.status).toBe('waiting');
    expect(waiting.sources.entries[0]!.coverage?.images).toBe('partial');
    catalog.documents[0]!.status = 'ready'; catalog.documents[0]!.completedPages = 1;
    catalog.assets[0]!.analysis!.sourceSha256 = '0'.repeat(64);
    const stale = await settled(service, root); expect(stale.status).toBe('needs-input');
    expect(stale.items.some((item) => item.kind === 'table')).toBe(false);
    expect(stale.gaps.join(' ')).toContain('ownership/source revision');
  });

  it('reads the real full native PDF cache without model calls or summary truncation', async () => {
    const root = await folder(), dataDir = await folder(), pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText('Qualita originale. Prima pagina completa.', { x: 30, y: 700, font });
    pdf.addPage().drawText('Seconda pagina: contenuto finale da conservare.', { x: 30, y: 700, font });
    await writeFile(path.join(root, 'source.pdf'), await pdf.save());
    const service = new BlockoutMaterialsService({ dataDir });
    const inventory = await settled(service, root);
    expect(inventory.status).toBe('ready');
    expect(inventory.sources.entries[0]!.coverage).toEqual({ text: 'complete', images: 'not-requested' });
    expect(inventory.sources.entries[0]).toMatchObject({ pagesProcessed: 2, pagesTotal: 2 });
    expect(inventory.items.filter((item) => item.kind === 'text').map((item) => item.text).join(' ')).toContain('contenuto finale');
  });

  it('serves authenticated HTTP/CLI inventory and assessment requests through their matching endpoints', async () => {
    const root = await folder(), dataDir = await folder(); await writeFile(path.join(root, 'source.txt'), 'Full source body');
    const app = express(); app.use(express.json()); let allowed = true;
    const service = new BlockoutMaterialsService({ dataDir, nativeReader });
    const deps = { db: {}, paths: { PROJECTS_DIR: root }, projectStore: { getProject: () => ({ id: 'project', metadata: { kind: 'other', baseDir: root } }) },
      authorizeProjectRequest: async (_req: unknown, res: Response) => { if (!allowed) res.status(403).json({ error: { message: 'Denied' } }); return allowed; },
      http: { sendApiError: (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) } } as unknown as RegisterBlockoutMaterialRoutesDeps;
    registerBlockoutMaterialRoutes(app, deps, service);
    const assessment = vi.fn((_req, res) => res.json({ assessment: { status: 'ready' } }));
    app.get('/api/projects/project/blockout-documents/document-1/assessment', assessment);
    app.post('/api/projects/project/blockout-documents/document-1/assessment', assessment);
    const server = app.listen(0, '127.0.0.1'); servers.push(server); await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server');
    const url = `http://127.0.0.1:${address.port}`, log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runBlockoutCli(['inventory', '--project', 'project', '--daemon-url', url, '--refresh', '--wait', '--json']);
    expect(BlockoutInventoryResponseSchema.parse(JSON.parse(String(log.mock.calls.at(-1)![0]))).inventory.status).toBe('ready');
    await runBlockoutCli(['assess', '--project', 'project', '--daemon-url', url, '--json']);
    expect(assessment).toHaveBeenCalledTimes(1);
    const input = path.join(root, 'proposal.json'); await writeFile(input, JSON.stringify({ document: { version: 1 } }));
    await runBlockoutCli(['assess', '--project', 'project', '--daemon-url', url, '--prompt-file', input, '--json']);
    expect(assessment.mock.calls[1]![0].body).toEqual({ document: { version: 1 } });
    allowed = false;
    expect((await fetch(`${url}/api/projects/project/blockout-materials`)).status).toBe(403);
  });
});
