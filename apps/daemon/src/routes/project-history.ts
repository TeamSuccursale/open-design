import type { Express } from 'express';
import type { ProjectHistoryRestoreResponse } from '@open-design/contracts';
import { ProjectHistoryCompareRequestSchema, ProjectHistoryRestoreRequestSchema, ProjectHistoryCheckpointRequestSchema, ProjectHistoryActivityRequestSchema, ProjectOrganizationRequestSchema } from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import type { ProjectHistoryStore } from '../services/project-history.js';
import { resolveProjectDir } from '../projects.js';
import { requireLocalDaemonRequest } from '../http/local-daemon-request.js';

export interface RegisterProjectHistoryRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectStore' | 'authorizeProjectRequest'> {
  history: {
    store(projectId: string, root: string): Promise<ProjectHistoryStore>;
    isAgentRunning(projectId: string): boolean;
    restore?(projectId: string, root: string, input: { entryId: string; paths?: string[] | undefined; baseRevision: string }): Promise<ProjectHistoryRestoreResponse>;
  };
}

export function registerProjectHistoryRoutes(app: Express, ctx: RegisterProjectHistoryRoutesDeps): void {
  const base = '/api/projects/:id/history';
  for (const action of ['list', 'version', 'compare', 'restore', 'checkpoint', 'activity', 'organization'] as const) {
    const reading = ['list', 'version', 'compare'].includes(action);
    const suffix = action === 'list' ? '' : action === 'version' ? '/entries/:entryId' : `/${action}`;
    app[action === 'list' || action === 'version' ? 'get' : 'post'](`${base}${suffix}`, ...(reading ? [] : [requireLocalDaemonRequest]), async (req, res) => {
      try {
        const projectId = String(req.params.id);
        if (!await ctx.authorizeProjectRequest(req, res, projectId, reading ? { mode: 'read' } : { mode: 'write', capability: 'writeFiles' })) return;
        const project = ctx.projectStore.getProject(ctx.db, projectId);
        if (!project) { ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
        if (action === 'restore' && ctx.history.isAgentRunning(projectId)) { ctx.http.sendApiError(res, 409, 'HISTORY_AGENT_RUNNING', 'Stop the active agent before restoring files'); return; }
        const root = resolveProjectDir(ctx.paths.PROJECTS_DIR, project.id, project.metadata);
        const store = await ctx.history.store(projectId, root);
        if (action === 'list') {
          const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
          if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) throw Object.assign(new Error('Invalid limit'), { statusCode: 400 });
          const before = req.query.before === undefined ? undefined : ProjectHistoryRestoreRequestSchema.shape.entryId.parse(req.query.before);
          res.json(await store.list(limit, before));
        } else if (action === 'version') res.json(await store.version(ProjectHistoryRestoreRequestSchema.shape.entryId.parse(req.params.entryId)));
        else if (action === 'compare') { const input = ProjectHistoryCompareRequestSchema.strict().parse(req.body); res.json(await store.compare(input.fromId, input.toId, input.path)); }
        else if (action === 'restore') {
          const input = ProjectHistoryRestoreRequestSchema.strict().parse(req.body);
          res.json(await (ctx.history.restore ? ctx.history.restore(projectId, root, input) : store.restore(input)));
        }
        else if (action === 'checkpoint') { const input = ProjectHistoryCheckpointRequestSchema.strict().parse(req.body ?? {}); res.json({ entry: await store.checkpoint('manual', input.title, input.summary) }); }
        else if (action === 'activity') { const input = ProjectHistoryActivityRequestSchema.strict().parse(req.body); await store.activity(input.kind, input.summary); res.json({ ok: true }); }
        else { const input = ProjectOrganizationRequestSchema.strict().parse(req.body); res.json({ review: await store.organization(input.action, input.reviewId) }); }
      } catch (error) {
        const statusCode = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 500;
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        if (statusCode === 409 && (code === 'HISTORY_BACKGROUND_RUNNING' || code === 'HISTORY_AGENT_RUNNING')) {
          ctx.http.sendApiError(res, 409, code, code === 'HISTORY_BACKGROUND_RUNNING' ? 'Wait for background document preparation to finish before restoring files' : 'Stop the active agent before restoring files'); return;
        }
        const status = error instanceof Error && error.name === 'ZodError' ? 400 : [400, 404, 409, 413, 429, 503].includes(statusCode) ? statusCode : 500;
        ctx.http.sendApiError(res, status, `HISTORY_${status === 409 ? 'CONFLICT' : status === 404 ? 'NOT_FOUND' : status === 400 ? 'INVALID_REQUEST' : 'FAILED'}`, status === 400 ? 'Invalid project history request' : status === 404 ? 'History entry not found' : status === 409 ? 'Project history changed; refresh before restoring' : 'Project history is unavailable');
      }
    });
  }
}
