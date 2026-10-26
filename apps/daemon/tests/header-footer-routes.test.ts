import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { createDocumentPresentation, type HeaderFooterWorkspaceResponse, type ProjectDocument } from '@open-design/contracts';
import { registerHeaderFooterRoutes } from '../src/routes/header-footer.js';
import { runHeaderFooterCli } from '../src/header-footer-cli.js';
import { HeaderFooterStore } from '../src/services/header-footer.js';

const folders: string[] = [], servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function fixture(onDraftSaved?: Parameters<typeof registerHeaderFooterRoutes>[1]['onDraftSaved']) {
  const root = await mkdtemp(path.join(tmpdir(), 'melillo-header-footer-http-')); folders.push(root);
  const projectRoot = path.join(root, 'project'), dataRoot = path.join(root, '.private'); await mkdir(projectRoot); await mkdir(dataRoot);
  const documents: ProjectDocument[] = [{ id: 'report', projectId: 'parent', workspaceProjectId: 'child', name: 'Relazione B', workingDirectory: projectRoot, kind: 'document', folderMode: 'managed', availability: 'available', conversationIds: ['chat'], presentation: createDocumentPresentation('Relazione B'), createdAt: 'now', updatedAt: 'now', archivedAt: null }];
  const store = new HeaderFooterStore({ dataRoot, projectRoot, projectId: 'parent', documents: async () => documents });
  const app = express(); app.use(express.json({ limit: '70mb' }));
  registerHeaderFooterRoutes(app, { ...(onDraftSaved ? { onDraftSaved } : {}), store: async (id, _req, res) => { if (!['parent', 'child'].includes(id)) { res.status(404).json({ error: { message: 'Project not found' } }); return null; } return store; } });
  const server = app.listen(0, '127.0.0.1'); servers.push(server); await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { root, projectRoot, store, url, base: `${url}/api/projects/parent/header-footer` };
}
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><rect width="100" height="20" fill="#165e52"/></svg>';

describe('header/footer HTTP and od CLI parity', () => {
  it('emits the native draft receipt after a durable save and never for a conflicting retry', async () => {
    const received: { runId: string | undefined; version: number }[] = [];
    const f = await fixture(({ req, draftVersion }) => { received.push({ runId: req.get('x-od-run-id'), version: draftVersion }); });
    const { set } = await f.store.create({ name: 'Native draft' });
    const body = JSON.stringify({ expectedDraftVersion: set.draftVersion, draft: { ...set.draft, stage: 'graphic' } });
    const options = { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-od-run-id': 'active-native-run' }, body };
    const saved = await fetch(`${f.base}/sets/${set.id}/draft`, options);
    expect(saved.status).toBe(200);
    expect((await f.store.list()).sets[0]?.draftVersion).toBe(2);
    expect(received).toEqual([{ runId: 'active-native-run', version: 2 }]);
    const conflict = await fetch(`${f.base}/sets/${set.id}/draft`, options);
    expect(conflict.status).toBe(409);
    expect(received).toHaveLength(1);
  });
  it('lists supplied files and explicitly imports an existing logo through the same CLI and HTTP capability', async () => {
    const f = await fixture(), output: string[] = [];
    await writeFile(path.join(f.projectRoot, 'already-supplied.svg'), svg);
    await runHeaderFooterCli(['source-files', '--project', 'child', '--daemon-url', f.url, '--json'], { write: (value) => output.push(value) });
    const files = JSON.parse(output.pop()!).files;
    expect(files).toHaveLength(1); expect((await f.store.list()).assets).toEqual([]);
    await runHeaderFooterCli(['import', '--project', 'child', '--daemon-url', f.url, '--prompt-file', '-', '--json'], { readInput: async () => JSON.stringify({ sourceIds: [files[0].id] }), write: (value) => output.push(value) });
    const imported = JSON.parse(output.pop()!) as HeaderFooterWorkspaceResponse;
    expect(imported.assets[0]?.name).toBe('already-supplied');
    expect(await (await fetch(`${f.url}${imported.assets[0]!.url}`)).text()).toBe(svg);
    const retry = await fetch(`${f.base}/assets/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [files[0].id] }) });
    expect((await retry.json() as HeaderFooterWorkspaceResponse).assets).toHaveLength(1);
    const stale = await fetch(`${f.base}/assets/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: ['a'.repeat(64)] }) });
    expect(stale.status).toBe(409); expect((await f.store.list()).assets).toHaveLength(1);
  });
  it('imports a previously supplied ZIP into received logos without uploading it again', async () => {
    const f = await fixture(), zip = new JSZip(); zip.file('Mozilla/logo.svg', svg); zip.file('Blender/logo.svg', svg.replace('#165e52', '#ba5c1a'));
    await writeFile(path.join(f.projectRoot, 'loghi.zip'), await zip.generateAsync({ type: 'nodebuffer' }));
    const listing = await (await fetch(`${f.base}/source-files`)).json() as { files: { id: string; name: string }[] };
    expect((await f.store.list()).assets).toHaveLength(0);
    const imported = await fetch(`${f.base}/assets/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [listing.files[0]!.id] }) });
    const state = await imported.json() as HeaderFooterWorkspaceResponse & { errors: unknown[] };
    expect(imported.status).toBe(200); expect(state.assets).toHaveLength(2); expect(state.errors).toEqual([]);
    expect(await (await fetch(`${f.url}${state.assets[1]!.url}`)).text()).toContain('#ba5c1a');
    expect(state.history.filter((entry) => entry.action === 'asset-save')).toHaveLength(2);
  });
  it('preflights a saved draft through HTTP and CLI without publishing or changing saved state', async () => {
    const f = await fixture(), created = await f.store.create({ name: 'Fit preview' });
    const set = created.set;
    await f.store.saveDraft(set.id, { expectedDraftVersion: 1, draft: { ...set.draft, stage: 'graphic', variants: [{ id: 'a4', name: 'A4', pageWidthMm: 210, pageHeightMm: 297, headerHeightMm: 20, footerHeightMm: 15, blocks: [{ id: 'title', region: 'header', kind: 'field', field: 'documentName', x: .05, y: .2, width: .9, height: .5 }, { id: 'number', region: 'footer', kind: 'field', field: 'pageNumber', x: .8, y: .2, width: .15, height: .5 }] }] } });
    const before = await f.store.list();
    const response = await fetch(`${f.base}/sets/${set.id}/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId: 'report', expectedDraftVersion: 2 }) });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ valid: true, setId: set.id, draftVersion: 2, documentIds: ['report'] });
    const output: string[] = [];
    await runHeaderFooterCli(['validate', '--project', 'child', '--set', set.id, '--document', 'report', '--daemon-url', f.url, '--prompt-file', '-', '--json'], { readInput: async () => JSON.stringify({ expectedDraftVersion: 2 }), write: (value) => output.push(value) });
    expect(JSON.parse(output[0]!)).toEqual({ valid: true, setId: set.id, draftVersion: 2, documentIds: ['report'] });
    expect(await f.store.list()).toEqual(before);
    const stale = await fetch(`${f.base}/sets/${set.id}/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedDraftVersion: 1 }) });
    expect(stale.status).toBe(409);
    const malformed = await fetch(`${f.base}/sets/${set.id}/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId: '../foreign' }) });
    expect(malformed.status).toBe(400);
    const denied = await fetch(`${f.base}/sets/${set.id}/validate`, { method: 'POST', headers: { origin: 'https://external.example', 'content-type': 'application/json' }, body: '{}' });
    expect(denied.status).toBe(403); expect(await f.store.list()).toEqual(before);
  });
  it('resolves a child to the parent collection and exposes recoverable conflict errors', async () => {
    const f = await fixture();
    const created = await fetch(`${f.base}/sets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Studio' }) });
    expect(created.status).toBe(201); const state = await created.json() as HeaderFooterWorkspaceResponse;
    const child = await fetch(`${f.url}/api/projects/child/header-footer`); expect((await child.json() as HeaderFooterWorkspaceResponse).sets[0]?.id).toBe(state.sets[0]?.id);
    const set = state.sets[0]!;
    const conflict = await fetch(`${f.base}/sets/${set.id}/draft`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedDraftVersion: 0, draft: set.draft }) });
    expect(conflict.status).toBe(409); expect((await conflict.json() as { error: { code: string } }).error.code).toBe('HEADER_FOOTER_CONFLICT');
    expect((await fetch(`${f.url}/api/projects/foreign/header-footer`)).status).toBe(404);
  });
  it('owns safe logo uploads and previews, reports individual failures and rejects cross-origin mutations', async () => {
    const f = await fixture();
    const result = await fetch(`${f.base}/assets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: [{ name: 'studio.svg', base64: Buffer.from(svg).toString('base64') }, { name: 'bad.exe', base64: Buffer.from('not a logo').toString('base64') }] }) });
    expect(result.status).toBe(200); const state = await result.json() as HeaderFooterWorkspaceResponse & { errors: unknown[] };
    expect(state.assets).toHaveLength(1); expect(state.errors).toHaveLength(1);
    const preview = await fetch(`${f.url}${state.assets[0]!.url}`); expect(preview.headers.get('content-type')).toContain('image/svg+xml'); expect(preview.headers.get('content-security-policy')).toContain('sandbox'); expect(await preview.text()).toBe(svg);
    const denied = await fetch(`${f.base}/sets`, { method: 'POST', headers: { origin: 'https://external.example', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Forbidden' }) }); expect(denied.status).toBe(403);
  });
  it('serves exact logo bytes from a hidden runtime root only after project authorization', async () => {
    const f = await fixture();
    const uploaded = await fetch(`${f.base}/assets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: [{ name: 'logo.svg', base64: Buffer.from(svg).toString('base64') }] }) });
    const state = await uploaded.json() as HeaderFooterWorkspaceResponse, asset = state.assets[0]!;
    const preview = await fetch(`${f.url}${asset.url}`); expect(preview.status).toBe(200); expect(Buffer.from(await preview.arrayBuffer())).toEqual(Buffer.from(svg));
    expect(preview.headers.get('x-content-type-options')).toBe('nosniff');
    const foreign = await fetch(`${f.url}${asset.url.replace('/parent/', '/foreign/')}`); expect(foreign.status).toBe(404); expect(await foreign.text()).not.toBe(svg);
    const missing = await fetch(`${f.base}/assets/unknown/content`); expect(missing.status).toBe(404); expect(missing.headers.get('content-type')).toContain('application/json');
  });
  it('runs real CLI create/list/upload and long draft requests against the same endpoints', async () => {
    const f = await fixture(), output: string[] = [];
    await runHeaderFooterCli(['create', '--project', 'child', '--daemon-url', f.url, '--name', 'Studio CLI', '--json'], { write: (value) => output.push(value) });
    const created = JSON.parse(output.pop()!) as HeaderFooterWorkspaceResponse, set = created.sets[0]!;
    const draft = { ...set.draft, guidance: 'Preserve literal $() and line breaks.\nGuidance from the engineer.' };
    await runHeaderFooterCli(['draft', '--project', 'parent', '--daemon-url', f.url, '--set', set.id, '--prompt-file', '-', '--json'], { readInput: async () => JSON.stringify({ expectedDraftVersion: 1, draft }), write: (value) => output.push(value) });
    expect((JSON.parse(output.pop()!) as HeaderFooterWorkspaceResponse).sets[0]?.draft.guidance).toBe(draft.guidance);
    const logo = path.join(f.root, 'studio.svg'); await writeFile(logo, svg);
    await runHeaderFooterCli(['upload', '--project', 'child', '--daemon-url', f.url, '--file', logo, '--json'], { write: (value) => output.push(value) });
    expect((JSON.parse(output.pop()!) as HeaderFooterWorkspaceResponse).assets[0]?.name).toContain('studio');
    await runHeaderFooterCli(['list', '--project', 'parent', '--daemon-url', f.url, '--json'], { write: (value) => output.push(value) });
    expect((JSON.parse(output.pop()!) as HeaderFooterWorkspaceResponse).sets[0]?.draftVersion).toBe(2);
  });
});
