import { readFile } from 'node:fs/promises';
import { Agent, fetch } from 'undici';
import type { DocumentSetupResponse } from '@open-design/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';

/** UI and CLI share the same persisted setup, confirmation and scan endpoints. */
export async function runDocumentSetupCli(args: string[]): Promise<void> {
  const [action, ...rest] = args;
  if (!action || ['help', '--help', '-h'].includes(action) || rest.includes('--help')) {
    console.log([
      'od document-setup <show|set|scan|confirm|references|set-references> --project <id> [--prompt-file <path|->] [--json] [--daemon-url URL]',
      'set accepts partial DocumentSetupIntent fields; set-references accepts {projectIds:[...]}. Text scans do not start image extraction.',
      'confirm accepts {purpose,constraints,blockoutApproach:"manual"|"agent",pageTarget?:positiveInteger,editorialSettings:[{documentId,presentation,constraints?,pageTarget?}]}.',
      'confirm also accepts {source:"saved-brief",blockoutApproach:"manual"|"agent"}: it confirms exactly the brief saved with set (purpose, and each output’s editorialSettings with its own constraints and pageTarget) and fails, writing nothing, when any of those is missing. The app uses it when the engineer accepts the final confirmation form.',
      'Each named output needs its own explicit confirmed presentation: name, header/footer/cover/pageNumbers yes/no. If cover is yes, choose coverCountsTowardPageLimit separately; if numbering is yes too, also choose numberOnCover and coverCountsInNumbering. Unanswered choices stay null in draft. Keep report and graphics constraints/pageTarget separate.',
      'Constraint: {id,kind:"page-limit"|"paper"|"orientation"|"typography"|"margins"|"template"|"other",value,status:"confirmed",sourceIds:string[]}. Copy actual source IDs from scan/show; [] denotes an engineer decision.',
      'pageTarget is the engineer’s chosen count, separate from the source allowance: it may be below a maximum, must match an exact count, and becomes flexible when there is no source allowance. Without it, tender projects default to the full maximum.',
      'Example confirmation JSON (replace the illustrative source ID with the actual scan/show ID):',
      JSON.stringify({ purpose: 'Graphical sheets', constraints: [
        { id: 'page-cap', kind: 'page-limit', value: 'Massimo 4 pagine', status: 'confirmed', sourceIds: ['source-id-from-scan'] },
        { id: 'paper', kind: 'paper', value: 'A3', status: 'confirmed', sourceIds: ['source-id-from-scan'] },
        { id: 'orientation', kind: 'orientation', value: 'orizzontale', status: 'confirmed', sourceIds: [] },
      ], blockoutApproach: 'manual', pageTarget: 3, editorialSettings: [{ documentId: 'graphical-sheets', presentation: { version: 1, status: 'confirmed', name: 'Graphical sheets', header: false, footer: false, cover: false, pageNumbers: true, numberOnCover: null, coverCountsTowardPageLimit: null, coverCountsInNumbering: null, numberingStart: 1 } }] }, null, 2),
    ].join('\n'));
    return;
  }
  if (!['show', 'set', 'scan', 'confirm', 'references', 'set-references'].includes(action)) throw new Error('Unknown document-setup command');
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index]!;
    if (key === '--json') { flags.set(key, 'true'); continue; }
    if (!['--project', '--prompt-file', '--daemon-url'].includes(key) || !rest[index + 1] || rest[index + 1]!.startsWith('--')) throw new Error(`Invalid document-setup option: ${key}`);
    flags.set(key, rest[++index]!);
  }
  const project = flags.get('--project'); if (!project) throw new Error('--project is required');
  const needsInput = action === 'set' || action === 'confirm' || action === 'set-references';
  const file = flags.get('--prompt-file');
  if (needsInput && !file) throw new Error('--prompt-file <path|-> is required');
  if (!needsInput && file) throw new Error('--prompt-file applies to set and confirm');
  let input: unknown;
  if (file) {
    let text = '';
    if (file === '-') { for await (const chunk of process.stdin) text += String(chunk); }
    else text = await readFile(file, 'utf8');
    input = JSON.parse(text);
  }
  const base = await resolveDaemonUrl({ flagUrl: flags.get('--daemon-url') ?? null });
  const url = `${base.replace(/\/$/, '')}/api/projects/${encodeURIComponent(project)}/document-setup${['references', 'set-references'].includes(action) ? '/references' : action === 'scan' ? '/context-scan' : action === 'confirm' ? '/confirm' : ''}`;
  const dispatcher = new Agent();
  try {
    const reading = action === 'show' || action === 'references';
    const workspaceId = process.env.OD_WORKSPACE_ID?.trim() ?? '', memberId = process.env.OD_WORKSPACE_MEMBER_ID?.trim() ?? '';
    if (Boolean(workspaceId) !== Boolean(memberId)) throw new Error('The run workspace identity is incomplete; do not substitute another workspace or member');
    const headers: Record<string, string> = {
      ...(workspaceId && memberId ? { 'x-od-workspace-id': workspaceId, 'x-od-workspace-member-id': memberId } : {}),
      ...(!reading ? { 'content-type': 'application/json' } : {}),
    };
    const response = await fetch(url, Object.assign({ method: reading ? 'GET' : action === 'set' || action === 'set-references' ? 'PUT' : 'POST',
      headers, ...(reading ? {} : { body: JSON.stringify(input ?? {}) }) }, { dispatcher }));
    const result = await response.json() as DocumentSetupResponse & { error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? `Document setup returned HTTP ${response.status}`);
    console.log(JSON.stringify(result, null, flags.has('--json') ? undefined : 2));
  } finally { await dispatcher.close(); }
}
