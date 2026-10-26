import { BlockoutDocumentSchema, BlockoutInventoryResponseSchema, type BlockoutDocument, type BlockoutFitAssessment, type BlockoutInventoryResponse, type WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';

export const BLOCKOUT_MATERIALS_UPDATED_EVENT = 'melillodesign:blockout-materials-updated';
export const BLOCKOUT_COMPARISON_RESULT_EVENT = 'melillodesign:blockout-comparison-result';
export interface BlockoutComparisonResult { projectId: string; documentId: string; error?: string; path?: string }
const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;
function headers(context?: WorkspaceCollabContext | null, json = false): HeadersInit {
  return { ...(context ? workspaceProjectHeaders(context) : {}), ...(json ? { 'content-type': 'application/json' } : {}) };
}
async function body(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error('blockoutMaterials.loadFailed');
  try { return await response.json(); } catch { throw new Error('blockoutMaterials.loadFailed'); }
}
export async function loadBlockoutMaterials(projectId: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal, refresh = false): Promise<BlockoutInventoryResponse> {
  const response = await fetch(`${base(projectId)}/blockout-materials`, { method: refresh ? 'POST' : 'GET', cache: 'no-store', signal,
    headers: headers(context, refresh), ...(refresh ? { body: '{}' } : {}) });
  const parsed = BlockoutInventoryResponseSchema.safeParse(await body(response));
  if (!parsed.success || parsed.data.inventory.projectId !== projectId) throw new Error('blockoutMaterials.loadFailed');
  return parsed.data;
}
/** This measures a snapshot without saving or accepting the document. */
export async function assessBlockoutDocument(projectId: string, document: BlockoutDocument, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<BlockoutFitAssessment> {
  const response = await fetch(`${base(projectId)}/blockout-documents/${encodeURIComponent(document.documentId)}/assessment`, {
    method: 'POST', cache: 'no-store', signal, headers: headers(context, true), body: JSON.stringify({ document: BlockoutDocumentSchema.parse(document) }),
  });
  const value = await body(response) as { assessment?: BlockoutFitAssessment };
  const assessment = value?.assessment;
  if (!assessment || assessment.documentId !== document.documentId || !['waiting', 'blocked', 'warning', 'ready'].includes(assessment.status)
    || typeof assessment.documentRevision !== 'string' || !Array.isArray(assessment.variants) || !Array.isArray(assessment.issues)) throw new Error('blockoutMaterials.checkFailed');
  return assessment;
}
export async function blockoutDocumentRevision(document: BlockoutDocument): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(BlockoutDocumentSchema.parse(document))));
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
