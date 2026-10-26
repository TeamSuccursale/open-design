import { readFile } from 'node:fs/promises';
import { Agent, fetch } from 'undici';
import { StartDocumentOverviewReadingSchema, type DocumentOverviewReadingResponse } from '@open-design/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';

/** CLI and browser use the same persisted background-reading jobs. */
export async function runDocumentOverviewReadingCli(args: string[]): Promise<void> {
  const [action, ...rest] = args;
  if (!action || ['help', '--help', '-h'].includes(action) || rest.includes('--help')) {
    console.log('od document-overview-reading <show|start|retry> --project <id> [--prompt-file <path|->] [--json] [--daemon-url URL]\nstart/retry optionally accept a JSON object containing retry. Only saved quick-scan excerpts are analysed; no image extraction or source editing.'); return;
  }
  if (!['show', 'start', 'retry'].includes(action)) throw new Error('Unknown document-overview-reading command');
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index]!;
    if (key === '--json') { flags.set(key, 'true'); continue; }
    if (!['--project', '--prompt-file', '--daemon-url'].includes(key) || !rest[index + 1] || rest[index + 1]!.startsWith('--')) throw new Error(`Invalid document-overview-reading option: ${key}`);
    flags.set(key, rest[++index]!);
  }
  const project = flags.get('--project'); if (!project) throw new Error('--project is required');
  const file = flags.get('--prompt-file');
  if (file && action === 'show') throw new Error('--prompt-file applies to start or retry');
  let input: unknown = {};
  if (file) {
    let text = '';
    if (file === '-') { for await (const chunk of process.stdin) text += String(chunk); }
    else text = await readFile(file, 'utf8');
    input = JSON.parse(text);
  }
  const request = StartDocumentOverviewReadingSchema.parse(input);
  if (action === 'retry') request.retry = true;
  const base = await resolveDaemonUrl({ flagUrl: flags.get('--daemon-url') ?? null });
  const url = `${base.replace(/\/$/, '')}/api/projects/${encodeURIComponent(project)}/document-overview-reading`;
  const dispatcher = new Agent();
  try {
    const response = await fetch(url, Object.assign({ method: action === 'show' ? 'GET' : 'POST',
      ...(action === 'show' ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }) }, { dispatcher }));
    const result = await response.json() as DocumentOverviewReadingResponse & { error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? `Document overview reading returned HTTP ${response.status}`);
    console.log(JSON.stringify(result, null, flags.has('--json') ? undefined : 2));
  } finally { await dispatcher.close(); }
}
