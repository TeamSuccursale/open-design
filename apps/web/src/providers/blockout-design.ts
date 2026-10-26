import { BlockoutDesignStateSchema, type BlockoutDesignUnderlay, type WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import { registeredWorkspace } from './blockout';

export async function loadBlockoutDesign(projectId: string, documentId: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal) {
  const owner = await registeredWorkspace(projectId, documentId, context, signal) ?? projectId;
  const response = await fetch(`/api/projects/${encodeURIComponent(owner)}/blockout-documents/${encodeURIComponent(documentId)}/design`, { cache: 'no-store', signal, headers: context ? workspaceProjectHeaders(context) : {} });
  if (!response.ok) throw new Error('blockout.designLoadFailed');
  const state = BlockoutDesignStateSchema.parse(await response.json());
  if (state.documentId !== documentId) throw new Error('blockout.invalidDocument');
  return { state, projectId: owner };
}
export async function loadBlockoutDesignUnderlay(projectId: string, documentId: string, pageId: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<BlockoutDesignUnderlay> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/blockout-documents/${encodeURIComponent(documentId)}/design/pages/${encodeURIComponent(pageId)}`, { cache: 'no-store', signal, headers: context ? workspaceProjectHeaders(context) : {} });
  if (!response.ok) throw new Error('blockout.underlayUnavailable');
  const result = await response.json() as BlockoutDesignUnderlay;
  if (result.pageId !== pageId || typeof result.html !== 'string' || typeof result.revisionId !== 'string' || !result.filePath || !(result.widthPx > 0) || !(result.heightPx > 0)) throw new Error('blockout.invalidDocument');
  return result;
}
