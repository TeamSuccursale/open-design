import type { Express } from 'express';
import type { RouteDeps } from '../server-context.js';
import { ensureProject } from '../projects.js';
import { requireLocalDaemonRequest } from '../http/local-daemon-request.js';
import type { BlockoutMaterialsService } from '../services/blockout-materials.js';

export interface RegisterBlockoutMaterialRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectStore' | 'authorizeProjectRequest'> {}
export function registerBlockoutMaterialRoutes(app: Express, ctx: RegisterBlockoutMaterialRoutesDeps, service: BlockoutMaterialsService): void {
  for (const method of ['get', 'post'] as const) {
    app[method]('/api/projects/:id/blockout-materials', ...(method === 'post' ? [requireLocalDaemonRequest] : []), async (req, res) => {
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        if (!await ctx.authorizeProjectRequest(req, res, id, method === 'get' ? { mode: 'read' } : { mode: 'write', capability: 'writeFiles' })) return;
        const project = ctx.projectStore.getProject(ctx.db, id);
        if (!project) { ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
        const root = await ensureProject(ctx.paths.PROJECTS_DIR, project.id, project.metadata);
        const inventory = await service[method === 'post' ? 'refresh' : 'get'](root, project.metadata, id);
        res.json({ inventory });
      } catch (error) { ctx.http.sendApiError(res, 400, 'BLOCKOUT_MATERIALS_FAILED', error instanceof Error ? error.message : String(error)); }
    });
  }
}
