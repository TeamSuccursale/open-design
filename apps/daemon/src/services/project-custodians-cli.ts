import { readFile } from 'node:fs/promises';
import { Agent, fetch } from 'undici';
import { AskProjectCustodianSchema } from '@open-design/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';

/** Plain text questions (not JSON) support long prompts and stdin. */
export async function runProjectCustodiansCli(args: string[]): Promise<void> {
  const [action, ...rest] = args;
  if (!action || ['help', '--help', '-h'].includes(action) || rest.includes('--help')) {
    console.log('od custodian <show|ask|history|activity> --project ID [--domain text|images --prompt-file path|-] [--limit N] [--active true|false] [--json] [--daemon-url URL]\nask reads a plain text question from --prompt-file (or stdin with -). show reads the ordered source ledger; history reads the journal; activity refreshes or ends the active-project indexing lease.');
    return;
  }
  if (!['show', 'ask', 'history', 'activity'].includes(action)) throw new Error('Unknown custodian command');
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index]!;
    if (flags.has(key)) throw new Error(`Duplicate custodian option: ${key}`);
    if (key === '--json') { flags.set(key, 'true'); continue; }
    if (!['--project', '--domain', '--prompt-file', '--daemon-url', '--limit', '--active'].includes(key)
      || !rest[index + 1] || rest[index + 1]!.startsWith('--')) throw new Error(`Invalid custodian option: ${key}`);
    flags.set(key, rest[++index]!);
  }
  const project = flags.get('--project');
  if (!project) throw new Error('--project is required');
  if (action !== 'ask' && (flags.has('--prompt-file') || flags.has('--domain'))) throw new Error('--prompt-file and --domain apply only to ask');
  if (action !== 'activity' && flags.has('--active')) throw new Error('--active applies only to activity');
  if (['show', 'activity'].includes(action) && flags.has('--limit')) throw new Error('--limit applies only to ask/history');
  let body: unknown;
  if (action === 'ask') {
    const file = flags.get('--prompt-file');
    if (!file) throw new Error('ask requires --prompt-file path|-');
    let question = '';
    if (file === '-') {
      for await (const chunk of process.stdin) { question += String(chunk); if (question.length > 12_000) throw new Error('Question exceeds 12000 characters'); }
    } else {
      question = await readFile(file, 'utf8');
    }
    body = AskProjectCustodianSchema.parse({ domain: flags.get('--domain'), question,
      ...(flags.has('--limit') ? { limit: Number(flags.get('--limit')) } : {}) });
  } else if (action === 'activity') {
    const active = flags.get('--active');
    if (!['true', 'false'].includes(active ?? '')) throw new Error('activity requires --active true|false');
    body = { active: active === 'true' };
  }
  const base = await resolveDaemonUrl({ flagUrl: flags.get('--daemon-url') ?? null });
  const suffix = action === 'show' ? '' : `/${action}`;
  let url = `${base.replace(/\/$/, '')}/api/projects/${encodeURIComponent(project)}/custodians${suffix}`;
  if (action === 'history' && flags.has('--limit')) {
    const limit = Number(flags.get('--limit'));
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('History limit must be 1–100');
    url += `?limit=${limit}`;
  }
  const dispatcher = new Agent({ headersTimeout: 240_000, bodyTimeout: 240_000 });
  try {
    const response = await fetch(url, Object.assign({ method: body ? 'POST' : 'GET',
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }, { dispatcher }));
    const result = await response.json() as { error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? `Custodian returned HTTP ${response.status}`);
    console.log(JSON.stringify(result, null, flags.has('--json') ? undefined : 2));
  } finally { await dispatcher.close(); }
}
