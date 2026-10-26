import { ProjectHistoryCheckpointRequestSchema, ProjectHistoryCompareRequestSchema, ProjectHistoryRestoreRequestSchema, ProjectOrganizationRequestSchema,
  type ProjectHistoryCompareResponse, type ProjectHistoryEntry, type ProjectHistoryResponse, type ProjectHistoryRestoreResponse, type ProjectHistoryVersionResponse,
  type ProjectOrganizationReview, type WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import { invalidateProjectFilesCache } from './registry';

export class ProjectHistoryError extends Error {
  constructor(public readonly code: 'conflict' | 'agent-running' | 'background-running' | 'unavailable' | 'request-failed' | 'invalid-response' | 'invalid-request', public readonly status?: number) { super(code); }
}
export const PROJECT_HISTORY_UPDATED_EVENT = 'melillodesign:project-history-updated';
const validPath = (path: unknown): path is string => typeof path === 'string' && path.length > 0 && !/^(?:[a-z]+:|[\\/])/i.test(path) && !path.replace(/\\/g, '/').split('/').some((part) => !part || part === '..' || part === '.');
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validEntry = (entry: unknown): entry is ProjectHistoryEntry => record(entry) && typeof entry.id === 'string' && ['save', 'commit'].includes(String(entry.kind))
  && ['save', 'initial', 'work', 'idle', 'manual', 'before-restore', 'restore'].includes(String(entry.reason)) && typeof entry.createdAt === 'string' && Number.isFinite(Date.parse(entry.createdAt))
  && typeof entry.title === 'string' && typeof entry.summary === 'string' && nonnegative(entry.fileCount) && nonnegative(entry.totalBytes)
  && (entry.parentId === null || typeof entry.parentId === 'string') && Array.isArray(entry.changedPaths) && entry.changedPaths.every(validPath);
function validReview(review: unknown): review is ProjectOrganizationReview {
  return record(review) && typeof review.id === 'string' && ['ready', 'acknowledged'].includes(String(review.status)) && typeof review.summary === 'string'
    && Array.isArray(review.protectedPaths) && review.protectedPaths.every(validPath) && Array.isArray(review.limitations) && review.limitations.every((item) => typeof item === 'string')
    && Array.isArray(review.candidates) && review.candidates.every((candidate) => record(candidate) && validPath(candidate.path) && typeof candidate.reason === 'string'
      && ['keep', 'review', 'archive-candidate'].includes(String(candidate.suggestedAction)) && Array.isArray(candidate.referencedBy) && candidate.referencedBy.every(validPath));
}
async function request(projectId: string, suffix: string, context?: WorkspaceCollabContext | null, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/history${suffix}`, {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal,
    headers: { ...(context ? workspaceProjectHeaders(context) : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 409) {
    const body = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    throw new ProjectHistoryError(body?.error?.code === 'HISTORY_AGENT_RUNNING' ? 'agent-running' : body?.error?.code === 'HISTORY_BACKGROUND_RUNNING' ? 'background-running' : 'conflict', 409);
  }
  if (response.status === 404 || response.status === 503) throw new ProjectHistoryError('unavailable', response.status);
  if (!response.ok) throw new ProjectHistoryError('request-failed', response.status);
  try { return await response.json(); } catch { throw new ProjectHistoryError('invalid-response'); }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProjectHistoryError('invalid-response');
  return value as Record<string, unknown>;
}
export interface ProjectHistoryPageOptions { before?: string; limit?: number }
export async function readProjectHistory(projectId: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal, pagination: ProjectHistoryPageOptions = {}): Promise<ProjectHistoryResponse> {
  const limit = pagination.limit ?? 200;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || pagination.before !== undefined && !/^(?!\.{1,2}$)[\w.-]{1,128}$/.test(pagination.before)) throw new ProjectHistoryError('invalid-request');
  const query = new URLSearchParams({ limit: String(limit), ...(pagination.before ? { before: pagination.before } : {}) });
  const value = object(await request(projectId, `?${query}`, context, undefined, signal)), status = object(value.status);
  if (!['initializing', 'ready', 'error'].includes(String(status.state)) || !(status.revision === null || typeof status.revision === 'string') || typeof status.dirty !== 'boolean'
    || !nonnegative(status.activeWorkMs) || !nonnegative(status.organizationWorkMs) || !(status.organizationReview === null || validReview(status.organizationReview))
    || !Array.isArray(value.entries) || !value.entries.every(validEntry)
    || !(value.nextCursor === undefined || value.nextCursor === null || typeof value.nextCursor === 'string' && /^(?!\.{1,2}$)[\w.-]{1,128}$/.test(value.nextCursor)
      && value.entries.at(-1)?.id === value.nextCursor && value.nextCursor !== pagination.before)) throw new ProjectHistoryError('invalid-response');
  return value as unknown as ProjectHistoryResponse;
}
export async function readProjectHistoryVersion(projectId: string, entryId: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<ProjectHistoryVersionResponse> {
  if (!entryId || !/^(?!\.{1,2}$)[\w.-]+$/.test(entryId)) throw new ProjectHistoryError('invalid-request');
  const value = object(await request(projectId, `/entries/${encodeURIComponent(entryId)}`, context, undefined, signal));
  if (!validEntry(value.entry) || value.entry.id !== entryId || !Array.isArray(value.files) || !value.files.every((file) => record(file) && validPath(file.path) && nonnegative(file.size) && typeof file.hash === 'string')) throw new ProjectHistoryError('invalid-response');
  return value as unknown as ProjectHistoryVersionResponse;
}
export async function compareProjectHistory(projectId: string, input: { fromId: string; toId?: string; path?: string }, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<ProjectHistoryCompareResponse> {
  const parsed = ProjectHistoryCompareRequestSchema.safeParse(input);
  if (!parsed.success || parsed.data.path && !validPath(parsed.data.path)) throw new ProjectHistoryError('invalid-request');
  const value = object(await request(projectId, '/compare', context, parsed.data, signal));
  if (value.fromId !== parsed.data.fromId || value.toId !== (parsed.data.toId ?? null) || !Array.isArray(value.changes) || !value.changes.every((change) => record(change) && validPath(change.path)
    && ['added', 'modified', 'deleted'].includes(String(change.kind)) && typeof change.binary === 'boolean' && nonnegative(change.beforeSize) && nonnegative(change.afterSize)
    && (change.beforeText === undefined || typeof change.beforeText === 'string') && (change.afterText === undefined || typeof change.afterText === 'string'))) throw new ProjectHistoryError('invalid-response');
  return value as unknown as ProjectHistoryCompareResponse;
}
export async function restoreProjectHistory(projectId: string, input: { entryId: string; paths?: string[]; baseRevision: string }, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<ProjectHistoryRestoreResponse> {
  const parsed = ProjectHistoryRestoreRequestSchema.safeParse(input);
  if (!parsed.success || parsed.data.paths?.some((path) => !validPath(path))) throw new ProjectHistoryError('invalid-request');
  const value = object(await request(projectId, '/restore', context, parsed.data, signal));
  if (!validEntry(value.entry) || typeof value.safetyEntryId !== 'string' || !Array.isArray(value.restoredPaths) || !value.restoredPaths.every(validPath)) throw new ProjectHistoryError('invalid-response');
  invalidateProjectFilesCache(projectId, context);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PROJECT_HISTORY_UPDATED_EVENT, { detail: { projectId, restoredPaths: value.restoredPaths } }));
  return value as unknown as ProjectHistoryRestoreResponse;
}
export async function createProjectHistoryCheckpoint(projectId: string, input: { title?: string; summary?: string } = {}, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<{ entry: ProjectHistoryEntry | null }> {
  const value = object(await request(projectId, '/checkpoint', context, ProjectHistoryCheckpointRequestSchema.parse(input), signal));
  if (value.entry !== null && !validEntry(value.entry)) throw new ProjectHistoryError('invalid-response');
  return value as unknown as { entry: ProjectHistoryEntry | null };
}
export async function recordProjectHistoryActivity(projectId: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<void> {
  await request(projectId, '/activity', context, { kind: 'user' }, signal);
}
export async function reviewProjectOrganization(projectId: string, input: { action: 'review' | 'acknowledge'; reviewId?: string }, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<{ review: ProjectOrganizationReview | null }> {
  const value = object(await request(projectId, '/organization', context, ProjectOrganizationRequestSchema.parse(input), signal));
  if (value.review !== null) {
    if (!validReview(value.review)) throw new ProjectHistoryError('invalid-response');
  }
  return value as unknown as { review: ProjectOrganizationReview | null };
}
