import type { ProjectIntakeCatalog, ProjectIntakeConfig, ProjectIntakeSettings } from '@open-design/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';
import { readFile } from 'node:fs/promises';
import { Agent } from 'undici';

/** Thin CLI client; intake and searching use exactly the same API as the UI. */
export async function runProjectIntakeCli(args: string[]): Promise<void> {
  const [action, ...rest] = args;
  if (!action || action === 'help' || rest.includes('--help')) {
    console.log('od intake <scan|list|search|folders|configure|propose-svg|vectors|register-svg|prefer-svg> --project <id> [--asset <id>] [--variant <id|none>] [--label text] [--note text | --prompt-file <path|->] [--language it|en] [--path <pdf-or-svg>] [--pages 1,2] [--query text] [--source-dir <folder> ... | --clear-sources] [--output-dir <project-relative-folder>] [--project-folder <absolute-folder>] [--retry] [--json] [--daemon-url URL]');
    return;
  }
  const flags = new Map<string, string>();
  const paths: string[] = [];
  const sourceDirs: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i]!;
    if (['--json', '--retry', '--clear-sources'].includes(key)) { flags.set(key, 'true'); continue; }
    if (!['--project', '--path', '--pages', '--query', '--prompt-file', '--daemon-url', '--source-dir', '--output-dir', '--project-folder', '--asset', '--note', '--language', '--variant', '--label'].includes(key) || !rest[i + 1] || rest[i + 1]!.startsWith('--')) throw new Error(`Invalid intake option: ${key}`);
    const value = rest[++i]!;
    if (key === '--path') paths.push(value); else if (key === '--source-dir') sourceDirs.push(value); else flags.set(key, value);
  }
  const projectId = flags.get('--project');
  if (!projectId) throw new Error('--project is required');
  if (!['scan', 'list', 'search', 'folders', 'configure', 'propose-svg', 'vectors', 'register-svg', 'prefer-svg'].includes(action)) throw new Error('Unknown intake command. Use od intake help.');
  const base = await resolveDaemonUrl({ flagUrl: flags.get('--daemon-url') ?? null });
  const url = `${base.replace(/\/$/, '')}/api/projects/${encodeURIComponent(projectId)}/intake`;
  // The root CLI exits explicitly. Close our HTTP handles first on Windows.
  const dispatcher = new Agent();
  const requestFetch = (target: string, options?: RequestInit) => fetch(target, Object.assign({}, options, { dispatcher }));
  try {
    if (['vectors', 'register-svg', 'prefer-svg'].includes(action)) {
      const assetId = flags.get('--asset');
      if (!assetId) throw new Error('--asset is required');
      let note = flags.get('--note') ?? '';
      const file = flags.get('--prompt-file');
      if (file === '-') { note = ''; for await (const chunk of process.stdin) note += String(chunk); }
      else if (file) note = await readFile(file, 'utf8');
      const endpoint = `${url}/assets/${encodeURIComponent(assetId)}`;
      let response: Response;
      if (action === 'vectors') response = await requestFetch(url);
      else if (action === 'register-svg') {
        if (paths.length !== 1) throw new Error('Provide one --path to an existing project SVG');
        response = await requestFetch(`${endpoint}/vectors`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: paths[0], ...(flags.has('--label') ? { label: flags.get('--label') } : {}) }) });
      } else {
        const variant = flags.get('--variant');
        if (!variant) throw new Error('--variant <id|none> is required');
        response = await requestFetch(`${endpoint}/vector-preference`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ versionId: variant === 'none' ? null : variant, reason: note }) });
      }
      const body = await response.json() as ProjectIntakeCatalog & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? `SVG operation returned HTTP ${response.status}`);
      const result = action === 'vectors' ? body.assets.find((asset) => asset.id === assetId) : body;
      if (!result) throw new Error('Intake asset not found');
      console.log(JSON.stringify(result, null, flags.has('--json') ? undefined : 2));
      return;
    }
    if (action === 'propose-svg') {
      const assetId = flags.get('--asset');
      if (!assetId) throw new Error('--asset is required for propose-svg');
      let note = flags.get('--note') ?? '';
      const file = flags.get('--prompt-file');
      if (file === '-') { note = ''; for await (const chunk of process.stdin) note += String(chunk); }
      else if (file) note = await readFile(file, 'utf8');
      const response = await requestFetch(`${url}/assets/${encodeURIComponent(assetId)}/vector-proposal`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note, language: flags.get('--language') ?? 'it' }),
      });
      const proposal = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(proposal.error?.message ?? `Vector proposal returned HTTP ${response.status}`);
      console.log(JSON.stringify(proposal, null, flags.has('--json') ? undefined : 2));
      return;
    }
    if (action === 'folders' || action === 'configure') {
      async function jsonRequest(target: string, method = 'GET', input?: unknown): Promise<ProjectIntakeSettings> {
        const result = await requestFetch(target, { method, ...(input ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) } : {}) });
        const value = await result.json() as ProjectIntakeSettings & { error?: { message?: string } };
        if (!result.ok) throw new Error(value.error?.message ?? `Intake returned HTTP ${result.status}`);
        return value;
      }
      const projectFolder = flags.get('--project-folder');
      if (projectFolder) {
        if (action !== 'configure' || sourceDirs.length || flags.has('--output-dir') || flags.has('--prompt-file') || flags.has('--clear-sources')) throw new Error('Set --project-folder separately, then configure intake folders in that project');
        await jsonRequest(`${url.replace(/\/intake$/, '')}/working-dir`, 'POST', { baseDir: projectFolder });
      }
      let settings = await jsonRequest(`${url}/settings`);
      if (action === 'configure' && !projectFolder) {
        let config: ProjectIntakeConfig = { version: 1, sourceDirs: sourceDirs.length || flags.has('--clear-sources') ? sourceDirs : settings.sourceDirs, outputDir: flags.get('--output-dir') ?? settings.outputDir };
        const file = flags.get('--prompt-file');
        if (file) {
          let content = '';
          if (file === '-') { for await (const chunk of process.stdin) content += String(chunk); }
          else content = await readFile(file, 'utf8');
          config = JSON.parse(content) as ProjectIntakeConfig;
        }
        settings = await jsonRequest(`${url}/settings`, 'PUT', config);
      }
      console.log(JSON.stringify(settings, null, flags.has('--json') ? undefined : 2));
      return;
    }
    const response = await requestFetch(url, action === 'scan' ? {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(paths.length ? { paths } : {}),
        ...(flags.has('--pages') ? { pages: flags.get('--pages')!.split(',').map(Number) } : {}), retry: flags.has('--retry') }),
    } : undefined);
    const body = await response.json() as ProjectIntakeCatalog & { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? `Intake returned HTTP ${response.status}`);
    if (action === 'search') {
      let query = flags.get('--query') ?? '';
      const promptFile = flags.get('--prompt-file');
      if (promptFile === '-') {
        query = '';
        for await (const chunk of process.stdin) query += String(chunk);
      } else if (promptFile) query = await readFile(promptFile, 'utf8');
      const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
      body.assets = body.assets.filter((asset: { title: string; description: string; sourceName: string; tags: string[] }) =>
        terms.every((term) => [asset.title, asset.description, asset.sourceName, ...asset.tags].join(' ').toLocaleLowerCase().includes(term)));
    }
    console.log(JSON.stringify(body, null, flags.has('--json') ? undefined : 2));
  } finally { await dispatcher.close(); }
}
