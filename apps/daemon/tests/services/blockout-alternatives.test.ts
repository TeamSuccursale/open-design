import express, { type Response } from 'express';
import type { Server } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlockoutDocument, createBlockoutPage, type BlockoutDocument, type BlockoutHandoffResponse } from '@open-design/contracts';
import { registerBlockoutWorkspaceRoutes, type RegisterBlockoutWorkspaceRoutesDeps } from '../../src/routes/blockout-workspaces.js';
import { appendBlockoutAlternatives, readBlockoutWorkspace, saveBlockoutWorkspace, saveBlockoutWorkspaceStartingPoint } from '../../src/services/blockout-workspaces.js';
import { runBlockoutCli } from '../../src/services/blockout-cli.js';
import { ProjectDocumentScopeConflict } from '../../src/services/project-document-folders.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function initialDocument(): BlockoutDocument {
  const document = createBlockoutDocument();
  document.title = 'Report with saved engineer edits';
  document.pageBudget = { mode: 'exact', limit: 2, target: 2 };
  document.activeVariantId = 'baseline'; document.selectedVariantId = 'baseline';
  document.approval = { variantId: 'baseline', acceptedAt: '2026-10-24T12:00:00Z' };
  const figure = { id: 'figure', label: 'Optional figure', kind: 'image' as const,
    box: { x: 64, y: 56, width: 25, height: 16, rotation: 0 }, lockRatio: false, images: [],
    expectation: 'An empty placeholder', feedback: 'Smaller figure, more space for text', flexibility: 'guided' as const, references: [] };
  document.variants = [
    { id: 'baseline', label: 'Edited baseline', pages: [
      { ...createBlockoutPage('page-1', 'Opening'), blocks: [figure, { ...figure, id: 'text', kind: 'text', label: 'Continuous text', box: { ...figure.box, x: 7, width: 54 } }] },
      createBlockoutPage('page-2', 'Closing'),
    ] },
    { id: 'other', label: 'Other saved proposal', pages: [createBlockoutPage('page-1', 'Other opening'), createBlockoutPage('page-2', 'Other closing')] },
  ];
  document.answers = [{ formId: 'question', target: { variantId: 'baseline', pageId: 'page-1', blockId: 'figure' }, answers: { size: 'smaller' }, answeredAt: '2026-10-24T12:00:00Z' }];
  return document;
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'blockout-alternatives-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const document = initialDocument();
  await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: null });
  const current = () => readBlockoutWorkspace(root, document.documentId);
  const prepare = async (requestId = 'request-1', count = 1, variantId = 'baseline') => {
    const saved = await current();
    return saveBlockoutWorkspaceStartingPoint(root, document.documentId, { document: saved.document, baseRaw: saved.raw,
      requestId, variantId, operation: { type: 'append-alternatives', count, instruction: 'Keep the plan empty and improve the reading sequence.' } });
  };
  const candidates = (count = 1) => Array.from({ length: count }, (_, index) => ({ label: `New alternative ${index + 1}`, pages: [
    { ...createBlockoutPage('page-1', 'New opening'), blocks: [{ ...document.variants[0]!.pages[0]!.blocks[1]!, box: { x: 8, y: 10, width: 84, height: 65, rotation: 0 } }] },
    createBlockoutPage('page-2', 'New closing'),
  ] }));
  const save = async (change: (document: BlockoutDocument) => void) => {
    const saved = await current(); change(saved.document!);
    return saveBlockoutWorkspace(root, document.documentId, { document: saved.document, baseRaw: saved.raw });
  };
  return { root, document, current, prepare, candidates, save };
}

async function httpFixture() {
  const test = await fixture(), app = express(); app.use(express.json({ limit: '3mb' }));
  let scopeBlocked = false, publicationFailed = false;
  const deps = {
    db: {}, paths: { PROJECTS_DIR: path.dirname(test.root) }, authorizeProjectRequest: async () => true,
    beforeBlockoutWrite: async (_project: string, ids: unknown[]) => { if (scopeBlocked) throw new ProjectDocumentScopeConflict(String(ids[0]), 'other-workspace'); },
    documentRegistry: { blockoutUpdated: async () => { if (publicationFailed) throw new Error('Preview registry temporarily unavailable'); } },
    http: { sendApiError: (res: Response, status: number, code: string, message: string, init = {}) => res.status(status).json({ error: { code, message, ...init } }) },
    projectStore: { getProject: (_db: unknown, id: string) => id === 'project' ? { id, metadata: { kind: 'other', baseDir: test.root } } : null },
  } as unknown as RegisterBlockoutWorkspaceRoutesDeps;
  registerBlockoutWorkspaceRoutes(app, deps);
  const server: Server = await new Promise((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  cleanups.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Server did not bind');
  const base = `http://127.0.0.1:${address.port}`;
  const flags = ['--project', 'project', '--document', 'document-1', '--daemon-url', base, '--json'];
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  return { ...test, base, flags, result: () => JSON.parse(String(log.mock.calls.at(-1)?.[0])),
    scopeBlocked: () => { scopeBlocked = true; }, publicationFailed: () => { publicationFailed = true; } };
}

describe('request-bound Blockout alternatives', () => {
  it('freezes the actual edited base and appends a complete group without changing saved work, selection or approval', async () => {
    const test = await fixture(), before = (await test.current()).document!;
    const request = await test.prepare('request-two', 2);
    expect(request.handoff).toMatchObject({ id: 'request-two', action: 'request-proposals', operation: { type: 'append-alternatives', count: 2 } });
    expect(request.handoff.snapshot.variant).toEqual(before.variants[0]);
    expect(request.handoff.snapshot.answers).toEqual(before.answers);
    const result = await appendBlockoutAlternatives(test.root, 'document-1', { requestId: request.handoff.id, candidates: test.candidates(2) });
    expect(result.document!.variants.slice(0, 2)).toEqual(before.variants);
    expect(result.document).toMatchObject({ activeVariantId: 'baseline', selectedVariantId: 'baseline', approval: before.approval, answers: before.answers, pageBudget: before.pageBudget });
    expect(result.alternativeBatch).toMatchObject({ requestId: 'request-two', baseVariantId: 'baseline', replayed: false });
    expect(result.alternativeBatch.variantIds).toHaveLength(2);
    expect(result.document!.variants.slice(2).map((variant) => variant.id)).toEqual(result.alternativeBatch.variantIds);
    expect(JSON.parse(await readFile(path.join(test.root, 'blockout/layout.json'), 'utf8')).alternativeBatches).toHaveLength(1);
  });

  it('makes request preparation idempotent and captures an explicit proposal without selecting it', async () => {
    const test = await fixture();
    const first = await test.prepare('stable', 1, 'other');
    const replay = await test.prepare('stable', 1, 'other');
    expect(replay).toEqual(first);
    expect(first.handoff.snapshot.variant.id).toBe('other');
    expect((await test.current()).document).toMatchObject({ activeVariantId: 'baseline', selectedVariantId: 'baseline' });
    await expect(test.prepare('stable', 2, 'other')).rejects.toMatchObject({ code: 'BLOCKOUT_ALTERNATIVE_REQUEST_CONFLICT' });
  });

  it('replays results once, preserves receipts through old saves and never resurrects deliberately deleted proposals', async () => {
    const test = await fixture(); await test.prepare();
    const input = { requestId: 'request-1', candidates: test.candidates() };
    const first = await appendBlockoutAlternatives(test.root, 'document-1', input);
    expect((await appendBlockoutAlternatives(test.root, 'document-1', input)).alternativeBatch).toEqual({ ...first.alternativeBatch, replayed: true });
    await test.save((document) => {
      document.variants = document.variants.filter((variant) => !first.alternativeBatch.variantIds.includes(variant.id));
      document.variants[0]!.pages[0]!.feedback = 'A later independent edit';
      delete document.alternativeBatches;
    });
    const replay = await appendBlockoutAlternatives(test.root, 'document-1', input);
    expect(replay.alternativeBatch.replayed).toBe(true);
    expect(replay.document!.variants).toHaveLength(2);
    expect(replay.document!.variants[0]!.pages[0]!.feedback).toBe('A later independent edit');
    expect(replay.document!.alternativeBatches).toHaveLength(1);
    await expect(appendBlockoutAlternatives(test.root, 'document-1', { ...input, candidates: [{ ...input.candidates[0]!, label: 'Different result' }] })).rejects.toMatchObject({ code: 'BLOCKOUT_ALTERNATIVE_RESULT_CONFLICT' });
  });

  it.each(['feedback', 'page rules', 'deleted base'])('retains results and rejects %s drift without replacing user work', async (drift) => {
    const test = await fixture(); await test.prepare();
    await test.save((document) => {
      if (drift === 'feedback') document.variants[0]!.pages[0]!.blocks[0]!.feedback = 'Changed while the model worked';
      else if (drift === 'page rules') document.pageBudget = { mode: 'exact', limit: 3, target: 3 };
      else { document.variants.shift(); document.activeVariantId = 'other'; document.selectedVariantId = 'other'; delete document.approval; }
    });
    const before = await test.current();
    const error = await appendBlockoutAlternatives(test.root, 'document-1', { requestId: 'request-1', candidates: test.candidates() }).catch((failure: unknown) => failure) as { code: string; resultPath: string };
    expect(error.code).toBe('BLOCKOUT_ALTERNATIVE_BASE_CHANGED');
    expect(error.resultPath).toContain('.alternatives-result.json');
    expect(JSON.parse(await readFile(path.join(test.root, error.resultPath), 'utf8')).candidates).toEqual(test.candidates());
    expect(await test.current()).toEqual(before);
  });

  it('allows concurrent selection and another complete batch while preserving both', async () => {
    const test = await fixture(); await test.prepare('first'); await test.prepare('second');
    await test.save((document) => { document.activeVariantId = 'other'; document.selectedVariantId = 'other'; document.approval = { variantId: 'other', acceptedAt: 'later' }; });
    const first = await appendBlockoutAlternatives(test.root, 'document-1', { requestId: 'first', candidates: test.candidates() });
    const second = await appendBlockoutAlternatives(test.root, 'document-1', { requestId: 'second', candidates: test.candidates() });
    expect(second.document!.variants.slice(0, 3)).toEqual(first.document!.variants);
    expect(second.document).toMatchObject({ activeVariantId: 'other', selectedVariantId: 'other', approval: { variantId: 'other' } });
    expect(second.document!.alternativeBatches).toHaveLength(2);
  });

  it('serializes simultaneous retries into one batch and rejects replacement-document payloads', async () => {
    const test = await fixture(); await test.prepare();
    const input = { requestId: 'request-1', candidates: test.candidates() };
    const results = await Promise.all([appendBlockoutAlternatives(test.root, 'document-1', input), appendBlockoutAlternatives(test.root, 'document-1', input)]);
    expect(results.map((result) => result.alternativeBatch.replayed)).toEqual([false, true]);
    expect(results[0]!.alternativeBatch.variantIds).toEqual(results[1]!.alternativeBatch.variantIds);
    const before = await test.current();
    await expect(appendBlockoutAlternatives(test.root, 'document-1', { ...input, document: { ...before.document, variants: [] } })).rejects.toThrow('Unrecognized key');
    expect(await test.current()).toEqual(before);
  });

  it('rejects incomplete/invalid results before mutation and keeps ordinary saves and old handoffs compatible', async () => {
    const test = await fixture(); await test.prepare('two', 2);
    const before = await test.current();
    await expect(appendBlockoutAlternatives(test.root, 'document-1', { requestId: 'two', candidates: test.candidates() })).rejects.toThrow('every requested');
    const invalid = test.candidates(2); invalid[0]!.pages[0]!.blocks.push(invalid[0]!.pages[0]!.blocks[0]!);
    await expect(appendBlockoutAlternatives(test.root, 'document-1', { requestId: 'two', candidates: invalid })).rejects.toThrow('Duplicate block');
    expect(await test.current()).toEqual(before);
    expect((await readdir(path.join(test.root, 'blockouts/document-1/handoffs'))).filter((file) => file.endsWith('.alternatives-result.json'))).toHaveLength(0);
    const legacy = await saveBlockoutWorkspaceStartingPoint(test.root, 'document-1', { document: before.document, baseRaw: before.raw });
    expect(legacy.handoff.operation).toBeUndefined();
    await expect(appendBlockoutAlternatives(test.root, 'document-1', { requestId: legacy.handoff.id, candidates: test.candidates() })).rejects.toThrow('does not authorize');
    await test.save((document) => { document.variants.pop(); document.variants[0]!.pages.pop(); });
    expect((await test.current()).document!.variants[0]!.pages).toHaveLength(1);
  });

  it('does not silently drop existing proposals at capacity or mutate sibling documents', async () => {
    const test = await fixture();
    const sibling = { ...createBlockoutDocument(), documentId: 'other-document', title: 'Independent sibling' };
    await saveBlockoutWorkspace(test.root, sibling.documentId, { document: sibling, baseRaw: null });
    const siblingBefore = await readBlockoutWorkspace(test.root, sibling.documentId);
    await test.save((document) => { for (let index = 2; index < 12; index++) document.variants.push({ ...document.variants[1]!, id: `kept-${index}` }); });
    await test.prepare(); const before = await test.current();
    await expect(appendBlockoutAlternatives(test.root, 'document-1', { requestId: 'request-1', candidates: test.candidates() })).rejects.toMatchObject({ code: 'BLOCKOUT_ALTERNATIVE_CAPACITY', resultPath: expect.stringContaining('.alternatives-result.json') });
    expect(await test.current()).toEqual(before);
    expect(await readBlockoutWorkspace(test.root, sibling.documentId)).toEqual(siblingBefore);
  });
});

describe('alternative HTTP and CLI parity', () => {
  it('requests the latest chosen proposal, then appends visible results through real HTTP/CLI and replays safely', async () => {
    const test = await httpFixture();
    await test.save((document) => { document.activeVariantId = 'other'; document.variants[0]!.pages[0]!.blocks[0]!.box.width = 23; });
    const instructionFile = path.join(test.root, 'instruction.txt'); await writeFile(instructionFile, 'A more continuous text-led alternative.\nKeep my edited figure small.');
    await runBlockoutCli(['request-alternatives', ...test.flags, '--request-id', 'cli-request', '--count', '1', '--prompt-file', instructionFile]);
    const request = test.result() as BlockoutHandoffResponse;
    expect(request.handoff.snapshot.variant.id).toBe('baseline');
    expect(request.handoff.snapshot.variant.pages[0]!.blocks[0]!.box.width).toBe(23);
    expect(request.handoff.operation?.instruction).toContain('\nKeep my edited figure');
    const input = path.join(test.root, 'candidates.json'); await writeFile(input, JSON.stringify({ requestId: request.handoff.id, candidates: test.candidates() }));
    await runBlockoutCli(['append-alternatives', ...test.flags, '--prompt-file', input]);
    const result = test.result();
    expect(result.document.variants).toHaveLength(3); expect(result.document.selectedVariantId).toBe('baseline');
    expect(await readFile(path.join(test.root, result.comparisonPath), 'utf8')).toContain('New alternative 1');
    await runBlockoutCli(['append-alternatives', ...test.flags, '--prompt-file', input]);
    expect(test.result().alternativeBatch).toEqual({ ...result.alternativeBatch, replayed: true });
    expect(test.result().document.variants).toHaveLength(3);
  });

  it('rejects unauthorized document scope before writing and returns recoverable conflict details', async () => {
    const test = await httpFixture(); await test.prepare(); const before = await test.current(); test.scopeBlocked();
    const response = await fetch(`${test.base}/api/projects/project/blockout-documents/document-1/alternatives`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'request-1', candidates: test.candidates() }) });
    expect(response.status).toBe(409); expect((await response.json() as { error: { code: string } }).error.code).toBe('DOCUMENT_WORKSPACE_REQUIRED');
    expect(await test.current()).toEqual(before);
  });

  it('reports committed append success with a publication warning instead of false mutation failure', async () => {
    const test = await httpFixture(); await test.prepare(); test.publicationFailed();
    const input = path.join(test.root, 'candidates.json'); await writeFile(input, JSON.stringify({ requestId: 'request-1', candidates: test.candidates() }));
    await runBlockoutCli(['append-alternatives', ...test.flags, '--prompt-file', input]);
    expect(test.result()).toMatchObject({ alternativeBatch: { replayed: false }, comparisonError: 'Preview registry temporarily unavailable' });
    expect((await test.current()).document!.variants).toHaveLength(3);
    await runBlockoutCli(['append-alternatives', ...test.flags, '--prompt-file', input]);
    expect(test.result().alternativeBatch.replayed).toBe(true);
    expect((await test.current()).document!.variants).toHaveLength(3);
  });

  it('returns a retained result reference for a drift conflict through HTTP and CLI', async () => {
    const test = await httpFixture(); await test.prepare();
    await test.save((document) => { document.variants[0]!.pages[0]!.feedback = 'Changed after requesting'; });
    const input = { requestId: 'request-1', candidates: test.candidates() };
    const response = await fetch(`${test.base}/api/projects/project/blockout-documents/document-1/alternatives`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    const failure = await response.json() as { error: { code: string; details: { resultPath: string } } };
    expect(response.status).toBe(409); expect(failure.error.code).toBe('BLOCKOUT_ALTERNATIVE_BASE_CHANGED');
    expect(JSON.parse(await readFile(path.join(test.root, failure.error.details.resultPath), 'utf8')).candidates).toEqual(input.candidates);
    const inputFile = path.join(test.root, 'drifted-results.json'); await writeFile(inputFile, JSON.stringify(input));
    await expect(runBlockoutCli(['append-alternatives', ...test.flags, '--prompt-file', inputFile])).rejects.toThrow(failure.error.details.resultPath);
    expect((await test.current()).document!.variants).toHaveLength(2);
  });
});
