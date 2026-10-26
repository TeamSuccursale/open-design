import { readFile } from 'node:fs/promises';
import { Agent, fetch } from 'undici';
import { StartDocumentResearchSchema, type DocumentResearchResponse } from '@open-design/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';

/** CLI jobs use the same HTTP service and explicit coverage as the browser. */
export async function runDocumentResearchCli(args: string[]): Promise<void> {
  const [action, ...rest] = args;
  if (!action || ['help', '--help', '-h'].includes(action) || rest.includes('--help')) {
    console.log('od document-research <show|start|retry> --project <id> [--prompt-file <path|->] [--json] [--daemon-url URL]\nstart/retry accept JSON {sourcePaths?:string[],question?:string,retry?:boolean}. sourcePaths select relative paths already declared in the project text documents. A quick overview is saved before analysis of every selected native-text page. Completion applies to selected text sources; unreadable, pending and visually unreviewed pages remain explicit.');
    return;
  }
  if (!['show', 'start', 'retry'].includes(action)) throw new Error('Unknown document-research command');
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index]!;
    if (key === '--json') { flags.set(key, 'true'); continue; }
    if (!['--project', '--prompt-file', '--daemon-url'].includes(key) || !rest[index + 1] || rest[index + 1]!.startsWith('--')) throw new Error(`Invalid document-research option: ${key}`);
    flags.set(key, rest[++index]!);
  }
  const project = flags.get('--project');
  if (!project) throw new Error('--project is required');
  const file = flags.get('--prompt-file');
  if (file && action === 'show') throw new Error('--prompt-file applies to start or retry');
  let input: unknown = {};
  if (file) {
    let content = '';
    if (file === '-') { for await (const chunk of process.stdin) content += String(chunk); }
    else content = await readFile(file, 'utf8');
    input = JSON.parse(content);
  }
  const request = StartDocumentResearchSchema.parse(input);
  if (action === 'retry') request.retry = true;
  const base = await resolveDaemonUrl({ flagUrl: flags.get('--daemon-url') ?? null });
  const url = `${base.replace(/\/$/, '')}/api/projects/${encodeURIComponent(project)}/document-research`;
  const dispatcher = new Agent();
  try {
    const response = await fetch(url, Object.assign({
      method: action === 'show' ? 'GET' : 'POST',
      ...(action === 'show' ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }),
    }, { dispatcher }));
    const result = await response.json() as DocumentResearchResponse & { error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? `Document research returned HTTP ${response.status}`);
    console.log(JSON.stringify(result, null, flags.has('--json') ? undefined : 2));
  } finally { await dispatcher.close(); }
}
