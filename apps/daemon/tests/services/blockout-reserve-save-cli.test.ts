import express from 'express';
import type { Response } from 'express';
import type { Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlockoutDocument, createBlockoutPage, type BlockoutDocument, type BlockoutReserveAdjustment } from '@open-design/contracts';
import { registerBlockoutWorkspaceRoutes, type RegisterBlockoutWorkspaceRoutesDeps } from '../../src/routes/blockout-workspaces.js';
import { readBlockoutWorkspace, saveBlockoutWorkspace, saveBlockoutWorkspaceStartingPoint } from '../../src/services/blockout-workspaces.js';
import { runBlockoutCli } from '../../src/services/blockout-cli.js';

const cleanup: Array<() => Promise<unknown>> = [];
const runId = process.env.OD_RUN_ID;
afterEach(async () => {
  vi.restoreAllMocks();
  if (runId === undefined) delete process.env.OD_RUN_ID; else process.env.OD_RUN_ID = runId;
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('Blockout save from an agent run', () => {
  it('tells the host the save comes from a run, so the reserve is fitted there, and returns what was fitted', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'blockout-reserve-save-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const document: BlockoutDocument = { ...createBlockoutDocument(), title: 'Relazione B' };
    await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: null });
    const seen: unknown[] = [];
    const adjustment: BlockoutReserveAdjustment = { variantId: 'brief', pageId: 'page-1', blockIds: ['caption'], from: { top: 12, bottom: 94 }, to: { top: 12, bottom: 91.58 } };
    const app = express(); app.use(express.json());
    registerBlockoutWorkspaceRoutes(app, {
      db: {}, paths: { PROJECTS_DIR: path.dirname(root) },
      authorizeProjectRequest: async () => true,
      http: { sendApiError: (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
      projectStore: { getProject: (_db: unknown, id: string) => id === 'project' ? { id, metadata: { kind: 'other', baseDir: root } } : null },
      normalizeBlockout: async (_projectId: string, input: BlockoutDocument, options?: { authoredByRun?: boolean }) => {
        seen.push(options);
        return { document: input, reserveAdjustments: options?.authoredByRun ? [adjustment] : [] };
      },
    } as unknown as RegisterBlockoutWorkspaceRoutesDeps);
    const server: Server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Server did not bind');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const save = async () => {
      const current = await readBlockoutWorkspace(root, document.documentId), file = path.join(root, 'save.json');
      await writeFile(file, JSON.stringify({ document: current.document, baseRaw: current.raw }));
      await runBlockoutCli(['save', '--project', 'project', '--prompt-file', file, '--daemon-url', `http://127.0.0.1:${address.port}`, '--json']);
      return JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { reserveAdjustments?: BlockoutReserveAdjustment[] };
    };

    process.env.OD_RUN_ID = 'run-blockout-proposals';
    expect((await save()).reserveAdjustments).toEqual([adjustment]);
    delete process.env.OD_RUN_ID;
    expect((await save()).reserveAdjustments).toBeUndefined();
    expect(seen).toEqual([{ authoredByRun: true }, { authoredByRun: false }]);
  });

  it('refuses a save without its base revision before sending it, and says where the revision comes from', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'blockout-save-base-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const file = path.join(root, 'save.json');
    await writeFile(file, JSON.stringify({ document: { ...createBlockoutDocument(), documentId: 'relazione' } }));
    // Nothing listens on the discard port: reaching the network would fail with "fetch failed" instead.
    const failure = await runBlockoutCli(['save', '--project', 'project', '--document', 'relazione', '--prompt-file', file, '--daemon-url', 'http://127.0.0.1:9', '--json']).then(() => null, (error: Error) => error.message);
    expect(failure).toContain('od blockout show --project project --document relazione --json');
    expect(failure).toContain('baseRaw');
  });

  it('fits alternatives a run appends to an existing Blockout and reports them by their saved proposal', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'blockout-reserve-append-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const document: BlockoutDocument = { ...createBlockoutDocument(), title: 'Relazione B' };
    const first = await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: null });
    await saveBlockoutWorkspaceStartingPoint(root, document.documentId, { document: first.document, baseRaw: first.raw,
      requestId: 'request-1', variantId: 'brief', operation: { type: 'append-alternatives', count: 1, instruction: 'Una lettura più continua.' } });
    const seen: unknown[] = [];
    const app = express(); app.use(express.json());
    registerBlockoutWorkspaceRoutes(app, {
      db: {}, paths: { PROJECTS_DIR: path.dirname(root) },
      authorizeProjectRequest: async () => true,
      http: { sendApiError: (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
      projectStore: { getProject: (_db: unknown, id: string) => id === 'project' ? { id, metadata: { kind: 'other', baseDir: root } } : null },
      // Stands in for the header/footer runtime: a run's caption is lifted out of a 20 mm footer reserve.
      normalizeBlockout: async (_projectId: string, input: BlockoutDocument, options?: { authoredByRun?: boolean }) => {
        seen.push(options);
        if (!options?.authoredByRun) return { document: input, reserveAdjustments: [] };
        const variant = input.variants[0]!, page = variant.pages[0]!;
        const fitted = { ...input, variants: input.variants.map((item) => ({ ...item, pages: item.pages.map((entry) => ({ ...entry, reservedFooterMm: 20, blocks: entry.blocks.map((block) => ({ ...block, box: { ...block.box, y: 70 } })) })) })) };
        return { document: fitted, reserveAdjustments: [{ variantId: variant.id, pageId: page.id, blockIds: ['caption'], from: { top: 12, bottom: 96 }, to: { top: 12, bottom: 93.27 } }] };
      },
    } as unknown as RegisterBlockoutWorkspaceRoutesDeps);
    const server: Server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Server did not bind');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const caption = { id: 'caption', label: 'Didascalia', kind: 'text' as const, box: { x: 10, y: 88, width: 80, height: 8, rotation: 0 },
      lockRatio: false, images: [], expectation: 'Nota al quadro', feedback: '', flexibility: 'guided' as const, references: [] };
    const file = path.join(root, 'append.json');
    await writeFile(file, JSON.stringify({ requestId: 'request-1', candidates: [{ label: 'Lettura continua', pages: [{ ...createBlockoutPage('page-1', 'Apertura'), blocks: [caption] }] }] }));

    process.env.OD_RUN_ID = 'run-blockout-alternatives';
    await runBlockoutCli(['append-alternatives', '--project', 'project', '--document', document.documentId, '--prompt-file', file, '--daemon-url', `http://127.0.0.1:${address.port}`, '--json']);
    const result = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { alternativeBatch: { variantIds: string[] }; reserveAdjustments?: BlockoutReserveAdjustment[] };
    const appendedId = result.alternativeBatch.variantIds[0]!;
    expect(seen).toEqual([{ authoredByRun: true }]);
    expect(result.reserveAdjustments).toEqual([expect.objectContaining({ variantId: appendedId, pageId: 'page-1', blockIds: ['caption'] })]);
    const saved = (await readBlockoutWorkspace(root, document.documentId)).document!.variants.find((variant) => variant.id === appendedId)!;
    expect(saved.pages[0]).toMatchObject({ reservedFooterMm: 20, blocks: [{ id: 'caption', box: { y: 70 } }] });
  });
});
