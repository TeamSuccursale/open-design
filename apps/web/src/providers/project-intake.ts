import type { IntakeAsset, RegisterIntakeVectorRequest, SetIntakeVectorPreferenceRequest, IntakeVectorProposal, IntakeVectorProposalRequest, ProjectIntakeCatalog, ProjectIntakeConfig, ProjectIntakeSettings, StartProjectIntakeRequest, WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
export const OPEN_PROJECT_GALLERY_EVENT = 'melillodesign:open-project-gallery';
/** Successful UI starts wake the chat observer without waiting for its idle refresh. */
export const PROJECT_INTAKE_UPDATED_EVENT = 'melillodesign:project-intake-updated';
/** A deliberate retry action; the consent owner retains configuration/start policy. */
export const PROJECT_INTAKE_RETRY_EVENT = 'melillodesign:retry-project-intake';
export async function updateIntakeVector(projectId: string, assetId: string, input: RegisterIntakeVectorRequest | SetIntakeVectorPreferenceRequest, context?: WorkspaceCollabContext | null): Promise<IntakeAsset> {
  const preference = 'versionId' in input;
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/intake/assets/${encodeURIComponent(assetId)}/${preference ? 'vector-preference' : 'vectors'}`, {
    method: preference ? 'PUT' : 'POST', headers: { 'content-type': 'application/json', ...(context ? workspaceProjectHeaders(context) : {}) }, body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `SVG update returned HTTP ${response.status}`);
  return body as IntakeAsset;
}
export async function proposeIntakeVector(projectId: string, assetId: string, input: IntakeVectorProposalRequest, context?: WorkspaceCollabContext | null): Promise<IntakeVectorProposal> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/intake/assets/${encodeURIComponent(assetId)}/vector-proposal`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(context ? workspaceProjectHeaders(context) : {}) }, body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `Vector proposal returned HTTP ${response.status}`);
  return body as IntakeVectorProposal;
}

export async function fetchProjectIntake(projectId: string, context?: WorkspaceCollabContext | null, request?: StartProjectIntakeRequest, signal?: AbortSignal): Promise<ProjectIntakeCatalog> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/intake`, {
    method: request ? 'POST' : 'GET', signal,
    headers: { ...(context ? workspaceProjectHeaders(context) : {}), ...(request ? { 'content-type': 'application/json' } : {}) },
    ...(request ? { body: JSON.stringify(request) } : {}),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `Intake returned HTTP ${response.status}`);
  if (request && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PROJECT_INTAKE_UPDATED_EVENT, { detail: { projectId } }));
  return body as ProjectIntakeCatalog;
}

export async function fetchIntakeSettings(projectId: string, context?: WorkspaceCollabContext | null, config?: ProjectIntakeConfig, signal?: AbortSignal): Promise<ProjectIntakeSettings> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/intake/settings`, {
    method: config ? 'PUT' : 'GET', signal,
    headers: { ...(context ? workspaceProjectHeaders(context) : {}), ...(config ? { 'content-type': 'application/json' } : {}) },
    ...(config ? { body: JSON.stringify(config) } : {}),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `Intake settings returned HTTP ${response.status}`);
  return body as ProjectIntakeSettings;
}
