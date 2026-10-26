import { DocumentSetupSchema, type DocumentSetup, type DocumentSetupIntent, type DocumentSetupConfirmation, type WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';

export const DOCUMENT_PREPARATION_RESUME_EVENT = 'melillodesign:document-preparation-resume';

export async function documentSetupRequest(projectId: string, context?: WorkspaceCollabContext | null, operation?: 'scan' | 'confirm' | 'intent', input?: Partial<DocumentSetupIntent> | DocumentSetupConfirmation, signal?: AbortSignal): Promise<DocumentSetup | null> {
  const suffix = operation === 'scan' ? '/context-scan' : operation === 'confirm' ? '/confirm' : '';
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/document-setup${suffix}`, {
    method: operation === 'intent' ? 'PUT' : operation ? 'POST' : 'GET', signal, cache: 'no-store',
    headers: { ...(context ? workspaceProjectHeaders(context) : {}), ...(operation ? { 'content-type': 'application/json' } : {}) },
    ...(operation ? { body: JSON.stringify(input ?? {}) } : {}),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? 'documentStart.loadFailed');
  return body.setup ? DocumentSetupSchema.parse(body.setup) : null;
}
