import express from 'express';
import type { Response } from 'express';
import type { Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlockoutDocument, createBlockoutPage, type BlockoutDocument, type BlockoutWorkspaceResponse } from '@open-design/contracts';
import { registerBlockoutWorkspaceRoutes, type RegisterBlockoutWorkspaceRoutesDeps } from '../../src/routes/blockout-workspaces.js';
import { saveBlockoutWorkspace } from '../../src/services/blockout-workspaces.js';
import { runBlockoutCli } from '../../src/services/blockout-cli.js';
import { loadBlockoutContext, prepareBlockoutContextFiles, renderFrozenBlockoutContext } from '../../src/services/blockout-context.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });

function documentFixture(): BlockoutDocument {
  const document = createBlockoutDocument();
  document.title = 'Document structure';
  document.pageBudget = { mode: 'maximum', limit: 4, target: 4, source: 'Disciplinare, p. 8' };
  document.variants[0]!.pages = [createBlockoutPage('page-1', 'Opening'), createBlockoutPage('page-2', 'Details')];
  document.variants[0]!.pages[0]!.blocks.push({
    id: 'figure', label: 'Engineer drawing', kind: 'drawing', box: { x: 10, y: 20, width: 50, height: 30, rotation: 10 },
    lockRatio: true, images: [], expectation: 'Preserve the geometry', feedback: 'Keep the legend', flexibility: 'guided', references: [],
  });
  document.variants.push({ id: 'alternative', label: 'Alternative', pages: Array.from({ length: 4 }, (_, index) => createBlockoutPage(`alt-${index + 1}`, `Page ${index + 1}`)) });
  document.variants[1]!.pages.unshift({ ...createBlockoutPage('cover', 'Cover'), countsTowardLimit: false });
  return document;
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'blockout-overview-cli-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const document = documentFixture();
  await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: null });
  const app = express(); app.use(express.json());
  let conflict = false;
  app.put('/api/projects/project/blockout-documents/:documentId', async (_req, _res, next) => {
    if (conflict) {
      conflict = false;
      const target = path.join(root, 'blockout/layout.json');
      const edited = JSON.parse(await readFile(target, 'utf8')) as BlockoutDocument;
      edited.title = 'Concurrent user edit';
      await writeFile(target, JSON.stringify(edited));
    }
    next();
  });
  registerBlockoutWorkspaceRoutes(app, {
    db: {}, paths: { PROJECTS_DIR: path.dirname(root) },
    authorizeProjectRequest: async () => true,
    http: { sendApiError: (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
    projectStore: { getProject: (_db: unknown, id: string) => id === 'project' ? { id, metadata: { kind: 'other', baseDir: root } } : null },
  } as unknown as RegisterBlockoutWorkspaceRoutesDeps);
  const server: Server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Server did not bind');
  const flags = ['--project', 'project', '--daemon-url', `http://127.0.0.1:${address.port}`, '--json'];
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  return { root, document, flags, conflictNextWrite: () => { conflict = true; }, result: () => JSON.parse(String(log.mock.calls.at(-1)?.[0])) };
}

describe('Blockout overview CLI', () => {
  it('publishes an inventory-free selection comparison and checks the plan through CLI without reading actual material', async () => {
    const test = await fixture();
    await runBlockoutCli(['assess', ...test.flags]);
    expect(test.result().assessment).toMatchObject({ basis: 'structure', inventoryRevision: null, selectedContentIds: [] });
    const document = test.document;
    document.variants[0]!.pages[0]!.blocks[0]!.feedback = 'Reserve a watermark behind this text block';
    const saved = await saveBlockoutWorkspace(test.root, document.documentId, { document, baseRaw: await readFile(path.join(test.root, 'blockout/layout.json'), 'utf8') });
    const file = path.join(test.root, 'structural-save.json');
    await writeFile(file, JSON.stringify({ document, baseRaw: saved.raw }));
    await runBlockoutCli(['save', ...test.flags, '--prompt-file', file]);
    expect(test.result().comparisonPath).toContain('blockout-comparison.html');
    const html = await readFile(path.join(test.root, test.result().comparisonPath), 'utf8');
    expect(html).not.toContain('<image'); expect(html).toContain('Scegli questa struttura');
    expect(html).not.toContain('Apri e modifica i blocchi');
  });
  it('hands off a revisioned selected structure through the real HTTP/CLI boundary with feedback diffs and lazy asset paths', async () => {
    const test = await fixture(), input = path.join(test.root, 'handoff-input.json');
    const doc = test.document;
    doc.variants[0]!.pages[0]!.blocks[0]!.images.push({ assetId: 'asset', imagePath: 'images/drawing.png', title: 'Drawing', description: '', sourceName: 'source.pdf', sourcePath: 'source.pdf', page: 1, width: 800, height: 600 });
    let saved = await saveBlockoutWorkspace(test.root, doc.documentId, { document: doc, baseRaw: await readFile(path.join(test.root, 'blockout/layout.json'), 'utf8') });
    await writeFile(input, JSON.stringify({ document: doc, baseRaw: saved.raw }));
    await runBlockoutCli(['brief', ...test.flags, '--prompt-file', input]);
    const first = test.result();
    expect(first.handoff).toMatchObject({ type: 'blockout-update', action: 'request-proposals', comparison: 'initial', changes: [] });
    expect(first.handoff.snapshot.variant.pages[0].blocks[0].images[0].imagePath).toBe('images/drawing.png');
    expect(first.handoff.snapshot.variants).toBeUndefined();
    expect(JSON.parse(await readFile(path.join(test.root, first.path), 'utf8'))).toEqual(first.handoff);
    doc.variants[0]!.pages[0]!.blocks[0]!.box.width = 32;
    doc.variants[0]!.pages[0]!.blocks[0]!.feedback = 'Make the drawing smaller';
    saved = await saveBlockoutWorkspace(test.root, doc.documentId, { document: doc, baseRaw: saved.raw });
    await writeFile(input, JSON.stringify({ document: doc, baseRaw: saved.raw }));
    await runBlockoutCli(['brief', ...test.flags, '--prompt-file', input]);
    const second = test.result();
    expect(second.handoff).toMatchObject({ previousHandoffId: first.handoff.id, previousWorkspaceRevision: first.handoff.workspaceRevision, comparison: 'same-proposal' });
    expect(second.handoff.changes).toEqual(expect.arrayContaining([expect.objectContaining({ target: 'block', blockId: 'figure', fields: ['box', 'feedback'], after: expect.objectContaining({ feedback: 'Make the drawing smaller' }) })]));
    expect(JSON.parse(await readFile(path.join(test.root, first.path), 'utf8'))).toEqual(first.handoff);
    const other = { ...createBlockoutDocument(), documentId: 'document-other', title: 'Unrelated report' };
    await saveBlockoutWorkspace(test.root, other.documentId, { document: other, baseRaw: null, startingPoint: true });
    const context = await loadBlockoutContext(test.root, [second.path]);
    expect(context).toContain('Make the drawing smaller'); expect(context).not.toContain('Unrelated report');
    const frozenFiles = await prepareBlockoutContextFiles(test.root, [second.path]);
    expect(renderFrozenBlockoutContext([{ mediaType: 'text/plain', content: await readFile(path.join(test.root, frozenFiles[0]!)) }])).toContain('Make the drawing smaller');
    expect(frozenFiles).not.toContain('images/drawing.png');
    await writeFile(input, JSON.stringify({ document: doc, baseRaw: first.handoff.workspaceRevision }));
    await expect(runBlockoutCli(['brief', ...test.flags, '--prompt-file', input])).rejects.toThrow('blockout.conflict');
  });
  it('reports all proposal pages and distinguishes the source maximum from the full-budget target', async () => {
    const test = await fixture();
    await runBlockoutCli(['overview', ...test.flags]);
    expect(test.result()).toMatchObject({ documentId: 'document-1', pageBudget: { mode: 'maximum', limit: 4, target: 4 } });
    expect(test.result().proposals).toHaveLength(2);
    expect(test.result().proposals[0].pageBudgetStatus).toMatchObject({ total: 2, counted: 2, excluded: 0, unfilled: 2, over: 0 });
    expect(test.result().proposals[1].pageBudgetStatus).toMatchObject({ total: 5, counted: 4, excluded: 1, unfilled: 0, over: 0 });
    await runBlockoutCli(['overview', ...test.flags, '--variant', 'alternative']);
    expect(test.result().proposals).toHaveLength(1);
    expect(test.result().proposals[0].pages.map((page: { id: string }) => page.id)).toEqual(['cover', 'alt-1', 'alt-2', 'alt-3', 'alt-4']);
  });

  it('moves a block with all its feedback, retargets answers and persists the current revision', async () => {
    const test = await fixture();
    const document = test.document;
    document.approval = { variantId: 'brief', acceptedAt: '2026-10-23T12:00:00Z' };
    document.answers.push({ formId: 'question', target: { variantId: 'brief', pageId: 'page-1', blockId: 'figure' }, answers: { role: 'main' }, answeredAt: '2026-10-23T12:00:00Z' });
    const current = JSON.parse(await readFile(path.join(test.root, 'blockout/layout.json'), 'utf8'));
    const file = path.join(test.root, 'save.json');
    await writeFile(file, JSON.stringify({ document, baseRaw: `${JSON.stringify(current, null, 2)}\n` }));
    await runBlockoutCli(['save', ...test.flags, '--prompt-file', file]);
    await runBlockoutCli(['move-block', ...test.flags, '--variant', 'brief', '--source-page', 'page-1', '--block', 'figure', '--target-page', 'page-2']);
    const result = test.result() as BlockoutWorkspaceResponse;
    expect(result.document!.variants[0]!.pages[0]!.blocks).toHaveLength(0);
    expect(result.document!.variants[0]!.pages[1]!.blocks[0]).toEqual(document.variants[0]!.pages[0]!.blocks[0]);
    expect(result.document!.answers[0]!.target.pageId).toBe('page-2');
    expect(result.document!.needsReadaptation).toBe(true);
    expect(JSON.parse(await readFile(path.join(test.root, 'blockouts/document-1/page-2.blockout.json'), 'utf8')).variants[0].page.blocks[0].id).toBe('figure');
  });

  it('accepts a move through stdin and reorders the complete page sequence', async () => {
    const test = await fixture();
    vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(async function* () {
      yield JSON.stringify({ variantId: 'brief', sourcePageId: 'page-1', blockId: 'figure', targetPageId: 'page-2' });
    });
    await runBlockoutCli(['move-block', ...test.flags, '--prompt-file', '-']);
    await runBlockoutCli(['reorder-pages', ...test.flags, '--variant', 'brief', '--page-order', 'page-2,page-1']);
    expect(test.result().document.variants[0].pages.map((page: { id: string }) => page.id)).toEqual(['page-2', 'page-1']);
    expect(test.result().document.variants[0].pages[0].blocks[0].id).toBe('figure');
    await expect(runBlockoutCli(['reorder-pages', ...test.flags, '--page-order', 'page-1'])).rejects.toThrow();
  });

  it('saves long budget notes from a file while keeping citations and a flexible planning target', async () => {
    const test = await fixture(), file = path.join(test.root, 'planning-note.txt');
    const note = 'Keep the opening and detail sequence together.\nThe engineer will confirm which annexes count.';
    await writeFile(file, note);
    await runBlockoutCli(['budget', ...test.flags, '--mode', 'flexible', '--limit', 'none', '--target', '6', '--source', 'Engineer planning brief', '--prompt-file', file]);
    expect(test.result().document.pageBudget).toEqual({ mode: 'flexible', target: 6, source: 'Engineer planning brief', note });
    await runBlockoutCli(['overview', ...test.flags]);
    expect(test.result().proposals[0].pageBudgetStatus).toMatchObject({ target: 6, unfilled: 4, over: 0 });
  });

  it('accepts structured budgets and aligns an exact requirement with its target', async () => {
    const test = await fixture(), file = path.join(test.root, 'budget.json');
    await writeFile(file, JSON.stringify({ mode: 'maximum', limit: 8, target: 8, source: 'Disciplinare, p. 9', note: 'Use all eight pages for the tender.' }));
    await runBlockoutCli(['budget', ...test.flags, '--prompt-file', file]);
    expect(test.result().document.pageBudget.target).toBe(8);
    await runBlockoutCli(['budget', ...test.flags, '--mode', 'exact', '--limit', '4']);
    expect(test.result().document.pageBudget).toMatchObject({ mode: 'exact', limit: 4, target: 4 });
    await expect(runBlockoutCli(['budget', ...test.flags, '--mode', 'maximum', '--limit', '3', '--target', '4'])).rejects.toThrow();
  });

  it('fails visibly on a concurrent revision without overwriting the other edit', async () => {
    const test = await fixture(); test.conflictNextWrite();
    await expect(runBlockoutCli(['move-block', ...test.flags, '--source-page', 'page-1', '--block', 'figure', '--target-page', 'page-2'])).rejects.toThrow('blockout.conflict');
    const document = JSON.parse(await readFile(path.join(test.root, 'blockout/layout.json'), 'utf8')) as BlockoutDocument;
    expect(document.title).toBe('Concurrent user edit');
    expect(document.variants[0]!.pages[0]!.blocks).toHaveLength(1);
  });
});
