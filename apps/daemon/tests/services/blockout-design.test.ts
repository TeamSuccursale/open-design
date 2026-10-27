import express, { type Response } from 'express';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { adoptAppliedBlockoutDesign, createBlockoutDocument, type BlockoutDocument } from '@open-design/contracts';
import { recordBlockoutDesign, readBlockoutDesignState, readBlockoutDesignUnderlay, type BlockoutDesignRun } from '../../src/services/blockout-design.js';
import { readBlockoutWorkspace, saveBlockoutWorkspace, saveBlockoutWorkspaceStartingPoint } from '../../src/services/blockout-workspaces.js';
import { registerBlockoutWorkspaceRoutes, type RegisterBlockoutWorkspaceRoutesDeps } from '../../src/routes/blockout-workspaces.js';
import { runBlockoutCli } from '../../src/services/blockout-cli.js';
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'blockout-design-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const document = createBlockoutDocument(); document.title = 'Composition test';
  document.approval = { variantId: 'brief', acceptedAt: '2026-10-26T10:00:00Z' };
  document.variants[0]!.pages[0]!.backgroundIntent = 'A free watermark across the whole page';
  document.variants[0]!.pages[0]!.blocks = [{ id: 'body', label: 'Text', kind: 'text', box: { x: 10, y: 10, width: 80, height: 60, rotation: 0 }, images: [], references: [], lockRatio: false, expectation: '', feedback: '', flexibility: 'guided' },
    { id: 'background', label: 'Watermark suggestion', kind: 'mixed', designRole: 'background', box: { x: 0, y: 0, width: 100, height: 100, rotation: 0 }, images: [], references: [], lockRatio: false, expectation: '', feedback: '', flexibility: 'free' }];
  const current = () => readBlockoutWorkspace(root, document.documentId);
  const save = async (mutate: (value: BlockoutDocument) => void) => { const state = await current(); mutate(state.document!); return saveBlockoutWorkspace(root, document.documentId, { document: state.document, baseRaw: state.raw }); };
  await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: null });
  const prepare = async (id: string, action: 'develop-design' | 'update-design' = 'develop-design') => { const state = await current(); return saveBlockoutWorkspaceStartingPoint(root, document.documentId, { document: state.document, baseRaw: state.raw, requestId: id, action }); };
  const request = await prepare('initial');
  await writeFile(path.join(root, 'report.html'), '<html><head><style>.watermark{position:absolute;inset:0}</style></head><body><article data-blockout-document-id="document-1" data-blockout-page-id="page-1"><div class="watermark">Page-wide art</div><p data-blockout-id="body">Lorem ipsum</p></article></body></html>');
  let run: BlockoutDesignRun = { projectId: 'project', status: 'running' };
  const getRun = (id: string) => id === 'run' ? run : undefined;
  const payload = { handoffId: request.handoff.id, runId: 'run', entryFile: 'report.html', pages: [{ pageId: 'page-1', filePath: 'report.html', widthPx: 794, heightPx: 1123, blocks: [{ blockId: 'body', box: { x: 12, y: 13, width: 76, height: 63, rotation: 0 } }] }] };
  const record = () => recordBlockoutDesign(root, document.documentId, 'project', payload, getRun);
  const state = () => readBlockoutDesignState(root, document.documentId, 'project', getRun);
  return { root, document, current, save, prepare, payload, record, state, getRun, run: (value: BlockoutDesignRun) => { run = value; } };
}
it('stages during a run and applies measured semantic bounds only after successful validation; decoration remains unboxed', async () => {
  const f = await fixture(); expect((await f.state()).applied).toBeNull();
  expect((await f.record()).applied).toBeNull();
  f.run({ projectId: 'project', status: 'succeeded' }); expect((await f.state()).applied).toBeNull();
  f.run({ projectId: 'project', status: 'succeeded', deliverableValid: true }); const applied = (await f.state()).applied!;
  expect(applied.snapshot.variant.pages[0]!.blocks[0]!.box.x).toBe(12);
  expect(applied.snapshot.variant.pages[0]!.backgroundIntent).toContain('whole page');
  await f.save((value) => Object.assign(value, adoptAppliedBlockoutDesign(value, applied)));
  expect((await f.current()).document!.variants[0]!.pages[0]!.blocks[0]!.box.x).toBe(12);
  expect((await readBlockoutDesignUnderlay(f.root, f.document.documentId, 'page-1')).html).toContain('Page-wide art');
  expect((await f.record()).applied!.revisionId).toBe(applied.revisionId);
});
it.each(['failed', 'cancelled', 'invalid'])('does not promote a %s run', async (status) => {
  const f = await fixture(); await f.record();
  f.run({ projectId: 'project', status: status === 'invalid' ? 'succeeded' : status, deliverableValid: false });
  expect((await f.state()).applied).toBeNull(); expect((await f.state()).pending[0]!.status).toBe('failed');
});
it('preserves edits saved during generation, and compares repeated drafts against applied design rather than unsent drafts', async () => {
  const f = await fixture(); await f.record(); await f.save((value) => { value.variants[0]!.pages[0]!.blocks[0]!.box.x = 20; value.needsReadaptation = true; });
  f.run({ projectId: 'project', status: 'succeeded', deliverableValid: true }); const applied = (await f.state()).applied!;
  await f.save((value) => Object.assign(value, adoptAppliedBlockoutDesign(value, applied)));
  expect((await f.current()).document!.variants[0]!.pages[0]!.blocks[0]!.box.x).toBe(20);
  const first = await f.prepare('draft-1', 'update-design');
  await f.save((value) => { value.variants[0]!.pages[0]!.blocks[0]!.box.x = 24; });
  const second = await f.prepare('draft-2', 'update-design');
  expect(second.handoff.designBase!.revisionId).toBe(first.handoff.designBase!.revisionId);
  expect(second.handoff.comparisonBasis).toBe('applied-design');
  expect(second.handoff.changes.find((change) => change.blockId === 'body')!.before).toMatchObject({ box: { x: 12 } });
  expect((await f.state()).applied!.revisionId).toBe(applied.revisionId);
});
it('detects changed source and rejects unsafe paths, unknown blocks, unrelated runs and non-design handoffs', async () => {
  const f = await fixture(); await expect(recordBlockoutDesign(f.root, f.document.documentId, 'wrong-project', f.payload, f.getRun)).rejects.toThrow('project');
  await expect(recordBlockoutDesign(f.root, f.document.documentId, 'project', { ...f.payload, entryFile: '../outside.html' }, f.getRun)).rejects.toThrow();
  await expect(recordBlockoutDesign(f.root, f.document.documentId, 'project', { ...f.payload, pages: [{ ...f.payload.pages[0], blocks: [{ ...f.payload.pages[0]!.blocks[0], blockId: 'unknown' }] }] }, f.getRun)).rejects.toThrow('Unknown mapped block');
  const raw = await f.current(); const structural = await saveBlockoutWorkspaceStartingPoint(f.root, f.document.documentId, { document: raw.document, baseRaw: raw.raw, requestId: 'structural', action: 'request-proposals' });
  await expect(recordBlockoutDesign(f.root, f.document.documentId, 'project', { ...f.payload, handoffId: structural.handoff.id }, f.getRun)).rejects.toThrow('does not authorize');
  await f.record(); await writeFile(path.join(f.root, 'report.html'), 'Changed during the run');
  f.run({ projectId: 'project', status: 'succeeded', deliverableValid: true }); expect((await f.state()).pending[0]!.status).toBe('source-changed');
  expect((await f.state()).applied).toBeNull();
});
it('rejects an old baseline after another revision applies and reports externally modified applied files', async () => {
  const f = await fixture(); await f.record(); f.run({ projectId: 'project', status: 'succeeded', deliverableValid: true }); await f.state();
  await expect(recordBlockoutDesign(f.root, f.document.documentId, 'project', { ...f.payload, runId: 'later' }, () => ({ projectId: 'project', status: 'running' }))).rejects.toThrow('superseded');
  await writeFile(path.join(f.root, 'report.html'), '<p>Externally edited</p>'); expect((await f.state()).sourceChanged).toBe(true);
});
it('exposes record, state and saved page through the same HTTP routes and JSON CLI', async () => {
  const f = await fixture(), app = express(); app.use(express.json());
  registerBlockoutWorkspaceRoutes(app, { db: {}, paths: { PROJECTS_DIR: path.dirname(f.root) }, getDesignRun: f.getRun, authorizeProjectRequest: async () => true,
    projectStore: { getProject: () => ({ id: 'project', metadata: { kind: 'other', baseDir: f.root } }) },
    http: { sendApiError: (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
  } as unknown as RegisterBlockoutWorkspaceRoutesDeps);
  const server = await new Promise<Server>((resolve) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); }); cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as { port: number }; vi.stubEnv('OD_RUN_ID', 'run');
  const daemon = ['--daemon-url', `http://127.0.0.1:${address.port}`];
  const input = path.join(f.root, 'record.json'); await writeFile(input, JSON.stringify({ ...f.payload, runId: undefined }));
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await runBlockoutCli(['design-record', '--project', 'project', '--document', 'document-1', '--prompt-file', input, '--json', ...daemon]);
  expect(JSON.parse(String(output.mock.calls.at(-1)![0])).pending[0].status).toBe('pending');
  f.run({ projectId: 'project', status: 'succeeded', deliverableValid: true });
  const beforeRead = (await f.current()).raw;
  await runBlockoutCli(['design', '--project', 'project', '--document', 'document-1', '--json', ...daemon]);
  expect(JSON.parse(String(output.mock.calls.at(-1)![0])).applied.entryFile).toBe('report.html');
  await runBlockoutCli(['design-page', '--project', 'project', '--document', 'document-1', '--page', 'page-1', '--json', ...daemon]);
  expect(JSON.parse(String(output.mock.calls.at(-1)![0])).html).toContain('Lorem ipsum');
  expect((await f.current()).raw).toBe(beforeRead); // State and underlay reads cannot invalidate an open editor.
  expect(await readFile(path.join(f.root, 'report.html'), 'utf8')).toContain('Page-wide art');
});
it('rejects missing or mismatched document identity on later page markers and on the entry', async () => {
  const f = await fixture();
  const source = await readFile(path.join(f.root, 'report.html'), 'utf8');
  for (const html of [source.replace('data-blockout-document-id="document-1"', ''), source.replace('data-blockout-document-id="document-1"', 'data-blockout-document-id="other"'), source.replace('<article data-', '<article data-blockout-document-id="document-1"></article><article data-').replace('data-blockout-document-id="document-1" data-blockout-page-id', 'data-blockout-page-id')]) {
    await writeFile(path.join(f.root, 'report.html'), html);
    await expect(f.record()).rejects.toThrow('data-blockout-document-id');
  }
});
it('limits delegated collection runs to the exact validated owner, document, handoff and digest', async () => {
  const f = await fixture();
  const handoff = await readFile(path.join(f.root, `blockouts/document-1/handoffs/${f.payload.handoffId}.blockout-update.json`), 'utf8');
  const target = { projectId: 'project', documentId: 'document-1', handoffId: f.payload.handoffId, handoffSha256: createHash('sha256').update(handoff).digest('hex') };
  for (const invalid of [{ ...target, projectId: 'other' }, { ...target, documentId: 'other' }, { ...target, handoffId: 'other' }, { ...target, handoffSha256: '0'.repeat(64) }]) {
    await expect(recordBlockoutDesign(f.root, 'document-1', 'project', f.payload,
      () => ({ projectId: 'parent', status: 'running', blockoutDesignTargets: [invalid] }))).rejects.toThrow('explicitly attached');
  }
  const pending = await recordBlockoutDesign(f.root, 'document-1', 'project', f.payload,
    () => ({ projectId: 'parent', status: 'running', blockoutDesignTargets: [target] }));
  expect(pending.pending[0]!.runProjectId).toBe('parent');
  const wrongOwner = await readBlockoutDesignState(f.root, 'document-1', 'project', () => ({ projectId: 'unrelated', status: 'succeeded', deliverableValid: true }));
  expect(wrongOwner.applied).toBeNull();
  expect(wrongOwner.pending[0]!.status).toBe('pending');
  // Restart discards transient prompt/grant state; the validated receipt still
  // identifies the actual parent run for terminal reconciliation and replay.
  const lookup = () => ({ projectId: 'parent', status: 'succeeded', deliverableValid: true });
  const applied = await readBlockoutDesignState(f.root, 'document-1', 'project', lookup);
  expect(applied.applied?.runId).toBe('run');
  expect((await recordBlockoutDesign(f.root, 'document-1', 'project', f.payload, lookup)).applied?.revisionId).toBe(applied.applied?.revisionId);
});
// Run 2's A3 plate registered a measured box 10.6 mm past the right margin and nothing said so.
it('refuses a designed block that runs past the page margin, and names the block, the side and the millimetres', async () => {
  const f = await fixture();
  const wide = { ...f.payload, pages: [{ ...f.payload.pages[0]!, blocks: [{ blockId: 'body', box: { x: 12, y: 13, width: 86, height: 63, rotation: 0 } }] }] };
  await expect(recordBlockoutDesign(f.root, f.document.documentId, 'project', wide, f.getRun)).rejects.toThrow(/Text \(body\) on page 1 runs 5\.8 mm past the right margin/);
  const hairline = { ...f.payload, pages: [{ ...f.payload.pages[0]!, blocks: [{ blockId: 'body', box: { x: 12, y: 13, width: 83.4, height: 63, rotation: 0 } }] }] };
  expect((await recordBlockoutDesign(f.root, f.document.documentId, 'project', hairline, f.getRun)).pending).toHaveLength(1);
});
it('accepts a designed block past the margin when the approved Blockout already placed it there', async () => {
  const f = await fixture();
  await f.save((value) => { value.variants[0]!.pages[0]!.blocks[0]!.box = { x: 0, y: 10, width: 100, height: 60, rotation: 0 }; });
  const request = await f.prepare('bleed');
  const bleed = { ...f.payload, handoffId: request.handoff.id, pages: [{ ...f.payload.pages[0]!, blocks: [{ blockId: 'body', box: { x: 0, y: 13, width: 100, height: 63, rotation: 0 } }] }] };
  expect((await recordBlockoutDesign(f.root, f.document.documentId, 'project', bleed, f.getRun)).pending).toHaveLength(1);
});
