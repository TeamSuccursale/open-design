import { DocumentOverviewReadingSchema, type DocumentOverviewReading, type WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';

export async function fetchDocumentOverviewReading(projectId: string, context?: WorkspaceCollabContext | null,
  start?: { retry?: boolean }, signal?: AbortSignal): Promise<DocumentOverviewReading | null> {
  const headers = new Headers(context ? workspaceProjectHeaders(context) : {});
  if (start) headers.set('content-type', 'application/json');
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/document-overview-reading`, {
    method: start ? 'POST' : 'GET', cache: 'no-store', headers, signal,
    ...(start ? { body: JSON.stringify(start) } : {}),
  });
  if (!response.ok) throw new Error('blockout.readingFailed');
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('reading' in body)) throw new Error('blockout.readingFailed');
  return body.reading === null ? null : DocumentOverviewReadingSchema.parse(body.reading);
}
