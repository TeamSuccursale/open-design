import type { ApplyHeaderFooterRequest, CreateHeaderFooterSetRequest, HeaderFooterHistoryResponse, HeaderFooterSearchRequest, HeaderFooterSet, HeaderFooterWorkspaceResponse, HeaderFooterSourceFilesResponse, PublishHeaderFooterRequest, RestoreHeaderFooterRequest, SaveHeaderFooterDraftRequest, WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import { HEADER_FOOTER_UPDATED_EVENT } from '../components/header-footer/events';

export class HeaderFooterError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = 'HeaderFooterError'; }
}
async function request(projectId: string, suffix: string, method = 'GET', body?: unknown, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<HeaderFooterWorkspaceResponse & { set?: HeaderFooterSet }> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/header-footer${suffix}`, {
    method, signal, cache: 'no-store', headers: { ...(context ? workspaceProjectHeaders(context) : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json().catch(() => null) as (HeaderFooterWorkspaceResponse & { set?: HeaderFooterSet; error?: { code?: string; message?: string } | string; message?: string }) | null;
  if (!response.ok) {
    const detail = typeof value?.error === 'object' ? value.error : undefined;
    throw new HeaderFooterError(response.status, detail?.code ?? 'HEADER_FOOTER_FAILED', detail?.message ?? value?.message ?? (typeof value?.error === 'string' ? value.error : response.status === 409 ? 'Questa versione è cambiata. Ricarica prima di applicare; la tua bozza resta aperta.' : 'Non è stato possibile completare l’operazione. Riprova.'));
  }
  if (!value || !Array.isArray(value.sets) || !Array.isArray(value.bindings) || !Array.isArray(value.assets)) throw new HeaderFooterError(500, 'INVALID_RESPONSE', 'La risposta del progetto non è completa. Ricarica per riprovare.');
  if (method !== 'GET' && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(HEADER_FOOTER_UPDATED_EVENT, { detail: { projectId } }));
  return value;
}
export const getHeaderFooterWorkspace = (projectId: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal) => request(projectId, '', 'GET', undefined, context, signal);
export async function getHeaderFooterSourceFiles(projectId: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<HeaderFooterSourceFilesResponse> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/header-footer/source-files`, { cache: 'no-store', signal, headers: context ? workspaceProjectHeaders(context) : {} });
  if (!response.ok) throw new HeaderFooterError(response.status, 'SOURCE_FILES_FAILED', 'Non è stato possibile leggere i file già forniti. Riprova.');
  return response.json() as Promise<HeaderFooterSourceFilesResponse>;
}
export const importHeaderFooterSources = (projectId: string, sourceIds: string[], context?: WorkspaceCollabContext | null) => request(projectId, '/assets/import', 'POST', { sourceIds }, context) as Promise<HeaderFooterWorkspaceResponse & { errors?: { name: string; error: string }[] }>;
export const createHeaderFooterSet = (projectId: string, body: CreateHeaderFooterSetRequest, context?: WorkspaceCollabContext | null) => request(projectId, '/sets', 'POST', body, context);
export const saveHeaderFooterDraft = (projectId: string, setId: string, body: SaveHeaderFooterDraftRequest, context?: WorkspaceCollabContext | null) => request(projectId, `/sets/${encodeURIComponent(setId)}/draft`, 'PATCH', body, context);
export const publishHeaderFooterSet = (projectId: string, setId: string, body: PublishHeaderFooterRequest, context?: WorkspaceCollabContext | null) => request(projectId, `/sets/${encodeURIComponent(setId)}/publish`, 'POST', body, context);
export const applyHeaderFooterSet = (projectId: string, documentId: string, body: ApplyHeaderFooterRequest, context?: WorkspaceCollabContext | null) => request(projectId, `/documents/${encodeURIComponent(documentId)}/binding`, 'POST', body, context);
export const detachHeaderFooterSet = (projectId: string, documentId: string, version: number, context?: WorkspaceCollabContext | null) => request(projectId, `/documents/${encodeURIComponent(documentId)}/detach`, 'POST', { expectedBindingVersion: version }, context);
export const disableHeaderFooter = (projectId: string, documentId: string, version: number | undefined, context?: WorkspaceCollabContext | null) => request(projectId, `/documents/${encodeURIComponent(documentId)}/binding?expectedBindingVersion=${version ?? 0}`, 'DELETE', undefined, context);
export const retryHeaderFooterUpdates = (projectId: string, context?: WorkspaceCollabContext | null) => request(projectId, '/retry', 'POST', {}, context);
export const restoreHeaderFooterSet = (projectId: string, setId: string, body: RestoreHeaderFooterRequest, context?: WorkspaceCollabContext | null) => request(projectId, `/sets/${encodeURIComponent(setId)}/restore`, 'POST', body, context);
export type HeaderFooterVersions = HeaderFooterHistoryResponse;
export async function getHeaderFooterVersions(projectId: string, setId: string, context?: WorkspaceCollabContext | null): Promise<HeaderFooterVersions> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/header-footer/sets/${encodeURIComponent(setId)}/history`, { cache: 'no-store', headers: context ? workspaceProjectHeaders(context) : {} });
  if (!response.ok) throw new HeaderFooterError(response.status, 'HISTORY_FAILED', 'Non è stato possibile caricare le versioni. Riprova.');
  return response.json() as Promise<HeaderFooterVersions>;
}
export const restoreHeaderFooterDraft = (projectId: string, setId: string, entryId: string, expectedDraftVersion: number, context?: WorkspaceCollabContext | null) => request(projectId, `/sets/${encodeURIComponent(setId)}/restore-draft`, 'POST', { entryId, expectedDraftVersion }, context);
export const searchHeaderFooterLogo = (projectId: string, body: HeaderFooterSearchRequest, context?: WorkspaceCollabContext | null) => request(projectId, '/searches', 'POST', body, context);
export const cancelHeaderFooterSearch = (projectId: string, searchId: string, context?: WorkspaceCollabContext | null) => request(projectId, `/searches/${encodeURIComponent(searchId)}/cancel`, 'POST', {}, context);
export const retryHeaderFooterSearch = (projectId: string, searchId: string, context?: WorkspaceCollabContext | null) => request(projectId, `/searches/${encodeURIComponent(searchId)}/retry`, 'POST', {}, context);
export const chooseHeaderFooterCandidate = (projectId: string, searchId: string, assetId: string, context?: WorkspaceCollabContext | null) => request(projectId, `/searches/${encodeURIComponent(searchId)}/choose`, 'POST', { assetId }, context);
export async function uploadHeaderFooterFiles(projectId: string, files: File[], context?: WorkspaceCollabContext | null): Promise<HeaderFooterWorkspaceResponse & { errors?: { name: string; error: string }[] }> {
  const encoded = await Promise.all(files.map(async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
    for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    return { name: file.name, mimeType: file.type, base64: btoa(binary) };
  }));
  return request(projectId, '/assets', 'POST', { files: encoded }, context);
}
export const removeHeaderFooterAsset = (projectId: string, assetId: string, context?: WorkspaceCollabContext | null) => request(projectId, `/assets/${encodeURIComponent(assetId)}`, 'DELETE', undefined, context);
