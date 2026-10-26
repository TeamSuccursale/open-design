import type { Express } from 'express';
import type { RouteDeps } from '../server-context.js';
import { ensureProject } from '../projects.js';
import { requireLocalDaemonRequest } from '../http/local-daemon-request.js';
import { DocumentProjectReferencesRequestSchema } from '@open-design/contracts';
import type { ProjectDocumentsRuntime } from '../services/project-documents-runtime.js';
import { ProjectDocumentScopeConflict } from '../services/project-document-folders.js';
import { confirmDocumentSetup, readDocumentSetup, saveDocumentSetupIntent, scanDocumentSetupContext, scanStandaloneProjectReferences } from '../services/document-setup.js';
import { readDocumentProjectReferences, resolveDocumentProjectReferences, saveDocumentProjectReferences } from '../services/document-project-contexts.js';

export interface RegisterDocumentSetupRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectStore' | 'authorizeProjectRequest'> {
  history?: { store(projectId: string, root: string): Promise<unknown> };
  documentRegistry?: Pick<ProjectDocumentsRuntime, 'setupUpdated' | 'blockoutUpdated'>;
  beforeSetupWrite?: ProjectDocumentsRuntime['beforeSetupWrite'];
}

export function registerDocumentSetupRoutes(app: Express, ctx: RegisterDocumentSetupRoutesDeps): void {
  const endpoint = '/api/projects/:id/document-setup';
  for (const action of ['read', 'save', 'scan', 'confirm', 'references-read', 'references-save'] as const) {
    const reading = action === 'read' || action === 'references-read';
    const method = reading ? 'get' : action === 'save' || action === 'references-save' ? 'put' : 'post';
    const suffix = action.startsWith('references-') ? '/references' : action === 'scan' ? '/context-scan' : action === 'confirm' ? '/confirm' : '';
    app[method](`${endpoint}${suffix}`, ...(reading ? [] : [requireLocalDaemonRequest]), async (req, res) => {
      try {
        const projectId = typeof req.params.id === 'string' ? req.params.id : '';
        if (!await ctx.authorizeProjectRequest(req, res, projectId, reading ? { mode: 'read' } : { mode: 'write', capability: 'writeFiles' })) return;
        const project = ctx.projectStore.getProject(ctx.db, projectId);
        if (!project) { ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
        if (project.metadata?.projectMode === 'fast') { ctx.http.sendApiError(res, 503, 'DOCUMENT_SETUP_UNAVAILABLE', 'Fast projects use the working chat instead of guided document setup.'); return; }
        // Older managed projects may predate eager creation. Repair only the
        // daemon-owned root; ensureProject never recreates an imported folder.
        const root = await ensureProject(ctx.paths.PROJECTS_DIR, project.id, project.metadata);
        await ctx.history?.store(projectId, root);
        const current = await readDocumentSetup(root, project.metadata?.documentSetupIntent, projectId);
        if (!reading) await ctx.beforeSetupWrite?.(projectId, req.body, current);
        const standalone = await readDocumentProjectReferences(root, projectId);
        const ids = action === 'references-save' ? DocumentProjectReferencesRequestSchema.parse(req.body).projectIds
          : action === 'save' && Array.isArray(req.body?.contextProjectIds) ? req.body.contextProjectIds
          : current?.intent.contextProjectIds ?? standalone.references.map((entry) => entry.projectId);
        const references = await resolveDocumentProjectReferences({ primaryProjectId: projectId, projectIds: ids, projectsDir: ctx.paths.PROJECTS_DIR,
          authorize: (id) => ctx.authorizeProjectRequest(req, res, id, { mode: 'read' }),
          getProject: (id) => ctx.projectStore.getProject(ctx.db, id) });
        if (references === null) return;
        if (action === 'references-save') {
          await saveDocumentProjectReferences(root, projectId, references);
          if (current) await saveDocumentSetupIntent(root, { contextProjectIds: references.map((entry) => entry.projectId) }, project.metadata, projectId, references);
          res.json({ references }); return;
        }
        if (action === 'references-read') { res.json({ references }); return; }
        if (action === 'scan' && !current) {
          const referenceContext = await scanStandaloneProjectReferences(root, projectId, references);
          res.json({ setup: null, referenceContext }); return;
        }
        const setup = action === 'read' ? current ? { ...current, projectContexts: references } : null
          : action === 'save' ? await saveDocumentSetupIntent(root, req.body, project.metadata, projectId, references)
          : action === 'scan' ? await scanDocumentSetupContext(root, project.metadata, undefined, projectId, references)
          : await confirmDocumentSetup(root, req.body, project.metadata, projectId);
        if (setup && !reading) await ctx.documentRegistry?.setupUpdated(projectId, setup);
        res.json({ setup });
      } catch (error) {
        if (error instanceof ProjectDocumentScopeConflict) { ctx.http.sendApiError(res, 409, 'DOCUMENT_WORKSPACE_REQUIRED', error.message, { details: { documentId: error.documentId, workspaceProjectId: error.workspaceProjectId } }); return; }
        ctx.http.sendApiError(res, 400, 'DOCUMENT_SETUP_FAILED', error instanceof Error ? error.message : String(error));
      }
    });
  }
}
