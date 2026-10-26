import type { Express } from 'express';
import { CreateProjectDocumentRequestSchema, ProjectDocumentIdSchema, UpdateProjectDocumentRequestSchema, type ProjectDocument, type ProjectDocumentWorkspaceBootstrap, type ProjectDocumentWorkspaceResult } from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import { resolveProjectDir } from '../projects.js';
import { requireLocalDaemonRequest } from '../http/local-daemon-request.js';
import type { ProjectDocumentsStore } from '../services/project-documents.js';

export interface RegisterProjectDocumentsRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectStore' | 'authorizeProjectRequest'> {
  documents: {
    store(projectId: string, root: string): Promise<ProjectDocumentsStore> | ProjectDocumentsStore;
    bootstrapWorkspace(input: ProjectDocumentWorkspaceBootstrap): Promise<ProjectDocumentWorkspaceResult>;
    onDocumentUpdated?(document: ProjectDocument, previous?: ProjectDocument): Promise<void>;
    authorizeConversation?(conversationId: string, allowedProjectIds: string[]): Promise<boolean> | boolean;
    openDocument?(projectId: string, root: string, documentId: string): Promise<import('@open-design/contracts').ProjectDocumentMutationResponse>;
  };
}
export function registerProjectDocumentsRoutes(app: Express, ctx: RegisterProjectDocumentsRoutesDeps): void {
  const base = '/api/projects/:id/documents';
  for (const action of ['list', 'create', 'read', 'update', 'context', 'open'] as const) {
    const reading = ['list', 'read', 'context'].includes(action);
    const suffix = ['list', 'create'].includes(action) ? '' : '/:documentId' + (action === 'context' ? '/context' : action === 'open' ? '/open' : '');
    const method = action === 'create' || action === 'open' ? 'post' : action === 'update' ? 'patch' : 'get';
    app[method](`${base}${suffix}`, ...(reading ? [] : [requireLocalDaemonRequest]), async (req, res) => {
      try {
        let projectId = String(req.params.id);
        if (!await ctx.authorizeProjectRequest(req, res, projectId, reading ? { mode: 'read' } : { mode: 'write', capability: 'writeFiles' })) return;
        let project = ctx.projectStore.getProject(ctx.db, projectId);
        if (!project) { ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
        // A document workspace is a navigation alias of its parent library,
        // never a second registry. Verify parent authority independently.
        if (project.metadata?.collectionProjectId) {
          projectId = project.metadata.collectionProjectId;
          if (!await ctx.authorizeProjectRequest(req, res, projectId, reading ? { mode: 'read' } : { mode: 'write', capability: 'writeFiles' })) return;
          project = ctx.projectStore.getProject(ctx.db, projectId);
          if (!project || project.metadata?.collectionProjectId) { ctx.http.sendApiError(res, 409, 'PROJECT_DOCUMENT_CONFLICT', 'The parent document library is unavailable'); return; }
        }
        const root = resolveProjectDir(ctx.paths.PROJECTS_DIR, project.id, project.metadata), store = await ctx.documents.store(projectId, root);
        if (action === 'list') {
          if (Object.keys(req.query).some((key) => key !== 'includeArchived') || (req.query.includeArchived !== undefined && !['true', 'false', '1', '0'].includes(String(req.query.includeArchived)))) throw Object.assign(new Error('Invalid document list request'), { statusCode: 400 });
          res.json(await store.list({ includeArchived: ['true', '1'].includes(String(req.query.includeArchived)) })); return;
        }
        if (action === 'create') {
          const input = CreateProjectDocumentRequestSchema.parse(req.body);
          if (input.conversationId && (!ctx.documents.authorizeConversation || !await ctx.documents.authorizeConversation(input.conversationId, [projectId]))) { ctx.http.sendApiError(res, 403, 'DOCUMENT_CONVERSATION_FORBIDDEN', 'Conversation does not belong to this project'); return; }
          const result = await store.create(input, ctx.documents.bootstrapWorkspace);
          await ctx.documents.onDocumentUpdated?.(result.document); res.status(201).json(result); return;
        }
        const documentId = ProjectDocumentIdSchema.parse(req.params.documentId);
        if (action === 'open') {
          if (!ctx.documents.openDocument) throw Object.assign(new Error('Document opening is unavailable'), { statusCode: 503 });
          res.json(await ctx.documents.openDocument(projectId, root, documentId)); return;
        }
        if (action === 'read') { res.json({ document: await store.get(documentId) }); return; }
        if (action === 'context') {
          if (Object.keys(req.query).some((key) => key !== 'path') || (req.query.path !== undefined && typeof req.query.path !== 'string')) throw Object.assign(new Error('Invalid document context request'), { statusCode: 400 });
          res.json(await store.context(documentId, req.query.path as string | undefined)); return;
        }
        const input = UpdateProjectDocumentRequestSchema.parse(req.body), previous = await store.get(documentId);
        if (input.conversationId && (!ctx.documents.authorizeConversation || !await ctx.documents.authorizeConversation(input.conversationId, [projectId, previous.workspaceProjectId]))) { ctx.http.sendApiError(res, 403, 'DOCUMENT_CONVERSATION_FORBIDDEN', 'Conversation does not belong to this document'); return; }
        const result = await store.update(documentId, input, ctx.documents.bootstrapWorkspace);
        await ctx.documents.onDocumentUpdated?.(result.document, previous); res.json(result);
      } catch (error) {
        const requested = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 500;
        const status = error instanceof Error && error.name === 'ZodError' ? 400 : [400, 403, 404, 409, 413, 503].includes(requested) ? requested : 500;
        ctx.http.sendApiError(res, status, `PROJECT_DOCUMENT_${status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : status === 400 ? 'INVALID_REQUEST' : status === 403 ? 'FORBIDDEN' : 'UNAVAILABLE'}`, status === 404 ? 'Document or file not found in this project' : status === 400 ? 'Invalid document request or folder' : status === 403 ? 'File is outside the registered document scope' : status === 409 ? 'Document association needs attention before this action' : 'The document registry or its folder is unavailable');
      }
    });
  }
}
