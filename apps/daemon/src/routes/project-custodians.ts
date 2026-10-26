import type { Express } from 'express';
import { AskProjectCustodianSchema, ProjectCustodianActivitySchema } from '@open-design/contracts';
import type { ProjectMetadata } from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import { resolveProjectDir } from '../projects.js';
import { requireLocalDaemonRequest } from '../http/local-daemon-request.js';
import { ProjectCustodianService } from '../services/project-custodians.js';

export interface RegisterProjectCustodianRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectStore' | 'authorizeProjectRequest'> {
  custodians?: Pick<ProjectCustodianService, 'ledger' | 'ask'>;
  custodianJournal?: { read(projectId: string, options?: { limit?: number }): Promise<unknown> };
  custodianWatch?: {
    activate(input: { projectId: string; root: string; metadata: ProjectMetadata | null | undefined; active: true }): Promise<unknown>;
    deactivate(projectId: string): unknown;
    status(projectId: string): unknown;
  };
}

export function registerProjectCustodianRoutes(app: Express, ctx: RegisterProjectCustodianRoutesDeps): void {
  const service = ctx.custodians ?? new ProjectCustodianService({ dataDir: ctx.paths.RUNTIME_DATA_DIR });
  const endpoint = '/api/projects/:id/custodians';
  for (const action of ['ledger', 'ask', 'history', 'activity'] as const) {
    const readOnly = action === 'ledger' || action === 'history';
    const suffix = action === 'ledger' ? '' : `/${action}`;
    app[readOnly ? 'get' : 'post'](`${endpoint}${suffix}`, ...(readOnly ? [] : [requireLocalDaemonRequest]), async (req, res) => {
      try {
        const projectId = typeof req.params.id === 'string' ? req.params.id : '';
        if (!await ctx.authorizeProjectRequest(req, res, projectId, readOnly ? { mode: 'read' } : { mode: 'write', capability: 'writeFiles' })) return;
        const project = ctx.projectStore.getProject(ctx.db, projectId);
        if (!project) { ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
        if (project.metadata?.projectMode === 'fast') { ctx.http.sendApiError(res, 503, 'CUSTODIANS_UNAVAILABLE', 'Fast projects use direct material inspection without background custodians.'); return; }
        const root = resolveProjectDir(ctx.paths.PROJECTS_DIR, project.id, project.metadata);
        if (action === 'ledger') res.json({ ledger: await service.ledger(root, project.metadata, projectId), indexing: ctx.custodianWatch?.status(projectId) ?? null });
        else if (action === 'ask') res.json({ result: await service.ask(root, AskProjectCustodianSchema.parse(req.body), project.metadata, projectId) });
        else if (action === 'history') {
          if (!ctx.custodianJournal) { ctx.http.sendApiError(res, 503, 'CUSTODIAN_HISTORY_UNAVAILABLE', 'Custodian history is unavailable'); return; }
          const raw = req.query.limit;
          const limit = raw === undefined ? 40 : Number(raw);
          if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('History limit must be 1–100');
          res.json({ history: await ctx.custodianJournal.read(projectId, { limit }) });
        } else {
          if (!ctx.custodianWatch) { ctx.http.sendApiError(res, 503, 'CUSTODIAN_WATCH_UNAVAILABLE', 'Custodian indexing is unavailable'); return; }
          const input = ProjectCustodianActivitySchema.parse(req.body);
          if (input.active) await ctx.custodianWatch.activate({ projectId, root, metadata: project.metadata, active: true });
          else await ctx.custodianWatch.deactivate(projectId);
          res.json({ indexing: ctx.custodianWatch.status(projectId) });
        }
      } catch (error) {
        ctx.http.sendApiError(res, 400, 'CUSTODIAN_FAILED', error instanceof Error ? error.message : String(error));
      }
    });
  }
}
