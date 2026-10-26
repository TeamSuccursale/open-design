import { readFile } from 'node:fs/promises';
import { Agent, fetch } from 'undici';
import { ProjectHistoryCompareRequestSchema, ProjectHistoryRestoreRequestSchema, ProjectHistoryCheckpointRequestSchema, ProjectOrganizationRequestSchema } from '@open-design/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';

export interface ProjectHistoryCliIo { readInput?: (path: string) => Promise<string>; write?: (text: string) => void }
export async function handleProjectHistoryCli(args: string[], io: ProjectHistoryCliIo = {}): Promise<void> {
  const [action, ...rest] = args;
  const write = io.write ?? console.log;
  if (!action || ['help', '--help', '-h'].includes(action) || rest.includes('--help')) {
    write('od history <list|status|read|compare|restore|checkpoint|organization> --project <id> [--json] [--prompt-file <path|->] [--daemon-url URL]\nlist [--limit 1..200] [--before <entry-id>] follows nextCursor to older saved versions. read --version <id>; compare --from <id> [--to <id>] [--path <file>]; restore --version <id> --base-revision <id> [--paths <comma-separated paths>]. JSON input supports exact paths and long title/summary text. checkpoint [--title <text>] [--summary <text>]; organization --action review|acknowledge [--review-id <id>]. Restore requires the current revision and waits for active agents and background preparation to finish.'); return;
  }
  if (!['list', 'status', 'read', 'compare', 'restore', 'checkpoint', 'organization'].includes(action)) throw new Error('Unknown history command');
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i]!;
    if (key === '--json') { flags.set(key, 'true'); continue; }
    if (!['--project', '--daemon-url', '--prompt-file', '--version', '--from', '--to', '--path', '--base-revision', '--paths', '--title', '--summary', '--action', '--review-id', '--limit', '--before'].includes(key) || !rest[i + 1] || rest[i + 1]!.startsWith('--')) throw new Error(`Invalid history option: ${key}`);
    flags.set(key, rest[++i]!);
  }
  const project = flags.get('--project'); if (!project) throw new Error('--project is required');
  let input: Record<string, unknown> = {};
  const file = flags.get('--prompt-file');
  if (file) {
    let content = '';
    if (io.readInput) content = await io.readInput(file);
    else if (file === '-') { for await (const chunk of process.stdin) content += String(chunk); }
    else content = await readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON input object');
    input = parsed as Record<string, unknown>;
  }
  let body: unknown, suffix = '', method = 'GET';
  const required = (value: unknown, name: string): string => { if (typeof value !== 'string' || !value) throw new Error(`${name} is required`); return value; };
  if (action === 'read') suffix = `/entries/${encodeURIComponent(required(flags.get('--version') ?? input.entryId, '--version'))}`;
  else if (action === 'compare') { method = 'POST'; suffix = '/compare'; body = ProjectHistoryCompareRequestSchema.strict().parse({ ...input, ...(flags.has('--from') ? { fromId: flags.get('--from') } : {}), ...(flags.has('--to') ? { toId: flags.get('--to') } : {}), ...(flags.has('--path') ? { path: flags.get('--path') } : {}) }); }
  else if (action === 'restore') { method = 'POST'; suffix = '/restore'; body = ProjectHistoryRestoreRequestSchema.strict().parse({ ...input, ...(flags.has('--version') ? { entryId: flags.get('--version') } : {}), ...(flags.has('--base-revision') ? { baseRevision: flags.get('--base-revision') } : {}), ...(flags.has('--paths') ? { paths: flags.get('--paths')!.split(',') } : {}) }); }
  else if (action === 'checkpoint') { method = 'POST'; suffix = '/checkpoint'; body = ProjectHistoryCheckpointRequestSchema.strict().parse({ ...input, ...(flags.has('--title') ? { title: flags.get('--title') } : {}), ...(flags.has('--summary') ? { summary: flags.get('--summary') } : {}) }); }
  else if (action === 'organization') { method = 'POST'; suffix = '/organization'; body = ProjectOrganizationRequestSchema.strict().parse({ ...input, ...(flags.has('--action') ? { action: flags.get('--action') } : {}), ...(flags.has('--review-id') ? { reviewId: flags.get('--review-id') } : {}) }); }
  else {
    const query = new URLSearchParams();
    if (flags.has('--limit')) { const limit = Number(flags.get('--limit')); if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('--limit must be between 1 and 200'); query.set('limit', String(limit)); }
    if (flags.has('--before')) query.set('before', ProjectHistoryRestoreRequestSchema.shape.entryId.parse(flags.get('--before')));
    if (query.size) suffix = `?${query}`;
  }
  const workspaceId = process.env.OD_WORKSPACE_ID?.trim(), memberId = process.env.OD_WORKSPACE_MEMBER_ID?.trim();
  if (Boolean(workspaceId) !== Boolean(memberId)) throw new Error('The run workspace identity is incomplete');
  const base = await resolveDaemonUrl({ flagUrl: flags.get('--daemon-url') ?? null });
  const dispatcher = new Agent();
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/api/projects/${encodeURIComponent(project)}/history${suffix}`, { method, dispatcher, headers: { ...(workspaceId && memberId ? { 'x-od-workspace-id': workspaceId, 'x-od-workspace-member-id': memberId } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as { error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? `History returned HTTP ${response.status}`);
    write(JSON.stringify(result, null, flags.has('--json') ? undefined : 2));
  } finally { await dispatcher.close(); }
}
