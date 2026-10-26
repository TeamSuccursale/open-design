import type { Express } from 'express';
import type { RegisterBlockoutWorkspaceRoutesDeps } from './blockout-workspaces.js';
import { resolveProjectDir } from '../projects.js';
import { requireLocalDaemonRequest } from '../http/local-daemon-request.js';
import { readBlockoutDesignState, readBlockoutDesignUnderlay, recordBlockoutDesign } from '../services/blockout-design.js';
import { ProjectDocumentScopeConflict } from '../services/project-document-folders.js';

export function registerBlockoutDesignRoutes(app: Express, ctx: RegisterBlockoutWorkspaceRoutesDeps): void {
  const base = '/api/projects/:id/blockout-documents/:documentId/design';
  const published = new Map<string, string>();
  for (const operation of ['state', 'record', 'page'] as const) {
    app[operation === 'record' ? 'post' : 'get'](`${base}${operation === 'page' ? '/pages/:pageId' : ''}`, ...(operation === 'record' ? [requireLocalDaemonRequest] : []), async (req, res) => {
      try {
        const projectId = String(req.params.id), documentId = String(req.params.documentId);
        if (!await ctx.authorizeProjectRequest(req, res, projectId, operation === 'record' ? { mode: 'write', capability: 'writeFiles' } : { mode: 'read' })) return;
        const project = ctx.projectStore.getProject(ctx.db, projectId);
        if (!project) { ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
        const root = resolveProjectDir(ctx.paths.PROJECTS_DIR, projectId, project.metadata);
        if (operation === 'record') {
          await ctx.beforeBlockoutWrite?.(projectId, [documentId]);
          if (req.get('x-od-run-id') && req.get('x-od-run-id') !== req.body?.runId) throw new Error('Run identity mismatch');
          if (!ctx.getDesignRun) throw new Error('Design run validation is unavailable');
          res.json(await recordBlockoutDesign(root, documentId, projectId, req.body, ctx.getDesignRun)); return;
        }
        const state = await readBlockoutDesignState(root, documentId, projectId, ctx.getDesignRun);
        if (state.applied) {
          // Reading a receipt/underlay must never change an open editor's saved revision.
          const key = `${projectId}:${documentId}`;
          if (ctx.documentRegistry && published.get(key) !== state.applied.revisionId) {
            const { readBlockoutWorkspace } = await import('../services/blockout-workspaces.js');
            const workspace = await readBlockoutWorkspace(root, documentId);
            if (workspace.document) await ctx.documentRegistry.blockoutUpdated(projectId, workspace.document, state.applied.entryFile, { entryOnly: true });
            published.set(key, state.applied.revisionId);
          }
        }
        if (operation === 'page') res.json(await readBlockoutDesignUnderlay(root, documentId, String(req.params.pageId)));
        else res.json(state);
      } catch (error) {
        if (error instanceof ProjectDocumentScopeConflict) { ctx.http.sendApiError(res, 409, 'DOCUMENT_WORKSPACE_REQUIRED', error.message); return; }
        ctx.http.sendApiError(res, 400, 'BLOCKOUT_DESIGN_FAILED', error instanceof Error ? error.message : String(error));
      }
    });
  }
}
