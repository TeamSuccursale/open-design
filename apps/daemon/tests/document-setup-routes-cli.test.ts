import express from 'express';
import type { Response } from 'express';
import type { Server } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDocumentSetupRoutes, type RegisterDocumentSetupRoutesDeps } from '../src/routes/document-setup.js';
import { runDocumentSetupCli } from '../src/services/document-setup-cli.js';
import { registerBlockoutWorkspaceRoutes } from '../src/routes/blockout-workspaces.js';
import { runBlockoutCli } from '../src/services/blockout-cli.js';
import { documentSetupRunGate, loadDocumentSetupContext, readDocumentSetup } from '../src/services/document-setup.js';
import { assertVisibleForImportedProject } from '../src/projects.js';
import { createBlockoutDocument, createBlockoutPage, type DocumentSetupResponse, type BlockoutDocumentCatalog, type BlockoutWorkspaceResponse } from '@open-design/contracts';

const testEditorialSettings = [{ documentId: 'document-1', presentation: { version: 1, status: 'confirmed', name: 'Test document', header: false, footer: false, cover: false, pageNumbers: false, numberOnCover: null, coverCountsTowardPageLimit: null, coverCountsInNumbering: null, numberingStart: 1 } }];
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'document-setup-api-'));
  const referenceRoot = await mkdtemp(path.join(tmpdir(), 'document-reference-'));
  const legacyRoot = await mkdtemp(path.join(tmpdir(), 'document-legacy-'));
  const projectsDir = path.join(root, 'managed-projects');
  const missingImportedRoot = path.join(root, 'missing-imported-folder');
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  cleanup.push(() => rm(referenceRoot, { recursive: true, force: true }));
  cleanup.push(() => rm(legacyRoot, { recursive: true, force: true }));
  await writeFile(path.join(root, 'disciplinare.txt'), 'Relazione: massimo 5 pagine. Formato A4 verticale.');
  await writeFile(path.join(referenceRoot, 'relazione-contesto.txt'), 'Riferimento del progetto precedente. Formato A3; questa non è una regola per altri progetti.');
  const app = express(); app.use(express.json());
  const intent = { kind: 'tender-offer', subtype: 'Offerta metodologica', purpose: '', contextRoots: [], imageIntakeDecision: 'declined' };
  let authorized = true;
  const denied = new Set<string>();
  const authorize = vi.fn(async (_req, res, id, _options) => { if (!authorized || denied.has(id)) { res.status(403).json({ error: 'Denied' }); return false; } return true; });
  const dependencies = {
    db: {}, paths: { PROJECTS_DIR: projectsDir }, authorizeProjectRequest: authorize,
    http: { sendApiError: (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
    projectStore: { getProject: (_db: unknown, id: string) => id === 'project' ? { id, name: 'Current project', metadata: { kind: 'other', baseDir: root, documentSetupIntent: intent } }
      : id === 'reference' ? { id, name: 'Previous project', metadata: { kind: 'other', baseDir: referenceRoot } }
      : id === 'managed' || id === 'managed-reference' ? { id, name: 'Managed project', metadata: { kind: 'other', documentSetupIntent: intent } }
      : id === 'missing-imported' ? { id, name: 'Unavailable imported project', metadata: { kind: 'other', baseDir: missingImportedRoot, documentSetupIntent: intent } }
      : id === 'legacy' ? { id, name: 'Legacy project', metadata: { kind: 'other', baseDir: legacyRoot } } : null },
  } as unknown as RegisterDocumentSetupRoutesDeps;
  registerDocumentSetupRoutes(app, dependencies);
  registerBlockoutWorkspaceRoutes(app, dependencies);
  const server: Server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Server did not bind');
  return { root, referenceRoot, legacyRoot, projectsDir, missingImportedRoot, intent, url: `http://127.0.0.1:${address.port}`, authorize, denyReference: () => { denied.add('reference'); }, deny: () => { authorized = false; } };
}

describe('document setup HTTP and CLI surfaces', () => {
  it('repairs older managed projects before preparation reads without recreating missing imported folders', async () => {
    const test = await fixture(), endpoint = `${test.url}/api/projects/managed/document-setup`;
    await expect(stat(path.join(test.projectsDir, 'managed'))).rejects.toMatchObject({ code: 'ENOENT' });
    const response = await fetch(endpoint);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ setup: { status: 'draft', workingDirectory: path.join(test.projectsDir, 'managed') } });
    expect((await fetch(`${endpoint}/references`)).status).toBe(200);
    const references = await fetch(`${endpoint}/references`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectIds: ['managed-reference'] }) });
    expect(references.status).toBe(200);
    expect(await references.json()).toMatchObject({ references: [{ projectId: 'managed-reference', workingDirectory: path.join(test.projectsDir, 'managed-reference') }] });
    expect((await fetch(`${test.url}/api/projects/missing-imported/document-setup`)).status).toBe(400);
    await expect(stat(test.missingImportedRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    const missingReference = await fetch(`${endpoint}/references`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectIds: ['missing-imported'] }) });
    expect(missingReference.status).toBe(400);
    await expect(stat(test.missingImportedRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('shares draft, bounded scan and explicit confirmation through real HTTP endpoints', async () => {
    const test = await fixture(), endpoint = `${test.url}/api/projects/project/document-setup`;
    const draft = await (await fetch(endpoint)).json() as DocumentSetupResponse;
    expect(draft.setup).toMatchObject({ status: 'draft', workingDirectory: test.root, intent: { imageIntakeConsent: false } });
    expect((await fetch(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(test.intent) })).ok).toBe(true);
    const scan = await (await fetch(`${endpoint}/context-scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as DocumentSetupResponse;
    expect(scan.setup?.scan.constraints.some((entry) => entry.kind === 'page-limit')).toBe(true);
    const confirmed = await fetch(`${endpoint}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'Graphic structure only', constraints: scan.setup!.scan.constraints, editorialSettings: testEditorialSettings, blockoutApproach: 'manual' }) });
    expect(confirmed.ok).toBe(true);
    expect((JSON.parse(await readFile(path.join(test.root, '.melillodesign/projects/project/document-setup.json'), 'utf8'))).confirmed.purpose).toBe('Graphic structure only');
    expect(test.authorize.mock.calls.some((call) => call[3].mode === 'write' && call[3].capability === 'writeFiles')).toBe(true);
    test.deny(); expect((await fetch(endpoint)).status).toBe(403);
  });

  it('accepts structured long input from a file and stdin, printing --json from the same endpoints', async () => {
    const test = await fixture();
    vi.stubEnv('OD_WORKSPACE_ID', 'pinned-workspace'); vi.stubEnv('OD_WORKSPACE_MEMBER_ID', 'pinned-member');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const input = path.join(test.root, 'intent-input.json');
    await writeFile(input, JSON.stringify({ ...test.intent, documentName: '  Relazione descrittiva B  ' }));
    const flags = ['--project', 'project', '--daemon-url', test.url, '--json'];
    await runDocumentSetupCli(['set', ...flags, '--prompt-file', input]);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0])).setup.status).toBe('draft');
    await runDocumentSetupCli(['scan', ...flags]);
    const scan = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as DocumentSetupResponse;
    const text = JSON.stringify({ purpose: 'User-corrected CLI brief', constraints: scan.setup!.scan.constraints, editorialSettings: testEditorialSettings, blockoutApproach: 'agent', pageTarget: 3 });
    vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(async function* () { yield text; });
    await runDocumentSetupCli(['confirm', ...flags, '--prompt-file', '-']);
    await runDocumentSetupCli(['show', ...flags]);
    const result = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as DocumentSetupResponse;
    expect(result.setup?.confirmed).toMatchObject({ purpose: 'User-corrected CLI brief', blockoutApproach: 'agent', pageTarget: 3 });
    expect(JSON.parse(await readFile(path.join(test.root, 'blockout/layout.json'), 'utf8')).pageBudget).toMatchObject({ limit: 5, target: 3 });
    expect(result.setup?.intent.imageIntakeConsent).toBe(false);
    expect(result.setup?.intent.documentName).toBe('Relazione descrittiva B');
    const request = test.authorize.mock.calls[0]![0] as { get(name: string): string | undefined };
    expect(request.get('x-od-workspace-id')).toBe('pinned-workspace');
    expect(request.get('x-od-workspace-member-id')).toBe('pinned-member');
  });

  it('documents the confirmation JSON and pageTarget contract in CLI help without requiring source inspection', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runDocumentSetupCli(['confirm', '--help']);
    const help = String(log.mock.calls[0]?.[0]);
    expect(help).toContain('sourceIds:string[]');
    expect(help).toContain('pageTarget?:positiveInteger');
    const example = JSON.parse(help.slice(help.indexOf('{\n')));
    expect(example).toMatchObject({ pageTarget: 3, blockoutApproach: 'manual', constraints: [{ kind: 'page-limit', value: 'Massimo 4 pagine' }, { kind: 'paper', value: 'A3' }, { kind: 'orientation', value: 'orizzontale' }] });
  });

  it('edits multiple Blockout documents under an imported root while generic dotfile access stays forbidden', async () => {
    const test = await fixture(), endpoint = `${test.url}/api/projects/project/blockout-documents`;
    expect(() => assertVisibleForImportedProject('blockouts/.documents.json', { baseDir: test.root })).toThrow('hidden');
    expect(() => assertVisibleForImportedProject('.ssh/secret', { baseDir: test.root })).toThrow('hidden');
    const doc = createBlockoutDocument(); doc.title = 'First report';
    const save = (documentId: string, document: unknown, baseRaw: string | null) => fetch(`${endpoint}/${documentId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document, baseRaw }) });
    const firstResponse = await save(doc.documentId, doc, null);
    expect(firstResponse.ok).toBe(true);
    const first = await firstResponse.json() as BlockoutWorkspaceResponse;
    const second = { ...createBlockoutDocument(), documentId: 'document-two', title: 'Second report' };
    second.variants[0]!.pages.push(createBlockoutPage('detail', 'Detail'));
    expect((await save(second.documentId, second, null)).ok).toBe(true);
    const catalog = await (await fetch(endpoint)).json() as BlockoutDocumentCatalog;
    expect(catalog.documents.map((entry: { title: string }) => entry.title)).toEqual(['First report', 'Second report']);
    expect((await fetch(`${endpoint}/${second.documentId}`)).ok).toBe(true);
    const page = JSON.parse(await readFile(path.join(test.root, 'blockouts/document-two/detail.blockout.json'), 'utf8'));
    expect(page.type).toBe('blockout-page');
    expect(JSON.parse(await readFile(path.join(test.root, 'blockouts/document-two/.workspace.json'), 'utf8')).title).toBe('Second report');
    expect((await save(doc.documentId, { ...doc, title: 'Lost old edit' }, null)).status).toBe(409);
    expect((await save(doc.documentId, { ...doc, title: 'Latest edit' }, first.raw)).ok).toBe(true);
    const brief = await fetch(`${endpoint}/${doc.documentId}/starting-point`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document: doc }) });
    expect(brief.status).toBe(409);
    test.deny(); expect((await fetch(`${endpoint}/document-two`)).status).toBe(403);
  });

  it('exposes imported-root Blockout list/show/save/brief through the same CLI', async () => {
    const test = await fixture(), log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const doc = createBlockoutDocument(), file = path.join(test.root, 'blockout-input.json');
    const flags = ['--project', 'project', '--daemon-url', test.url, '--json'];
    await writeFile(file, JSON.stringify({ document: doc, baseRaw: null }));
    await runBlockoutCli(['save', ...flags, '--prompt-file', file]);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0])).document.documentId).toBe('document-1');
    await runBlockoutCli(['list', ...flags]);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0])).documents).toHaveLength(1);
    await runBlockoutCli(['show', ...flags]);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0])).document.version).toBe(1);
    vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(async function* () { yield JSON.stringify({ document: doc }); });
    await runBlockoutCli(['brief', ...flags, '--prompt-file', '-']);
    expect(JSON.parse(await readFile(path.join(test.root, 'blockout/starting-point.json'), 'utf8')).documentId).toBe('document-1');
  });

  it('authorizes project IDs and reads their text without adding reference roots to image intake', async () => {
    const test = await fixture(), endpoint = `${test.url}/api/projects/project/document-setup`;
    const response = await fetch(`${endpoint}/references`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectIds: ['reference'], resolvedDir: 'C:/must-not-be-trusted' }) });
    expect(response.ok).toBe(true);
    expect(await response.json()).toMatchObject({ references: [{ projectId: 'reference', name: 'Previous project', workingDirectory: test.referenceRoot }] });
    const saved = await readDocumentSetup(test.root, undefined, 'project');
    expect(saved?.intent.contextProjectIds).toEqual(['reference']);
    const scan = await (await fetch(`${endpoint}/context-scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as DocumentSetupResponse;
    expect(scan.setup?.scan.sources.some((entry) => entry.root === test.referenceRoot)).toBe(true);
    expect(scan.setup?.intent.contextRoots).toEqual([]);
    await expect(readFile(path.join(test.root, 'intake.config.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(test.authorize.mock.calls.some((call) => call[2] === 'reference' && call[3].mode === 'read')).toBe(true);
    test.denyReference(); expect((await fetch(`${endpoint}/references`)).status).toBe(403);
  });

  it('supports references and searchable text in legacy chats without creating a setup gate, including CLI', async () => {
    const test = await fixture(), endpoint = `${test.url}/api/projects/legacy/document-setup`;
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const file = path.join(test.legacyRoot, 'references-input.json');
    await writeFile(file, JSON.stringify({ projectIds: ['reference'] }));
    const flags = ['--project', 'legacy', '--daemon-url', test.url, '--json'];
    await runDocumentSetupCli(['set-references', ...flags, '--prompt-file', file]);
    await runDocumentSetupCli(['references', ...flags]);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0])).references[0].workingDirectory).toBe(test.referenceRoot);
    const scan = await (await fetch(`${endpoint}/context-scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as DocumentSetupResponse & { referenceContext: { scan: { textDocuments: unknown[] } } };
    expect(scan.setup).toBeNull();
    expect(scan.referenceContext.scan.textDocuments.length).toBeGreaterThan(0);
    expect(await readDocumentSetup(test.legacyRoot, undefined, 'legacy')).toBeNull();
    expect(await documentSetupRunGate(test.legacyRoot, { kind: 'other' }, 'legacy', 'design')).toBeNull();
    expect(await loadDocumentSetupContext(test.legacyRoot, 'legacy')).toContain('Previous project');
    expect(await loadDocumentSetupContext(test.legacyRoot, 'legacy')).toContain('No image intake of reference projects is authorized');
    expect((await fetch(`${endpoint}/references`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectIds: ['legacy'] }) })).status).toBe(400);
  });
});
