import { AskProjectCustodianSchema, ProjectCustodianActivityResponseSchema, ProjectCustodianAnswerResponseSchema,
  ProjectCustodianHistoryResponseSchema, ProjectCustodianLedgerResponseSchema,
  type AskProjectCustodian, type WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';

export class ProjectCustodiansUnavailableError extends Error {}

async function request(projectId: string, suffix: string, context?: WorkspaceCollabContext | null, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/custodians${suffix}`, {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal,
    headers: { ...(context ? workspaceProjectHeaders(context) : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 404 || response.status === 503) throw new ProjectCustodiansUnavailableError('Project custodians are unavailable');
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? `Project custodian returned HTTP ${response.status}`);
  return value;
}

export async function readProjectCustodians(projectId: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal) {
  return ProjectCustodianLedgerResponseSchema.parse(await request(projectId, '', context, undefined, signal));
}
export async function readCustodianHistory(projectId: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal) {
  return ProjectCustodianHistoryResponseSchema.parse(await request(projectId, '/history?limit=10', context, undefined, signal)).history;
}
export async function pulseProjectCustodians(projectId: string, active: boolean, context?: WorkspaceCollabContext | null, signal?: AbortSignal) {
  return ProjectCustodianActivityResponseSchema.parse(await request(projectId, '/activity', context, { active }, signal)).indexing;
}
export async function askProjectCustodian(projectId: string, input: AskProjectCustodian, context?: WorkspaceCollabContext | null, signal?: AbortSignal) {
  return ProjectCustodianAnswerResponseSchema.parse(await request(projectId, '/ask', context, AskProjectCustodianSchema.parse(input), signal)).result;
}

/** Display human evidence, while keeping host locators and index revisions private. */
export function custodianDisplayText(value: string, ledger: { snapshotRevision: string; sources: readonly { sourceId: string; sha256?: string | undefined }[] }, replacement: string): string {
  let display = value;
  const tokens = [ledger.snapshotRevision, ...ledger.sources.flatMap((source) => [source.sourceId, source.sha256])]
    .filter((token): token is string => !!token && token.length > 3).sort((a, b) => b.length - a.length);
  for (const token of tokens) display = display.split(token).join(replacement);
  return display.replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s"<>]+/g, replacement)
    .replace(/\b[a-f0-9]{64}\b/gi, replacement)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, replacement);
}
