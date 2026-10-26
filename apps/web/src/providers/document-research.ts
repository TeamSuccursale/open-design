import { DocumentResearchRunSchema, StartDocumentResearchSchema, type DocumentResearchFinding, type DocumentResearchRun, type StartDocumentResearch, type WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';

export class DocumentResearchUnavailableError extends Error {}
export class DocumentResearchNotReadyError extends Error {}

/** Host metadata remains available to agents, outside the human-facing findings. */
export function visibleResearchFindings(run: DocumentResearchRun, findings: DocumentResearchFinding[]): DocumentResearchFinding[] {
  const normalize = (value: string) => value.toLowerCase().replace(/\\+/g, '/');
  const privateTokens = run.sources.flatMap((source) => [source.id, source.sha256, source.root]).filter(Boolean).map(normalize);
  return findings.filter((finding) => run.sources.some((source) => source.id === finding.sourceId)
    && !privateTokens.some((token) => normalize(finding.text).includes(token)));
}

/** Show the first one or two findings per source, up to six in total. */
export function researchOverviewPreview(findings: DocumentResearchFinding[]): DocumentResearchFinding[] {
  const sources = new Map<string, DocumentResearchFinding[]>();
  for (const finding of findings) sources.set(finding.sourceId, [...(sources.get(finding.sourceId) ?? []), finding]);
  const preview: DocumentResearchFinding[] = [];
  for (const index of [0, 1]) for (const group of sources.values()) {
    if (group[index]) preview.push(group[index]!);
    if (preview.length === 6) return preview;
  }
  return preview;
}

/** Research is a persisted project job shared by the browser and od CLI. */
export async function documentResearchRequest(
  projectId: string,
  context?: WorkspaceCollabContext | null,
  input?: StartDocumentResearch,
  signal?: AbortSignal,
): Promise<DocumentResearchRun | null> {
  const request = input === undefined ? undefined : StartDocumentResearchSchema.parse(input);
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/document-research`, {
    method: request ? 'POST' : 'GET', cache: 'no-store', signal,
    headers: { ...(context ? workspaceProjectHeaders(context) : {}), ...(request ? { 'content-type': 'application/json' } : {}) },
    ...(request ? { body: JSON.stringify(request) } : {}),
  });
  // Older daemons do not expose this optional surface until their next restart.
  if (response.status === 404) throw new DocumentResearchUnavailableError('Document research is unavailable');
  const body = await response.json();
  if (response.status === 400 && body.error?.code === 'DOCUMENT_RESEARCH_FAILED'
    && body.error?.message === 'Run the project text intake before research') throw new DocumentResearchNotReadyError(body.error.message);
  if (!response.ok) throw new Error(body.error?.message ?? `Document research returned HTTP ${response.status}`);
  return DocumentResearchRunSchema.nullable().parse(body.research);
}
