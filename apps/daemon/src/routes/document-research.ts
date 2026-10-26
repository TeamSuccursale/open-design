import type { Express } from 'express';
import { StartDocumentResearchSchema } from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import { resolveProjectDir } from '../projects.js';
import { requireLocalDaemonRequest } from '../http/local-daemon-request.js';
import { DocumentResearchService } from '../services/document-research.js';

export interface RegisterDocumentResearchRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectStore' | 'authorizeProjectRequest'> {
  documentResearch?: Pick<DocumentResearchService, 'read' | 'start'>;
}

/** Project authorization and the same persisted job boundary apply to UI and CLI. */
export function registerDocumentResearchRoutes(app: Express, ctx: RegisterDocumentResearchRoutesDeps): void {
  const service = ctx.documentResearch ?? new DocumentResearchService({ dataDir: ctx.paths.RUNTIME_DATA_DIR });
  const endpoint = '/api/projects/:id/document-research';
  for (const action of ['read', 'start'] as const) {
    app[action === 'read' ? 'get' : 'post'](endpoint, ...(action === 'read' ? [] : [requireLocalDaemonRequest]), async (req, res) => {
      try {
        const projectId = typeof req.params.id === 'string' ? req.params.id : '';
        if (!await ctx.authorizeProjectRequest(req, res, projectId, action === 'read' ? { mode: 'read' } : { mode: 'write', capability: 'writeFiles' })) return;
        const project = ctx.projectStore.getProject(ctx.db, projectId);
        if (!project) { ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
        if (project.metadata?.projectMode === 'fast') { ctx.http.sendApiError(res, 503, 'DOCUMENT_RESEARCH_UNAVAILABLE', 'Fast projects inspect supplied material directly without document research.'); return; }
        const root = resolveProjectDir(ctx.paths.PROJECTS_DIR, project.id, project.metadata);
        const research = action === 'read'
          ? await service.read(root, projectId)
          : await service.start(root, StartDocumentResearchSchema.parse(req.body ?? {}), project.metadata, projectId);
        const active = research && ['queued', 'quick', 'full'].includes(research.status);
        res.status(action === 'start' && active ? 202 : 200).json({ research });
      } catch (error) {
        ctx.http.sendApiError(res, 400, 'DOCUMENT_RESEARCH_FAILED', error instanceof Error ? error.message : String(error));
      }
    });
  }
}
