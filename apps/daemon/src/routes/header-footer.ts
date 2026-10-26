import type { Express, Request, Response } from 'express';
import { HeaderFooterDetachRequestSchema, HeaderFooterIdSchema, ImportHeaderFooterSourcesRequestSchema, ValidateHeaderFooterRequestSchema } from '@open-design/contracts';
import { requireLocalDaemonRequest } from '../http/local-daemon-request.js';
import type { HeaderFooterStore } from '../services/header-footer.js';
import path from 'node:path';
import { HeaderFooterSearchRequestSchema } from '@open-design/contracts';
import { collectHeaderFooterUploads, HEADER_FOOTER_UPLOAD_LIMITS } from '../services/header-footer-assets.js';
import { HeaderFooterSearchService } from '../services/header-footer-search.js';
import { listHeaderFooterSourceFiles, readHeaderFooterSourceFiles } from '../services/header-footer-sources.js';

export interface HeaderFooterRouteDeps {
  /** Resolves child workspaces to the same parent library, after authorising the requested project. */
  store(projectId: string, req: Request, res: Response, mode: 'read' | 'write'): Promise<HeaderFooterStore | null>;
  searches?: HeaderFooterSearchService;
  onDraftSaved?(input: { req: Request; collectionId: string; setId: string; draftVersion: number; stage: 'structural' | 'graphic' }): void;
}
export function registerHeaderFooterRoutes(app: Express, deps: HeaderFooterRouteDeps): void {
  const searches = deps.searches ?? new HeaderFooterSearchService();
  const recovered = new Set<string>();
  const base = '/api/projects/:id/header-footer';
  type Handler = (store: HeaderFooterStore, req: Request) => Promise<unknown>;
  const route = (method: 'get' | 'post' | 'patch' | 'delete', suffix: string, handler: Handler) => app[method](`${base}${suffix}`, ...(method === 'get' ? [] : [requireLocalDaemonRequest]), async (req, res) => {
    try {
      const store = await deps.store(String(req.params.id), req, res, method === 'get' ? 'read' : 'write'); if (!store) return;
      if (!recovered.has(store.identity)) { await searches.recover(store); recovered.add(store.identity); }
      const result = await handler(store, req); res.status(method === 'post' && suffix === '/sets' ? 201 : 200).json(result);
    } catch (error) {
      const status = error instanceof Error && error.name === 'ZodError' ? 400 : Number((error as { statusCode?: number }).statusCode ?? 500);
      res.status([400, 403, 404, 409, 413, 503].includes(status) ? status : 500).json({ error: { code: (error as { code?: string }).code ?? 'HEADER_FOOTER_ERROR', message: status < 500 && error instanceof Error ? error.message : 'The header/footer library is unavailable. Your saved designs have been preserved.' } });
    }
  });
  route('get', '', (store) => store.list());
  route('get', '/source-files', async (store) => listHeaderFooterSourceFiles(await store.sourceRoots()));
  route('post', '/assets/import', async (store, req) => {
    const input = ImportHeaderFooterSourcesRequestSchema.parse(req.body);
    const uploads = await readHeaderFooterSourceFiles(await store.sourceRoots(), input.sourceIds);
    const result = await collectHeaderFooterUploads(uploads, (asset, bytes) => store.addAsset(asset, bytes), { archiveDirectory: path.join(await store.assetDirectory(), 'originals') });
    await store.recordUploadErrors(result.errors.map((error) => ({ name: error.name, error: error.message })));
    return { ...await store.list(), errors: result.errors.map((error) => ({ name: error.name, error: error.message })) };
  });
  route('post', '/sets', (store, req) => store.create(req.body));
  route('patch', '/sets/:setId/draft', async (store, req) => {
    const setId = HeaderFooterIdSchema.parse(req.params.setId);
    const result = await store.saveDraft(setId, req.body);
    const saved = result.sets.find((set) => set.id === setId);
    if (saved) deps.onDraftSaved?.({ req, collectionId: store.identity, setId, draftVersion: saved.draftVersion, stage: saved.draft.stage });
    return result;
  });
  route('patch', '/sets/:setId', (store, req) => { if (typeof req.body?.archived !== 'boolean' || !Number.isInteger(req.body?.expectedRevision) || req.body.expectedRevision < 0) throw Object.assign(new Error('Choose archive state and expected revision'), { statusCode: 400 }); return store.archive(HeaderFooterIdSchema.parse(req.params.setId), req.body.archived, req.body.expectedRevision); });
  route('post', '/sets/:setId/publish', (store, req) => store.publish(HeaderFooterIdSchema.parse(req.params.setId), req.body));
  route('post', '/sets/:setId/validate', (store, req) => store.validate(HeaderFooterIdSchema.parse(req.params.setId), ValidateHeaderFooterRequestSchema.parse(req.body)));
  route('get', '/sets/:setId/history', async (store, req) => { const setId = HeaderFooterIdSchema.parse(req.params.setId); return { revisions: await store.revisionHistory(setId), drafts: await store.draftHistory(setId) }; });
  route('post', '/sets/:setId/restore-draft', async (store, req) => { const version = Number(req.body?.expectedDraftVersion); if (!Number.isInteger(version) || version < 0) throw Object.assign(new Error('Expected draft version is required'), { statusCode: 400 }); return store.restoreDraft(HeaderFooterIdSchema.parse(req.params.setId), HeaderFooterIdSchema.parse(req.body?.entryId), version); });
  route('post', '/sets/:setId/restore', (store, req) => store.restore(HeaderFooterIdSchema.parse(req.params.setId), req.body));
  route('post', '/documents/:documentId/binding', (store, req) => store.apply(HeaderFooterIdSchema.parse(req.params.documentId), req.body));
  route('post', '/documents/:documentId/detach', (store, req) => store.detach(HeaderFooterIdSchema.parse(req.params.documentId), HeaderFooterDetachRequestSchema.parse(req.body).expectedBindingVersion));
  route('delete', '/documents/:documentId/binding', (store, req) => {
    const expected = Number(req.query.expectedBindingVersion);
    if (!Number.isInteger(expected) || expected < 0) throw Object.assign(new Error('Expected binding version is required'), { statusCode: 400 });
    return store.disable(HeaderFooterIdSchema.parse(req.params.documentId), expected);
  });
  route('post', '/retry', (store) => store.retry());
  route('post', '/assets', async (store, req) => {
    const files = req.body?.files as unknown;
    if (!Array.isArray(files) || !files.length || files.length > 128) throw Object.assign(new Error('Choose one or more logo files or a ZIP'), { statusCode: 400 });
    let total = 0;
    const uploads = files.map((file: unknown) => {
      if (!file || typeof file !== 'object' || !('name' in file) || !('base64' in file) || typeof file.name !== 'string' || typeof file.base64 !== 'string' || file.base64.length > Math.ceil((/\.zip$/i.test(file.name) ? HEADER_FOOTER_UPLOAD_LIMITS.batchBytes : HEADER_FOOTER_UPLOAD_LIMITS.fileBytes) * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) throw Object.assign(new Error('Invalid logo upload'), { statusCode: 400 });
      const data = Buffer.from(file.base64, 'base64'); total += data.length;
      if (total > HEADER_FOOTER_UPLOAD_LIMITS.batchBytes) throw Object.assign(new Error('Logo upload batch exceeds 50 MB'), { statusCode: 413 });
      return { filename: file.name, data };
    });
    const result = await collectHeaderFooterUploads(uploads, (input, bytes) => store.addAsset(input, bytes), { archiveDirectory: path.join(await store.assetDirectory(), 'originals') });
    await store.recordUploadErrors(result.errors.map((error) => ({ name: error.name, error: error.message })));
    return { ...await store.list(), errors: result.errors.map((error) => ({ name: error.name, error: error.message })) };
  });
  route('delete', '/assets/:assetId', (store, req) => store.removeAsset(HeaderFooterIdSchema.parse(req.params.assetId)));
  app.get(`${base}/assets/:assetId/content`, async (req, res) => {
    try {
      const store = await deps.store(String(req.params.id), req, res, 'read'); if (!store) return;
      const { asset, path: filename } = await store.readAsset(HeaderFooterIdSchema.parse(req.params.assetId));
      res.setHeader('Content-Type', asset.mimeType); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
      // Runtime roots may be dot-prefixed. Only this already-authorised, owned immutable asset path is served.
      await new Promise<void>((resolve, reject) => res.sendFile(filename, { dotfiles: 'allow' }, (error) => error ? reject(error) : resolve()));
    } catch { if (!res.headersSent) res.status(404).type('application/json').json({ error: { code: 'HEADER_FOOTER_ASSET_NOT_FOUND', message: 'Logo not found in this project' } }); else res.end(); }
  });
  route('post', '/searches', async (store, req) => { await searches.start(store, HeaderFooterSearchRequestSchema.parse(req.body)); return store.list(); });
  route('post', '/searches/:searchId/retry', async (store, req) => { await searches.retry(store, HeaderFooterIdSchema.parse(req.params.searchId)); return store.list(); });
  route('post', '/searches/:searchId/cancel', async (store, req) => { await searches.cancel(store, HeaderFooterIdSchema.parse(req.params.searchId)); return store.list(); });
  route('post', '/searches/:searchId/choose', async (store, req) => {
    const search = await store.getSearch(HeaderFooterIdSchema.parse(req.params.searchId)), assetId = HeaderFooterIdSchema.parse(req.body?.assetId);
    if (search.status !== 'candidate' || !search.candidates?.some((candidate) => candidate.assetId === assetId) || !search.assetIds.includes(assetId)) throw Object.assign(new Error('Choose a downloaded candidate from this logo search'), { statusCode: 400 });
    await store.readAsset(assetId); await store.updateSearch(search.id, { status: 'ready', assetIds: [assetId], error: '' }); return store.list();
  });
}
