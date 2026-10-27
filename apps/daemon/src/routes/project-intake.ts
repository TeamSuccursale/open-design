import type { Express } from 'express';
import { buildIntakeVectorProposal, type IntakeVectorProposalRequest, type StartProjectIntakeRequest } from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import { resolveProjectDir } from '../projects.js';
import { ProjectIntakeService } from '../services/project-intake.js';
import { requireLocalDaemonRequest } from '../http/local-daemon-request.js';
import { preferIntakeVector, registerIntakeVector } from '../services/project-intake-vectors.js';

export interface RegisterProjectIntakeRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'auth' | 'projectStore' | 'authorizeProjectRequest'> {
  intakeService?: ProjectIntakeService;
  history?: { store(projectId: string, root: string): Promise<unknown> };
}

export function registerProjectIntakeRoutes(app: Express, ctx: RegisterProjectIntakeRoutesDeps): void {
  const service = ctx.intakeService ?? new ProjectIntakeService();
  for (const operation of ['vectors', 'vector-preference'] as const) {
    app[operation === 'vectors' ? 'post' : 'put'](`/api/projects/:id/intake/assets/:assetId/${operation}`, requireLocalDaemonRequest, async (req, res) => {
      try {
        const projectId = typeof req.params.id === 'string' ? req.params.id : '';
        if (!await ctx.authorizeProjectRequest(req, res, projectId, { mode: 'write', capability: 'writeFiles' })) return;
        const project = ctx.projectStore.getProject(ctx.db, projectId);
        if (!project) { ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
        const root = resolveProjectDir(ctx.paths.PROJECTS_DIR, project.id, project.metadata);
        await ctx.history?.store(projectId, root);
        const asset = (await service.catalog(root)).assets.find((item) => item.id === req.params.assetId);
        if (!asset) { ctx.http.sendApiError(res, 404, 'ASSET_NOT_FOUND', 'Intake asset not found'); return; }
        res.json(await (operation === 'vectors' ? registerIntakeVector(root, asset, req.body) : preferIntakeVector(root, asset, req.body)));
      } catch (error) { ctx.http.sendApiError(res, 400, 'INTAKE_FAILED', error instanceof Error ? error.message : String(error)); }
    });
  }
  app.post('/api/projects/:id/intake/assets/:assetId/vector-proposal', async (req, res) => {
    try {
      if (!await ctx.authorizeProjectRequest(req, res, req.params.id, { mode: 'read' })) return;
      const project = ctx.projectStore.getProject(ctx.db, req.params.id);
      if (!project) { ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
      const input = req.body as IntakeVectorProposalRequest | null;
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 12000))
        || (input.language !== undefined && !['it', 'en'].includes(input.language))) {
        ctx.http.sendApiError(res, 400, 'BAD_REQUEST', 'Expected optional note and language (it or en)'); return;
      }
      const catalog = await service.catalog(resolveProjectDir(ctx.paths.PROJECTS_DIR, project.id, project.metadata));
      const asset = catalog.assets.find((item) => item.id === req.params.assetId);
      if (!asset) { ctx.http.sendApiError(res, 404, 'ASSET_NOT_FOUND', 'Intake asset not found'); return; }
      res.json(buildIntakeVectorProposal(asset, input));
    } catch (error) { ctx.http.sendApiError(res, 400, 'INTAKE_FAILED', error instanceof Error ? error.message : String(error)); }
  });
  app.get('/api/projects/:id/intake/settings', async (req, res) => {
    try {
      if (!await ctx.authorizeProjectRequest(req, res, req.params.id, { mode: 'read' })) return;
      const project = ctx.projectStore.getProject(ctx.db, req.params.id);
      if (!project) { ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
      res.json(await service.settings(resolveProjectDir(ctx.paths.PROJECTS_DIR, project.id, project.metadata)));
    } catch (error) { ctx.http.sendApiError(res, 400, 'INTAKE_FAILED', error instanceof Error ? error.message : String(error)); }
  });
  app.put('/api/projects/:id/intake/settings', requireLocalDaemonRequest, async (req, res) => {
    try {
      const projectId = typeof req.params.id === 'string' ? req.params.id : '';
      if (!await ctx.authorizeProjectRequest(req, res, projectId, { mode: 'write', capability: 'writeFiles' })) return;
      const project = ctx.projectStore.getProject(ctx.db, projectId);
      if (!project) { ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
      if (ctx.auth.isDesktopAuthGateActive() && Array.isArray(req.body?.sourceDirs) && req.body.sourceDirs.length) {
        ctx.http.sendApiError(res, 403, 'FORBIDDEN', 'Extra intake folders are currently available in the local browser runtime. Desktop requires a trusted folder grant.'); return;
      }
      const root = resolveProjectDir(ctx.paths.PROJECTS_DIR, project.id, project.metadata);
      await ctx.history?.store(projectId, root);
      res.json(await service.configure(root, req.body));
    } catch (error) { ctx.http.sendApiError(res, 400, 'INTAKE_FAILED', error instanceof Error ? error.message : String(error)); }
  });
  app.get('/api/projects/:id/intake', async (req, res) => {
    try {
      if (!await ctx.authorizeProjectRequest(req, res, req.params.id, { mode: 'read' })) return;
      const project = ctx.projectStore.getProject(ctx.db, req.params.id);
      if (!project) { ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
      const root = resolveProjectDir(ctx.paths.PROJECTS_DIR, project.id, project.metadata);
      res.json(await service.catalog(root));
    } catch (error) { ctx.http.sendApiError(res, 400, 'INTAKE_FAILED', error instanceof Error ? error.message : String(error)); }
  });
  app.post('/api/projects/:id/intake', async (req, res) => {
    try {
      if (!await ctx.authorizeProjectRequest(req, res, req.params.id, { mode: 'write', capability: 'writeFiles' })) return;
      const project = ctx.projectStore.getProject(ctx.db, req.params.id);
      if (!project) { ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
      const input = req.body as StartProjectIntakeRequest | null;
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || (input.retry !== undefined && typeof input.retry !== 'boolean')
        || (input.paths !== undefined && (!Array.isArray(input.paths) || !input.paths.every((entry) => typeof entry === 'string')))
        || (input.pages !== undefined && (!Array.isArray(input.pages) || !input.pages.length || !input.pages.every((page) => Number.isInteger(page) && page > 0)))) {
        ctx.http.sendApiError(res, 400, 'BAD_REQUEST', 'Expected PDF or image paths and optional positive page numbers'); return;
      }
      const root = resolveProjectDir(ctx.paths.PROJECTS_DIR, project.id, project.metadata);
      await ctx.history?.store(project.id, root);
      res.status(202).json(await service.start(root, input));
    } catch (error) { ctx.http.sendApiError(res, 400, 'INTAKE_FAILED', error instanceof Error ? error.message : String(error)); }
  });
}
