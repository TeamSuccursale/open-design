import { z } from 'zod';

export const PROJECT_HISTORY_POLICY = { workCommitMs: 45 * 60_000, idleCommitMs: 10 * 60_000, workReviewMs: 2 * 60 * 60_000, idleReviewMs: 30 * 60_000 } as const;
export type ProjectHistoryReason = 'save' | 'initial' | 'work' | 'idle' | 'manual' | 'before-restore' | 'restore';
export interface ProjectHistoryEntry {
  id: string; kind: 'save' | 'commit'; reason: ProjectHistoryReason; createdAt: string;
  title: string; summary: string; changedPaths: string[]; fileCount: number; totalBytes: number;
  parentId: string | null; gitCommit?: string;
}
export interface ProjectHistoryFile { path: string; hash: string; size: number }
export interface ProjectOrganizationCandidate { path: string; reason: string; suggestedAction: 'keep' | 'review' | 'archive-candidate'; referencedBy: string[] }
export interface ProjectOrganizationReview {
  id: string; createdAt: string; reason: 'work' | 'idle' | 'manual'; status: 'ready' | 'acknowledged';
  summary: string; fileCount: number; totalBytes: number; candidates: ProjectOrganizationCandidate[];
  protectedPaths: string[]; limitations: string[];
}
export interface ProjectHistoryStatus {
  state: 'initializing' | 'ready' | 'error'; revision: string | null; dirty: boolean;
  activeWorkMs: number; organizationWorkMs: number; lastActivityAt: string | null;
  lastCommitAt: string | null; error?: string; organizationReview: ProjectOrganizationReview | null;
  excluded: string[];
}
export interface ProjectHistoryResponse {
  status: ProjectHistoryStatus; entries: ProjectHistoryEntry[];
  /** Exclusive cursor for the next older page. Missing is accepted from older runtimes; null means exhausted. */
  nextCursor?: string | null;
}
export interface ProjectHistoryVersionResponse { entry: ProjectHistoryEntry; files: ProjectHistoryFile[] }
export interface ProjectHistoryChange { path: string; kind: 'added' | 'modified' | 'deleted'; binary: boolean; beforeSize: number; afterSize: number; beforeText?: string; afterText?: string; truncated?: boolean }
export interface ProjectHistoryCompareResponse { fromId: string; toId: string | null; changes: ProjectHistoryChange[] }
const id = z.string().min(1).max(128).regex(/^[\w.-]+$/).refine((value) => !['.', '..'].includes(value));
export const ProjectHistoryCompareRequestSchema = z.object({ fromId: id, toId: id.optional(), path: z.string().min(1).max(1024).optional() });
export const ProjectHistoryRestoreRequestSchema = z.object({ entryId: id, paths: z.array(z.string().min(1).max(1024)).min(1).max(10_000).optional(), baseRevision: id });
export const ProjectHistoryCheckpointRequestSchema = z.object({ title: z.string().trim().max(240).optional(), summary: z.string().trim().max(12_000).optional() });
export const ProjectHistoryActivityRequestSchema = z.object({ kind: z.enum(['user', 'agent-start', 'agent-end', 'save']), summary: z.string().max(12_000).optional() });
export const ProjectOrganizationRequestSchema = z.object({ action: z.enum(['review', 'acknowledge']), reviewId: id.optional() });
export interface ProjectHistoryRestoreResponse { entry: ProjectHistoryEntry; restoredPaths: string[]; safetyEntryId: string }
