import type { Express } from 'express';
import type { RouteDeps } from '../server-context.js';
import { resolveProjectDir } from '../projects.js';
import { requireLocalDaemonRequest } from '../http/local-daemon-request.js';
import { DocumentOverviewReadingService } from '../services/document-overview-reading.js';

export interface RegisterDocumentOverviewReadingRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectStore' | 'authorizeProjectRequest'> {
  overviewReading?: DocumentOverviewReadingService;
}

export function registerDocumentOverviewReadingRoutes(app: Express, ctx: RegisterDocumentOverviewReadingRoutesDeps): void {
  const service = ctx.overviewReading ?? new DocumentOverviewReadingService({ dataDir: ctx.paths.RUNTIME_DATA_DIR });
  const endpoint = '/api/projects/:id/document-overview-reading';
  for (const action of ['read', 'start'] as const) {
    app[action === 'read' ? 'get' : 'post'](endpoint, ...(action === 'read' ? [] : [requireLocalDaemonRequest]), async (req, res) => {
      try {
        const projectId = typeof req.params.id === 'string' ? req.params.id : '';
        if (!await ctx.authorizeProjectRequest(req, res, projectId, action === 'read' ? { mode: 'read' } : { mode: 'write', capability: 'writeFiles' })) return;
        const project = ctx.projectStore.getProject(ctx.db, projectId);
        if (!project) { ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
        const root = resolveProjectDir(ctx.paths.PROJECTS_DIR, project.id, project.metadata);
        const reading = action === 'read' ? await service.read(root, projectId) : await service.start(root, req.body ?? {}, project.metadata, projectId);
        res.status(action === 'start' && reading && ['queued', 'reading'].includes(reading.status) ? 202 : 200).json({ reading });
      } catch (error) { ctx.http.sendApiError(res, 400, 'DOCUMENT_OVERVIEW_READING_FAILED', error instanceof Error ? error.message : String(error)); }
    });
  }
}
