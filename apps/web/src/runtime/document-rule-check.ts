import type { DocumentRuleCheck, DocumentRuleCheckRequest, DocumentRuleCheckResponse, WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';

/** `no-browser`: this PC has no Chrome or Edge to measure with. `detail` is the daemon's technical text, for logs only. */
export type DocumentRuleCheckResult =
  | { ok: true; check: DocumentRuleCheck | null }
  | { ok: false; reason: 'no-browser' | 'failed'; detail: string };

/**
 * Asks the daemon to measure a designed document against its saved rules (the same request `od export check` makes).
 * Any failure comes back as a reason the dialog words for the engineer; the caller never waits on it to export.
 */
export async function checkDocumentRules(opts: {
  projectId: string;
  fileName: string;
  versionId?: string;
  workspaceContext?: WorkspaceCollabContext | null;
}): Promise<DocumentRuleCheckResult> {
  const body: DocumentRuleCheckRequest = { fileName: opts.fileName, ...(opts.versionId ? { versionId: opts.versionId } : {}) };
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(opts.projectId)}/export/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(opts.workspaceContext ? workspaceProjectHeaders(opts.workspaceContext) : {}) },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const failure = await resp.json().catch(() => null) as { error?: { message?: unknown } } | null;
      const detail = typeof failure?.error?.message === 'string' ? failure.error.message : `HTTP ${resp.status}`;
      return { ok: false, reason: resp.status === 503 ? 'no-browser' : 'failed', detail };
    }
    const { check } = await resp.json() as DocumentRuleCheckResponse;
    return { ok: true, check };
  } catch (error) {
    return { ok: false, reason: 'failed', detail: error instanceof Error ? error.message : String(error) };
  }
}
