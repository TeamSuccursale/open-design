import {
  DocumentProjectReferencesRequestSchema,
  DocumentProjectReferencesResponseSchema,
  type DocumentProjectContext,
  type DocumentSetup,
  type WorkspaceCollabContext,
} from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import { documentSetupRequest } from './document-setup';

export const DOCUMENT_CONTEXT_UPDATED_EVENT = 'melillodesign:document-context-updated';
export interface DocumentContextUpdatedDetail {
  projectId: string;
  source: 'references' | 'scan';
  setup?: DocumentSetup | null;
}

function notifyContextUpdated(detail: DocumentContextUpdatedDetail) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DOCUMENT_CONTEXT_UPDATED_EVENT, { detail }));
}

/** Reference IDs are resolved and authorized by the daemon; folders never come from the picker. */
export async function projectContextReferences(
  projectId: string,
  context?: WorkspaceCollabContext | null,
  projectIds?: string[],
  signal?: AbortSignal,
): Promise<DocumentProjectContext[]> {
  const input = projectIds === undefined ? undefined : DocumentProjectReferencesRequestSchema.parse({ projectIds });
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/document-setup/references`, {
    method: input ? 'PUT' : 'GET', cache: 'no-store', signal,
    headers: { ...(context ? workspaceProjectHeaders(context) : {}), ...(input ? { 'content-type': 'application/json' } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? 'documentContext.loadFailed');
  const { references } = DocumentProjectReferencesResponseSchema.parse(body);
  if (input) notifyContextUpdated({ projectId, source: 'references' });
  return references;
}

export async function checkProjectContext(projectId: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<DocumentSetup | null> {
  const setup = await documentSetupRequest(projectId, context, 'scan', undefined, signal);
  notifyContextUpdated({ projectId, source: 'scan', setup });
  return setup;
}
