import { BlockoutDocumentSchema, BlockoutHandoffSchema, ProjectDocumentSchema, type BlockoutHandoffRequest, type BlockoutHandoffResponse, type BlockoutDocument, type BlockoutDocumentEntry, type BlockoutWorkspaceResponse, type WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import { invalidateProjectFilesCache } from './registry';
import { BLOCKOUT_COMPARISON_RESULT_EVENT, type BlockoutComparisonResult } from './blockout-materials';
export { BLOCKOUT_COMPARISON_RESULT_EVENT, type BlockoutComparisonResult } from './blockout-materials';

const endpoint = (projectId: string, documentId?: string) => `/api/projects/${encodeURIComponent(projectId)}/blockout-documents${documentId ? `/${encodeURIComponent(documentId)}` : ''}`;
const redirectedWrites = new WeakSet<Response>();

/** Resolve an exact registered entry, including outputs linked from a collection's working chat. */
export async function registeredBlockoutComparisonDocument(projectId: string, filePath: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<string | null> {
  const path = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  const match = /^documents\/([^/]+)\/(.+)$/.exec(path);
  if (!match || !/(?:^|\/)blockout-comparison(?:[-_][\w.-]+)?\.html$/i.test(path) || path.split('/').some((part) => part === '..' || part === '.')) return null;
  if (/^documents\/.+\/blockout-comparison(?:[-_][\w.-]+)?\.html$/i.test(match[2]!)) {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(match[1]!)}`, { cache: 'no-store', signal, headers: headers(context) });
    if (response.status === 404 || response.status === 409) return null;
    if (!response.ok) throw new Error('blockout.loadFailed');
    const value = await response.json() as { document?: unknown }, parsed = ProjectDocumentSchema.safeParse(value.document);
    if (!parsed.success || parsed.data.id !== match[1] || parsed.data.projectId !== projectId || parsed.data.archivedAt || parsed.data.availability !== 'available' || parsed.data.entryFile !== match[2]) throw new Error('blockout.invalidDocument');
    return parsed.data.blockoutDocumentId ?? parsed.data.id;
  }
  // A Fast working chat links the child output by its original entryFile, not
  // necessarily through the collection's documents/<registry-id>/ alias. Its
  // parent's empty legacy catalog cannot identify that child by title alone.
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents`, { cache: 'no-store', signal, headers: headers(context) });
  if (response.status === 404 || response.status === 409) return null;
  if (!response.ok) throw new Error('blockout.loadFailed');
  const value = await response.json() as { documents?: unknown };
  if (!Array.isArray(value.documents)) throw new Error('blockout.invalidDocument');
  const entries = value.documents.map((entry) => ProjectDocumentSchema.safeParse(entry));
  if (entries.some((entry) => !entry.success || entry.data.projectId !== projectId)) throw new Error('blockout.invalidDocument');
  const matches = entries.flatMap((entry) => entry.success && !entry.data.archivedAt && entry.data.availability === 'available' && entry.data.entryFile === path ? [entry.data] : []);
  // Ambiguous names are never permission to pick a different document.
  if (matches.length > 1) throw new Error('blockout.invalidDocument');
  return matches[0]?.blockoutDocumentId ?? matches[0]?.id ?? null;
}
function headers(context?: WorkspaceCollabContext | null, json = false): HeadersInit {
  // The app's fetch instrumentation merges header records by object spread.
  // Keep JSON and workspace authority enumerable through that boundary.
  return { ...(context ? workspaceProjectHeaders(context) : {}), ...(json ? { 'content-type': 'application/json' } : {}) };
}
/** A parent chat can preview an output whose editable files belong to its registered child. */
export async function registeredWorkspace(projectId: string, documentId: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<string | null> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}`, { cache: 'no-store', signal, headers: headers(context) });
  if (response.status === 404 || response.status === 409) return null;
  if (!response.ok) throw new Error('blockout.loadFailed');
  const value = await response.json() as { document?: unknown }, parsed = ProjectDocumentSchema.safeParse(value.document);
  if (!parsed.success || parsed.data.id !== documentId || parsed.data.projectId !== projectId || parsed.data.archivedAt || parsed.data.availability !== 'available') throw new Error('blockout.invalidDocument');
  return parsed.data.workspaceProjectId !== projectId ? parsed.data.workspaceProjectId : null;
}
async function workspaceScopeConflict(response: Response): Promise<boolean> {
  if (response.status !== 409) return false;
  const failure = await response.clone().json().catch(() => null) as { error?: { code?: string } } | null;
  return failure?.error?.code === 'DOCUMENT_WORKSPACE_REQUIRED';
}
async function workspaceWrite(projectId: string, documentId: string, init: RequestInit, context?: WorkspaceCollabContext | null, suffix = ''): Promise<Response> {
  const response = await fetch(`${endpoint(projectId, documentId)}${suffix}`, init);
  // Ordinary revision conflicts must never be retried against a different file.
  if (!await workspaceScopeConflict(response)) return response;
  const workspaceId = await registeredWorkspace(projectId, documentId, context);
  if (!workspaceId) return response;
  const retried = await fetch(`${endpoint(workspaceId, documentId)}${suffix}`, init);
  if (retried.ok) redirectedWrites.add(retried);
  if (retried.ok) invalidateProjectFilesCache(workspaceId, context);
  return retried;
}
async function workspaceResponse(response: Response, documentId: string, failureKey = 'blockout.loadFailed'): Promise<BlockoutWorkspaceResponse> {
  if (response.status === 409) throw new Error('blockout.conflict');
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message || failureKey);
  }
  let body: BlockoutWorkspaceResponse;
  try { body = await response.json() as BlockoutWorkspaceResponse; } catch { throw new Error('blockout.invalidDocument'); }
  if (body?.document === null && body.raw === null) return body;
  const parsed = BlockoutDocumentSchema.safeParse(body?.document);
  if (!parsed.success || typeof body.raw !== 'string' || parsed.data.documentId !== documentId) throw new Error('blockout.invalidDocument');
  return { ...body, document: parsed.data, raw: body.raw };
}

export async function loadBlockout(projectId: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal, documentId = 'document-1') {
  const response = await fetch(endpoint(projectId, documentId), { cache: 'no-store', signal, headers: headers(context) });
  if (await workspaceScopeConflict(response)) {
    const workspaceId = await registeredWorkspace(projectId, documentId, context, signal);
    if (!workspaceId) return workspaceResponse(response, documentId);
    return workspaceResponse(await fetch(endpoint(workspaceId, documentId), { cache: 'no-store', signal, headers: headers(context) }), documentId);
  }
  const loaded = response.status === 404 ? { document: null, raw: null } : await workspaceResponse(response, documentId);
  if (loaded.document || documentId === 'document-1') return loaded;
  const workspaceId = await registeredWorkspace(projectId, documentId, context, signal);
  if (!workspaceId) return loaded;
  const child = await fetch(endpoint(workspaceId, documentId), { cache: 'no-store', signal, headers: headers(context) });
  return workspaceResponse(child, documentId);
}

/** Server owns revision comparison, derived page files and hidden catalog metadata. */
export async function saveBlockout(projectId: string, document: BlockoutDocument, baseRaw: string | null,
  context?: WorkspaceCollabContext | null, startingPoint = false): Promise<string> {
  const validated = BlockoutDocumentSchema.parse(document);
  const response = await workspaceWrite(projectId, validated.documentId, { method: 'PUT', headers: headers(context, true),
    body: JSON.stringify({ document: validated, baseRaw, startingPoint }) }, context);
  const result = await workspaceResponse(response, validated.documentId, 'blockout.saveFailed');
  if (result.raw === null) throw new Error('blockout.invalidDocument');
  invalidateProjectFilesCache(projectId, context);
  // The layout is committed even when its derived comparison could not render.
  // Keep its returned revision authoritative and report preview status separately.
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<BlockoutComparisonResult>(BLOCKOUT_COMPARISON_RESULT_EVENT, {
    detail: { projectId, documentId: validated.documentId, ...(result.comparisonError ? { error: result.comparisonError } : {}), ...(result.comparisonPath ? { path: result.comparisonPath } : {}) },
  }));
  return result.raw;
}

export async function listBlockoutDocuments(projectId: string, context?: WorkspaceCollabContext | null): Promise<BlockoutDocumentEntry[]> {
  const response = await fetch(endpoint(projectId), { cache: 'no-store', headers: headers(context) });
  if (!response.ok) throw new Error('blockout.loadFailed');
  let body: { version?: unknown; documents?: unknown };
  try { body = await response.json() as typeof body; } catch { throw new Error('blockout.invalidDocument'); }
  const documents = body?.documents;
  if (body?.version !== 1 || !Array.isArray(documents) || documents.length > 50 || !documents.every((item) => item && typeof item.id === 'string' && /^(?!\.{1,2}$)[\w.-]+$/.test(item.id) && typeof item.title === 'string')) throw new Error('blockout.invalidDocument');
  return documents;
}

export async function saveBlockoutStartingPoint(projectId: string, document: BlockoutDocument, context?: WorkspaceCollabContext | null, baseRaw?: string, options?: Pick<BlockoutHandoffRequest, 'operation' | 'requestId' | 'variantId' | 'action'>): Promise<BlockoutHandoffResponse> {
  const validated = BlockoutDocumentSchema.parse(document);
  const response = await workspaceWrite(projectId, validated.documentId, {
    method: 'POST', headers: headers(context, true), body: JSON.stringify({ document: validated, baseRaw, ...options }),
  }, context, '/starting-point');
  if (response.status === 409) throw new Error('blockout.conflict');
  if (!response.ok) throw new Error('blockout.loadFailed');
  const body = await response.json() as BlockoutHandoffResponse;
  const parsed = BlockoutHandoffSchema.safeParse(body.handoff);
  if (!parsed.success || parsed.data.snapshot.documentId !== document.documentId || typeof body.path !== 'string'
    || body.path !== `blockouts/${document.documentId}/handoffs/${parsed.data.id}.blockout-update.json`) throw new Error('blockout.invalidDocument');
  return redirectedWrites.has(response) ? {...body,path:`documents/${validated.documentId}/${body.path}`} : body;
}
