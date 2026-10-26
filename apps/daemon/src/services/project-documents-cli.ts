import { readFile } from 'node:fs/promises';
import { Agent, fetch } from 'undici';
import { CreateProjectDocumentRequestSchema, ProjectDocumentIdSchema, UpdateProjectDocumentRequestSchema } from '@open-design/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';

export interface ProjectDocumentsCliIo { readInput?: (path: string) => Promise<string>; write?: (value: string) => void }
/** The CLI uses the same owned-document HTTP API as the browser. Reuse --request-id when retrying a create. */
export async function runProjectDocumentsCli(args: string[], io: ProjectDocumentsCliIo = {}): Promise<void> {
  const [action, ...rest] = args, write = io.write ?? console.log;
  if (!action || ['help', '--help', '-h'].includes(action) || rest.includes('--help')) { write('od documents <list|create|read|open|update|rename|link|archive|unarchive|select|context> --project <id> [--document <id>] [--json] [--prompt-file <path|->]\ncreate --name <name> [--request-id <uuid>] [--kind document|design] [--type report|tender-offer|tender-form|other|free] [--subtype <text>]; --folder links an existing explicitly selected folder. open --document <id> selects an exclusive editing chat, preserving the original preparation history. link --document <id> --folder <absolute folder> changes only the association. rename --document <id> --name <text>; archive/unarchive preserve the folder and files. context --document <id> [--path <relative file>] resolves one registered document only. --include-archived shows recoverable associations; --conversation associates an owned chat. --prompt-file accepts a JSON request with presentation and long text.'); return; }
  if (!['list', 'create', 'read', 'update', 'rename', 'link', 'archive', 'unarchive', 'select', 'context', 'open'].includes(action)) throw new Error('Unknown documents command');
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index]!;
    if (['--json', '--include-archived', '--select', '--no-select'].includes(flag)) { flags.set(flag, 'true'); continue; }
    if (!['--project', '--document', '--name', '--kind', '--folder', '--type', '--subtype', '--conversation', '--path', '--request-id', '--prompt-file', '--daemon-url'].includes(flag) || !rest[index + 1] || rest[index + 1]!.startsWith('--')) throw new Error(`Invalid documents option: ${flag}`);
    flags.set(flag, rest[++index]!);
  }
  const project = flags.get('--project'); if (!project) throw new Error('--project is required');
  let input: Record<string, unknown> = {};
  const promptFile = flags.get('--prompt-file');
  if (promptFile) {
    let content = '';
    if (io.readInput) content = await io.readInput(promptFile);
    else if (promptFile === '-') { for await (const chunk of process.stdin) content += String(chunk); }
    else content = await readFile(promptFile, 'utf8');
    const parsed: unknown = JSON.parse(content); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a document request JSON object'); input = parsed as Record<string, unknown>;
  }
  const documentValue = flags.get('--document') ?? input.documentId;
  const documentId = documentValue === undefined ? undefined : ProjectDocumentIdSchema.parse(documentValue);
  delete input.documentId;
  const folder = flags.get('--folder');
  const payload = { ...input, ...(flags.has('--name') ? { name: flags.get('--name') } : {}), ...(flags.has('--kind') ? { kind: flags.get('--kind') } : {}), ...(folder ? { location: { mode: 'link-existing', path: folder, authorized: true } } : {}), ...(flags.has('--conversation') ? { conversationId: flags.get('--conversation') } : {}), ...(flags.has('--type') ? { documentType: { kind: flags.get('--type'), subtype: flags.get('--subtype') ?? '' } } : {}), ...(flags.has('--select') ? { select: true } : {}), ...(flags.has('--no-select') ? { select: false } : {}) };
  let method = 'GET', suffix = '', body: unknown;
  if (flags.has('--request-id')) Object.assign(payload, { requestId: flags.get('--request-id') });
  if (action === 'list') { if (flags.has('--include-archived')) suffix = '?includeArchived=true'; }
  else if (action === 'create' || (action === 'link' && !documentId)) { method = 'POST'; body = CreateProjectDocumentRequestSchema.parse({ kind: 'document', ...payload }); }
  else {
    if (!documentId) throw new Error('--document is required'); suffix = `/${encodeURIComponent(documentId)}`;
    if (action === 'open') { method = 'POST'; suffix += '/open'; body = {}; }
    else if (action === 'context') { suffix += '/context'; const file = flags.get('--path') ?? input.path; if (file !== undefined) { if (typeof file !== 'string') throw new Error('--path must be a relative file'); suffix += `?path=${encodeURIComponent(file)}`; } }
    else if (action !== 'read') { method = 'PATCH'; body = UpdateProjectDocumentRequestSchema.parse({ ...payload, ...(action === 'archive' ? { archived: true } : action === 'unarchive' ? { archived: false } : action === 'select' ? { select: true } : {}) }); }
  }
  const workspaceId = process.env.OD_WORKSPACE_ID?.trim(), memberId = process.env.OD_WORKSPACE_MEMBER_ID?.trim();
  if (Boolean(workspaceId) !== Boolean(memberId)) throw new Error('The run workspace identity is incomplete');
  const base = await resolveDaemonUrl({ flagUrl: flags.get('--daemon-url') ?? null }), dispatcher = new Agent();
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/api/projects/${encodeURIComponent(project)}/documents${suffix}`, { method, dispatcher, headers: { ...(workspaceId && memberId ? { 'x-od-workspace-id': workspaceId, 'x-od-workspace-member-id': memberId } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as { error?: { message?: string } }; if (!response.ok) throw new Error(result.error?.message ?? `Documents returned HTTP ${response.status}`);
    write(JSON.stringify(result, null, flags.has('--json') ? undefined : 2));
  } finally { await dispatcher.close(); }
}
