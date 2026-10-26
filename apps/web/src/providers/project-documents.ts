import { CreateProjectDocumentRequestSchema, ProjectDocumentSchema, UpdateProjectDocumentRequestSchema,
  type CreateProjectDocumentRequest, type ProjectDocument, type ProjectDocumentContextResponse, type ProjectDocumentsResponse,
  type UpdateProjectDocumentRequest, type WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';

export const PROJECT_DOCUMENTS_UPDATED_EVENT = 'melillodesign:project-documents-updated';
export class ProjectDocumentsError extends Error {
  constructor(readonly status: number, readonly code = 'DOCUMENTS_FAILED') { super(code); }
}
async function request(projectId: string, suffix: string, context?: WorkspaceCollabContext | null, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents${suffix}`, {
    method, cache: 'no-store', signal,
    headers: { ...(context ? workspaceProjectHeaders(context) : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const value = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    throw new ProjectDocumentsError(response.status, value?.error?.code);
  }
  return response.json();
}
export async function listProjectDocuments(projectId: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<ProjectDocumentsResponse> {
  const value = await request(projectId, '?includeArchived=true', context, 'GET', undefined, signal) as ProjectDocumentsResponse;
  if (!value || !Array.isArray(value.documents) || !value.documents.every((item) => ProjectDocumentSchema.safeParse(item).success)
    || !(value.selectedDocumentId === null || typeof value.selectedDocumentId === 'string')
    || (value.pendingCreations !== undefined && (!Array.isArray(value.pendingCreations) || value.pendingCreations.some((item) => !item || typeof item.documentId !== 'string' || !CreateProjectDocumentRequestSchema.safeParse(item.request).success || item.requestId !== item.request.requestId)))) throw new ProjectDocumentsError(500, 'INVALID_RESPONSE');
  return value;
}
function changed(projectId: string, document: ProjectDocument) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PROJECT_DOCUMENTS_UPDATED_EVENT, { detail: { projectId, documentId: document.id } }));
  return document;
}
export async function createProjectDocument(projectId: string, input: CreateProjectDocumentRequest, context?: WorkspaceCollabContext | null): Promise<ProjectDocument> {
  const value = await request(projectId, '', context, 'POST', CreateProjectDocumentRequestSchema.parse(input)) as { document: unknown };
  return changed(projectId, ProjectDocumentSchema.parse(value.document));
}
export async function updateProjectDocument(projectId: string, documentId: string, input: UpdateProjectDocumentRequest, context?: WorkspaceCollabContext | null): Promise<ProjectDocument> {
  const value = await request(projectId, `/${encodeURIComponent(documentId)}`, context, 'PATCH', UpdateProjectDocumentRequestSchema.parse(input)) as { document: unknown };
  return changed(projectId, ProjectDocumentSchema.parse(value.document));
}
export async function openProjectDocument(projectId: string, documentId: string, context?: WorkspaceCollabContext | null): Promise<ProjectDocument> {
  const value = await request(projectId, `/${encodeURIComponent(documentId)}/open`, context, 'POST') as { document: unknown };
  return changed(projectId, ProjectDocumentSchema.parse(value.document));
}
export async function readProjectDocumentContext(projectId: string, documentId: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<ProjectDocumentContextResponse> {
  return await request(projectId, `/${encodeURIComponent(documentId)}/context`, context, 'GET', undefined, signal) as ProjectDocumentContextResponse;
}
