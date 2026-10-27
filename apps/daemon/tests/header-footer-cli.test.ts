import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HeaderFooterAsset } from '@open-design/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEADER_FOOTER_CLI_COMMANDS, HEADER_FOOTER_CLI_HELP, runHeaderFooterCli } from '../src/header-footer-cli.js';

const servers: Server[] = [], folders: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function endpoint() {
  const requests: { method: string; url: string; body?: unknown; runId?: string }[] = [];
  const server = createServer((req, res) => {
    let body = ''; req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => { requests.push({ method: req.method!, url: req.url!, ...(body ? { body: JSON.parse(body) as unknown } : {}), ...(typeof req.headers['x-od-run-id'] === 'string' ? { runId: req.headers['x-od-run-id'] } : {}) }); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true })); });
  });
  servers.push(server); server.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  return { requests, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
const cases = [
  { action: 'list', method: 'GET', path: '', input: {} },
  { action: 'assets', method: 'GET', path: '', input: {} },
  { action: 'source-files', method: 'GET', path: '/source-files', input: {} },
  { action: 'import', method: 'POST', path: '/assets/import', input: { sourceIds: ['a'.repeat(64)] } },
  { action: 'create', method: 'POST', path: '/sets', input: { name: 'Studio' } },
  { action: 'draft', method: 'PATCH', path: '/sets/set-1/draft', input: { expectedDraftVersion: 1, draft: { name: 'Private JSON stays private' } } },
  { action: 'publish', method: 'POST', path: '/sets/set-1/publish', input: { expectedRevision: 0, expectedDraftVersion: 2, stage: 'graphic-approved' } },
  { action: 'validate', method: 'POST', path: '/sets/set-1/validate', input: { expectedDraftVersion: 2 }, expectedBody: { expectedDraftVersion: 2, documentId: 'document-1' } },
  { action: 'history', method: 'GET', path: '/sets/set-1/history', input: {} },
  { action: 'restore', method: 'POST', path: '/sets/set-1/restore', input: { revision: 1, expectedRevision: 2, expectedDraftVersion: 3, documentId: 'document-1' } },
  { action: 'restore-draft', method: 'POST', path: '/sets/set-1/restore-draft', input: { entryId: 'save-1', expectedDraftVersion: 4 } },
  { action: 'archive', method: 'PATCH', path: '/sets/set-1', input: { expectedRevision: 2 }, expectedBody: { archived: true, expectedRevision: 2 } },
  { action: 'unarchive', method: 'PATCH', path: '/sets/set-1', input: { expectedRevision: 2 }, expectedBody: { archived: false, expectedRevision: 2 } },
  { action: 'apply', method: 'POST', path: '/documents/document-1/binding', input: { followUpdates: false, header: true, footer: true, showOnCover: false, expectedBindingVersion: 1 }, expectedBody: { setId: 'set-1', followUpdates: false, header: true, footer: true, showOnCover: false, expectedBindingVersion: 1 } },
  { action: 'detach', method: 'POST', path: '/documents/document-1/detach', input: { expectedBindingVersion: 1 } },
  { action: 'disable', method: 'DELETE', path: '/documents/document-1/binding?expectedBindingVersion=1', input: { expectedBindingVersion: 1 } },
  { action: 'retry', method: 'POST', path: '/retry', input: {} },
  { action: 'upload', method: 'POST', path: '/assets', input: { files: [{ name: 'studio.svg', base64: 'eA==' }] } },
  { action: 'remove-logo', method: 'DELETE', path: '/assets/logo-1', input: {} },
  { action: 'search', method: 'POST', path: '/searches', input: { target: 'Studio', guidance: 'Logo\noriginale' } },
  { action: 'retry-search', method: 'POST', path: '/searches/search-1/retry', input: {} },
  { action: 'cancel-search', method: 'POST', path: '/searches/search-1/cancel', input: {} },
  { action: 'choose-logo', method: 'POST', path: '/searches/search-1/choose', input: { assetId: 'logo-1' } },
] as const;

describe('header/footer CLI command closure', () => {
  it('attributes native saves to the current run without adding attribution to manual CLI use', async () => {
    const e = await endpoint();
    vi.stubEnv('OD_STOCK_RUN_ID', 'native-run-1');
    await runHeaderFooterCli(['draft', '--project', 'project', '--set', 'model', '--daemon-url', e.url, '--prompt-file', '-', '--json'], { readInput: async () => '{}', write() {} });
    expect(e.requests[0]?.runId).toBe('native-run-1');
    vi.stubEnv('OD_STOCK_RUN_ID', '');
    await runHeaderFooterCli(['list', '--project', 'project', '--daemon-url', e.url, '--json'], { write() {} });
    expect(e.requests[1]).not.toHaveProperty('runId');
  });
  it('documents every supported command, the full draft shape, dynamic fields, shared scope and explicit graphic approval', async () => {
    const output: string[] = []; await runHeaderFooterCli(['help'], { write: (value) => output.push(value) });
    expect(output).toEqual([HEADER_FOOTER_CLI_HELP]);
    const advertised = output[0]!.match(/od header-footer <([^>]+)>/)![1]!.split('|'); expect(advertised).toEqual([...HEADER_FOOTER_CLI_COMMANDS]);
    expect(output[0]).toContain('x,y,width,height,assetId?,text?,field?'); expect(output[0]).toContain('Coordinates are 0..1');
    expect(output[0]).toContain('pageNumber|totalPages'); expect(output[0]).toContain('"Pagina {pageNumber} di {totalPages}"'); expect(output[0]).toContain('engineer\'s explicit approval'); expect(output[0]).toContain('Draft saves never apply automatically');
    expect(new Set([...cases.map((item) => item.action), 'export-logo'])).toEqual(new Set(HEADER_FOOTER_CLI_COMMANDS));
    const rootCli = await readFile(new URL('../src/cli.ts', import.meta.url), 'utf8'), rootActions = rootCli.match(/od header-footer <([^>]+)>/)![1]!.split('|');
    expect(new Set(rootActions)).toEqual(new Set(HEADER_FOOTER_CLI_COMMANDS));
  });
  it.each(cases)('$action uses its owned HTTP capability with exact JSON requests', async (test) => {
    const server = await endpoint(), output: string[] = [];
    await runHeaderFooterCli([test.action, '--project', 'parent', '--set', 'set-1', '--document', 'document-1', '--search', 'search-1', '--asset', 'logo-1', '--daemon-url', server.url, '--prompt-file', '-', '--json'], { readInput: async () => JSON.stringify(test.input), write: (value) => output.push(value) });
    expect(server.requests).toHaveLength(1); expect(server.requests[0]?.method).toBe(test.method); expect(server.requests[0]?.url).toBe(`/api/projects/parent/header-footer${test.path}`);
    if (test.method !== 'GET' && test.method !== 'DELETE') expect(server.requests[0]?.body).toEqual('expectedBody' in test ? test.expectedBody : test.input);
    else expect(server.requests[0]?.body).toBeUndefined();
    expect(JSON.parse(output[0]!)).toEqual({ ok: true });
  });
  it('rejects unknown flags and malformed long JSON before invoking any HTTP capability', async () => {
    await expect(runHeaderFooterCli(['create', '--project', 'parent', '--unknown', 'bad'])).rejects.toThrow('Invalid header-footer option');
    await expect(runHeaderFooterCli(['draft', '--project', 'parent', '--prompt-file', '-'], { readInput: async () => '[]' })).rejects.toThrow('Expected a header/footer JSON object');
  });
});

const logoBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 20"><rect width="80" height="20"/></svg>');
async function exportFixture(options: { requestedProject?: string; libraryProject?: string; childProject?: string; asset?: Partial<HeaderFooterAsset>; mimeType?: string; bytes?: Buffer; metadataStatus?: number; contentStatus?: number } = {}) {
  const folder = await mkdtemp(path.join(tmpdir(), 'melillo-logo-export-')); folders.push(folder);
  const requests: { url: string; workspaceId: string | undefined }[] = [], requestedProject = options.requestedProject ?? 'parent';
  const asset: HeaderFooterAsset = { id: 'logo-1', name: 'Studio', filename: 'studio.svg', mimeType: 'image/svg+xml', sha256: createHash('sha256').update(logoBytes).digest('hex'), size: logoBytes.length, source: 'upload', createdAt: 'now', url: 'https://unrelated.example/do-not-fetch', ...options.asset };
  const server = createServer((req, res) => {
    requests.push({ url: req.url!, workspaceId: typeof req.headers['x-od-workspace-id'] === 'string' ? req.headers['x-od-workspace-id'] : undefined });
    if (req.url?.endsWith('/content')) {
      if (options.contentStatus) { res.writeHead(options.contentStatus, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Logo is unavailable' } })); return; }
      res.setHeader('content-type', options.mimeType ?? asset.mimeType); res.end(options.bytes ?? logoBytes); return;
    }
    res.setHeader('content-type', 'application/json');
    if (options.metadataStatus) { res.statusCode = options.metadataStatus; res.end(JSON.stringify({ error: { message: 'Project access denied' } })); return; }
    res.end(JSON.stringify({ projectId: options.libraryProject ?? 'parent', assets: [asset], documents: options.childProject ? [{ projectId: options.libraryProject ?? 'parent', workspaceProjectId: options.childProject }] : [] }));
  });
  servers.push(server); server.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, file = path.join(folder, 'export.svg');
  const run = async () => { const output: string[] = []; await runHeaderFooterCli(['export-logo', '--project', requestedProject, '--asset', 'logo-1', '--file', file, '--daemon-url', url, '--json'], { write: (value) => output.push(value) }); return JSON.parse(output[0]!) as { filePath: string; asset: HeaderFooterAsset }; };
  return { file, asset, requests, run };
}
describe('header/footer logo export for visual inspection', () => {
  it('reads only the requested authorised local asset and returns a verified new file plus its metadata', async () => {
    const f = await exportFixture(), result = await f.run();
    expect(result.filePath).toBe(f.file); expect(result.asset).toEqual(f.asset); expect(await readFile(result.filePath)).toEqual(logoBytes);
    expect(f.requests.map((request) => request.url)).toEqual(['/api/projects/parent/header-footer', '/api/projects/parent/header-footer/assets/logo-1/content']);
  });
  it('accepts canonical parent metadata only when the requested child belongs to that collection', async () => {
    const valid = await exportFixture({ requestedProject: 'child', childProject: 'child' }); expect((await valid.run()).asset.id).toBe('logo-1');
    expect(valid.requests[1]?.url).toBe('/api/projects/child/header-footer/assets/logo-1/content');
    const foreign = await exportFixture({ requestedProject: 'foreign', childProject: 'different-child' });
    await expect(foreign.run()).rejects.toThrow('does not belong'); expect(foreign.requests).toHaveLength(1); await expect(access(foreign.file)).rejects.toThrow();
  });
  it('never overwrites an existing file, including when two exports race to the same new destination', async () => {
    const f = await exportFixture(); await writeFile(f.file, 'keep original');
    await expect(f.run()).rejects.toThrow('already exists'); expect(await readFile(f.file, 'utf8')).toBe('keep original'); expect(f.requests).toHaveLength(0);
    const race = await exportFixture(), results = await Promise.allSettled([race.run(), race.run()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1); expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1); expect(await readFile(race.file)).toEqual(logoBytes);
  });
  it('rejects a MIME mismatch or changed image bytes before creating a file', async () => {
    const mime = await exportFixture({ mimeType: 'text/html' }); await expect(mime.run()).rejects.toThrow('MIME'); await expect(access(mime.file)).rejects.toThrow();
    const changed = Buffer.from(logoBytes); changed[changed.length - 2] = '!'.charCodeAt(0);
    const identity = await exportFixture({ bytes: changed }); await expect(identity.run()).rejects.toThrow('saved image identity'); await expect(access(identity.file)).rejects.toThrow();
  });
  it('refuses missing/oversized/non-image metadata without downloading its content', async () => {
    for (const asset of [{ id: 'another-logo' }, { size: 13 * 1024 * 1024 }, { mimeType: 'text/html' }]) {
      const f = await exportFixture({ asset }); await expect(f.run()).rejects.toThrow(); expect(f.requests).toHaveLength(1); await expect(access(f.file)).rejects.toThrow();
    }
  });
  it('preserves HTTP access and unavailable-asset errors without leaving a partial local file', async () => {
    const denied = await exportFixture({ metadataStatus: 403 }); await expect(denied.run()).rejects.toThrow('Project access denied'); expect(denied.requests).toHaveLength(1); await expect(access(denied.file)).rejects.toThrow();
    const gone = await exportFixture({ contentStatus: 404 }); await expect(gone.run()).rejects.toThrow('Logo is unavailable'); await expect(access(gone.file)).rejects.toThrow();
  });
});
