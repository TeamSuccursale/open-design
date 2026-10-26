import type { Express } from 'express';
import { createHash } from 'node:crypto';
import { assessBlockoutStructure, BlockoutDocumentSchema, type BlockoutDocument, type BlockoutReserveAdjustment, type BlockoutWorkspaceResponse, type BlockoutAppendAlternativesResponse } from '@open-design/contracts';
import { HeaderFooterError } from '../services/header-footer.js';
import type { ProjectDocumentsRuntime } from '../services/project-documents-runtime.js';
import { ProjectDocumentScopeConflict } from '../services/project-document-folders.js';
import type { RouteDeps } from '../server-context.js';
import { resolveProjectDir } from '../projects.js';
import { requireLocalDaemonRequest } from '../http/local-daemon-request.js';
import { BlockoutAlternativeConflict, BlockoutWorkspaceConflict, appendBlockoutAlternatives, listBlockoutWorkspaces, readBlockoutWorkspace, saveBlockoutCatalog, saveBlockoutWorkspace, saveBlockoutWorkspaceStartingPoint } from '../services/blockout-workspaces.js';
import type { BlockoutMaterialsService } from '../services/blockout-materials.js';
import { assessBlockoutFit } from '../services/blockout-fit.js';
import { saveMeasuredBlockoutComparison, saveStructuralBlockoutComparison } from '../services/blockout-comparison.js';
import { registerBlockoutDesignRoutes } from './blockout-design.js';
import type { BlockoutDesignRunLookup } from '../services/blockout-design.js';
import { appliedBlockoutDesignEntry } from '../services/blockout-design.js';

export interface RegisterBlockoutWorkspaceRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectStore' | 'authorizeProjectRequest'> {
  blockoutMaterials?: Pick<BlockoutMaterialsService, 'get'>;
  history?: { store(projectId: string, root: string): Promise<unknown> };
  documentRegistry?: Pick<ProjectDocumentsRuntime, 'setupUpdated' | 'blockoutUpdated'>;
  beforeBlockoutWrite?: ProjectDocumentsRuntime['beforeBlockoutWrite'];
  /** `authoredByRun` marks a save or appended alternatives from an agent run (the CLI forwards OD_RUN_ID); only those are fitted to the reserve. */
  normalizeBlockout?(projectId: string, document: BlockoutDocument, options?: { authoredByRun?: boolean }): Promise<{ document: BlockoutDocument; reserveAdjustments: BlockoutReserveAdjustment[] }>;
  getDesignRun?: BlockoutDesignRunLookup;
}

/** Owns only validated Blockout metadata; generic imported-folder dotfile protection remains intact. */
export function registerBlockoutWorkspaceRoutes(app: Express, ctx: RegisterBlockoutWorkspaceRoutesDeps): void {
  registerBlockoutDesignRoutes(app, ctx);
  const base = '/api/projects/:id/blockout-documents';
  for (const operation of ['list', 'catalog', 'read', 'save', 'brief', 'append'] as const) {
    const reading = operation === 'list' || operation === 'read';
    const method = reading ? 'get' : operation === 'brief' || operation === 'append' ? 'post' : 'put';
    const endpoint = `${base}${['read', 'save', 'brief', 'append'].includes(operation) ? '/:documentId' : ''}${operation === 'brief' ? '/starting-point' : operation === 'append' ? '/alternatives' : ''}`;
    app[method](endpoint, ...(reading ? [] : [requireLocalDaemonRequest]), async (req, res) => {
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        if (!await ctx.authorizeProjectRequest(req, res, id, reading ? { mode: 'read' } : { mode: 'write', capability: 'writeFiles' })) return;
        const project = ctx.projectStore.getProject(ctx.db, id);
        if (!project) { ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
        const root = resolveProjectDir(ctx.paths.PROJECTS_DIR, project.id, project.metadata);
        await ctx.history?.store(id, root);
        const documentId = typeof req.params.documentId === 'string' ? req.params.documentId : '';
        if (!reading) await ctx.beforeBlockoutWrite?.(id, operation === 'catalog' && Array.isArray(req.body?.documents) ? req.body.documents.map((item: unknown) => item && typeof item === 'object' && 'id' in item ? item.id : undefined) : [documentId]);
        if (operation === 'list') res.json(await listBlockoutWorkspaces(root));
        else if (operation === 'catalog') res.json(await saveBlockoutCatalog(root, req.body));
        else if (operation === 'read') res.json(await readBlockoutWorkspace(root, documentId));
        else if (operation === 'save' || operation === 'append') {
          const normalize = ctx.normalizeBlockout, authoredByRun = Boolean(req.get('x-od-run-id'));
          const normalized = operation === 'save' && normalize ? await normalize(id, BlockoutDocumentSchema.parse(req.body?.document), { authoredByRun }) : null;
          const input = normalized ? { ...req.body, document: normalized.document } : req.body;
          let saved: BlockoutWorkspaceResponse & { alternativeBatch?: BlockoutAppendAlternativesResponse['alternativeBatch'] } = operation === 'append'
            ? await appendBlockoutAlternatives(root, documentId, input, normalize ? (appended) => normalize(id, appended, { authoredByRun }) : undefined)
            : { ...await saveBlockoutWorkspace(root, documentId, input), ...(normalized?.reserveAdjustments.length ? { reserveAdjustments: normalized.reserveAdjustments } : {}) };
          const fitted = saved.reserveAdjustments ? { reserveAdjustments: saved.reserveAdjustments } : {};
          if (saved.document && ctx.documentRegistry) {
            try { await ctx.documentRegistry.blockoutUpdated(id, saved.document); }
            catch (error) {
              if (operation !== 'append') throw error;
              // Appended proposals are committed; reporting failure invites a
              // duplicate generation. Expose the result and publication warning.
              res.json({ ...saved, comparisonError: error instanceof Error ? error.message : String(error) }); return;
            }
            // Registry reconciliation may normalize the output name and its
            // presentation together. Publish and return that actual revision.
            saved = { ...await readBlockoutWorkspace(root, documentId), ...(saved.alternativeBatch ? { alternativeBatch: saved.alternativeBatch } : {}), ...fitted };
          }
          if (saved.document && saved.document.planningStage !== 'composition' && saved.raw) {
            const assessment = assessBlockoutStructure(saved.document, { documentRevision: createHash('sha256').update(JSON.stringify(saved.document)).digest('hex'), assessedAt: new Date().toISOString() });
            try {
              const comparisonPath = await saveStructuralBlockoutComparison(root, saved.document, saved.raw, assessment);
              if (comparisonPath) await ctx.documentRegistry?.blockoutUpdated(id, saved.document, await appliedBlockoutDesignEntry(root, documentId) ?? comparisonPath);
              res.json({ ...saved, assessment, ...(comparisonPath ? { comparisonPath } : { comparisonError: 'A newer document revision replaced this comparison request.' }) });
            } catch (error) { res.json({ ...saved, assessment, comparisonError: error instanceof Error ? error.message : String(error) }); }
          } else if (saved.document?.materialRevision && saved.raw && ctx.blockoutMaterials) {
            try {
              const inventory = await ctx.blockoutMaterials.get(root, project.metadata, id);
              const manualBrief = saved.document.variants.length === 1 && saved.document.variants[0]?.id === 'brief';
              const assessment = await assessBlockoutFit(saved.document, inventory, { projectRoot: root, minimumAlternatives: manualBrief ? 1 : 3 });
              const comparisonPath = await saveMeasuredBlockoutComparison(root, saved.document, saved.raw, inventory, assessment);
              if (comparisonPath) await ctx.documentRegistry?.blockoutUpdated(id, saved.document, await appliedBlockoutDesignEntry(root, documentId) ?? comparisonPath);
              res.json({ ...saved, assessment, ...(comparisonPath ? { comparisonPath } : { comparisonError: 'A newer document revision replaced this comparison request.' }) });
            } catch (error) {
              // The layout revision is already committed. Returning it avoids a
              // false save failure and lets the caller retry just the preview.
              res.json({ ...saved, comparisonError: error instanceof Error ? error.message : String(error) });
            }
          } else res.json(saved);
        }
        else res.json({ ok: true, ...await saveBlockoutWorkspaceStartingPoint(root, documentId, req.body, ctx.getDesignRun ? { projectId: id, getRun: ctx.getDesignRun } : undefined) });
      } catch (error) {
        if (error instanceof ProjectDocumentScopeConflict) { ctx.http.sendApiError(res, 409, 'DOCUMENT_WORKSPACE_REQUIRED', error.message, { details: { documentId: error.documentId, workspaceProjectId: error.workspaceProjectId } }); return; }
        if (error instanceof BlockoutAlternativeConflict) { ctx.http.sendApiError(res, 409, error.code, error.message, { details: error.resultPath ? { resultPath: error.resultPath } : {} }); return; }
        // Not 409: the editor reads 409 as a stale revision. Only run-authored saves can be refused here.
        if (error instanceof HeaderFooterError && error.code === 'BLOCKOUT_RESERVE_OVERLAP') { ctx.http.sendApiError(res, error.statusCode, error.code, error.message); return; }
        ctx.http.sendApiError(res, error instanceof BlockoutWorkspaceConflict ? 409 : 400, error instanceof BlockoutWorkspaceConflict ? 'BLOCKOUT_CONFLICT' : 'BLOCKOUT_FAILED', error instanceof Error ? error.message : String(error));
      }
    });
  }
  // Assessment never trusts client-reported fit or modifies a saved layout.
  // Both surfaces can check the current revision or a complete unsaved proposal.
  for (const method of ['get', 'post'] as const) {
    app[method](`${base}/:documentId/assessment`, ...(method === 'post' ? [requireLocalDaemonRequest] : []), async (req, res) => {
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        if (!await ctx.authorizeProjectRequest(req, res, id, { mode: 'read' })) return;
        const project = ctx.projectStore.getProject(ctx.db, id);
        if (!project) { ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
        const root = resolveProjectDir(ctx.paths.PROJECTS_DIR, project.id, project.metadata);
        const documentId = typeof req.params.documentId === 'string' ? req.params.documentId : '';
        const supplied = method === 'post' && req.body && typeof req.body === 'object'
          ? req.body.document ?? (req.body.version === 1 ? req.body : undefined) : undefined;
        const document = supplied === undefined ? (await readBlockoutWorkspace(root, documentId)).document : BlockoutDocumentSchema.parse(supplied);
        if (!document) { ctx.http.sendApiError(res, 404, 'BLOCKOUT_NOT_FOUND', 'Blockout document not found'); return; }
        if (document.documentId !== documentId) throw new Error('Document identity does not match the requested assessment');
        if (document.planningStage !== 'composition') {
          res.json({ assessment: assessBlockoutStructure(document, { documentRevision: createHash('sha256').update(JSON.stringify(document)).digest('hex'), assessedAt: new Date().toISOString() }) }); return;
        }
        if (!ctx.blockoutMaterials) { ctx.http.sendApiError(res, 503, 'BLOCKOUT_MATERIALS_UNAVAILABLE', 'Material inventory is not available'); return; }
        const inventory = await ctx.blockoutMaterials.get(root, project.metadata, id);
        const manualBrief = document.variants.length === 1 && document.variants[0]?.id === 'brief';
        const assessment = await assessBlockoutFit(document, inventory, { projectRoot: root, minimumAlternatives: manualBrief ? 1 : 3 });
        res.json({ assessment });
      } catch (error) {
        ctx.http.sendApiError(res, 400, 'BLOCKOUT_ASSESSMENT_FAILED', error instanceof Error ? error.message : String(error));
      }
    });
  }
}
