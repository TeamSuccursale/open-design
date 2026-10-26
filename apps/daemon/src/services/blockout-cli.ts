import { readFile } from 'node:fs/promises';
import { Agent, fetch } from 'undici';
import {
  BlockoutDocumentSchema, BlockoutPageBudgetSchema, getBlockoutPageBudgetStatus,
  moveBlockoutBlock, reorderBlockoutPages,
  BlockoutInventoryResponseSchema,
  type BlockoutDocument, type BlockoutWorkspaceResponse,
} from '@open-design/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';

const actions = ['list', 'show', 'save', 'brief', 'request-alternatives', 'append-alternatives', 'catalog-set', 'overview', 'move-block', 'budget', 'reorder-pages', 'inventory', 'assess', 'design', 'design-record', 'design-page'];
const editingActions = ['move-block', 'budget', 'reorder-pages'];

async function readInput(file: string): Promise<string> {
  if (file !== '-') return readFile(file, 'utf8');
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
}

function objectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected an input object');
  return input as Record<string, unknown>;
}

function requiredString(value: unknown, flag: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${flag} is required`);
  return value;
}

function pageBudget(document: BlockoutDocument, flags: Map<string, string>, input: unknown): BlockoutDocument {
  const patch = input === undefined ? {} : objectInput(input);
  const budget: Record<string, unknown> = { ...document.pageBudget, ...patch };
  for (const key of ['mode', 'source', 'note'] as const) if (flags.has(`--${key}`)) budget[key] = flags.get(`--${key}`);
  for (const key of ['limit', 'target'] as const) {
    const value = flags.get(`--${key}`);
    if (value !== undefined) budget[key] = value === 'none' ? undefined : Number(value);
  }
  if (budget.mode === 'exact' && !flags.has('--target') && patch.target === undefined) budget.target = budget.limit;
  const parsed = BlockoutPageBudgetSchema.parse(budget);
  return { ...document, pageBudget: parsed, needsReadaptation: document.needsReadaptation || Boolean(document.approval) };
}

/** Blockout editing uses the same authenticated metadata boundary as the UI. */
export async function runBlockoutCli(args: string[]): Promise<void> {
  const [action, ...rest] = args;
  if (!action || ['help', '--help', '-h'].includes(action) || rest.includes('--help')) {
    console.log(`od blockout <${actions.join('|')}> --project <id> [--document <id>] [--prompt-file <path|->] [--json] [--daemon-url URL]
save accepts {document,baseRaw,startingPoint?}; baseRaw is the raw string od blockout show --json returns, or null for a new document. Saving also gives the pages the applied header/footer reserve, so od header-footer apply is not needed after it. From an agent run (OD_RUN_ID set), save keeps non-background blocks out of the applied header/footer reserve: it scales a page's body into the free band and lists what moved in reserveAdjustments, or fails with BLOCKOUT_RESERVE_OVERLAP naming each page's free band when the page needs recomposing. brief accepts {document,baseRaw?,action?:"request-proposals"|"develop-design"|"update-design"} and returns a versioned Blockout update path with the old applied composition, current structure and changes, without image uploads; catalog-set accepts {version:1,documents}.
design reports the applied design and any pending registrations. design-page --page <page-id> reads its saved preview HTML and dimensions.
design-record --prompt-file accepts {handoffId,runId?,entryFile,pages:[{pageId,filePath,widthPx,heightPx,blocks:[{blockId,box}]}],files?:[path]}. runId defaults to OD_RUN_ID. Add data-blockout-page-id to each designed page. Bounds describe conceptual content; backgrounds, watermarks, decoration and overlaps remain free. Registration becomes applied only when this project's run succeeds with a valid deliverable; it never approves a layout or starts a run.
request-alternatives [--variant <id>] [--count 1|2|3] [--request-id <stable-id>] freezes the latest saved chosen proposal (or explicit variant); --prompt-file supplies instructions as plain text or {instruction,count?,variantId?,requestId?}. It prepares metadata only, not a model run.
append-alternatives --prompt-file accepts {requestId,candidates:[{label,pages}]}; it appends results without replacing saved proposals, selection or approval. Retrying the same result returns the same proposal IDs. From an agent run, appended pages are fitted to the header/footer reserve like save, and reserveAdjustments names them by their saved proposal ID.
inventory [--refresh] [--wait] reports exact source material and coverage; --wait polls only this inventory for at most 120 seconds and never starts image extraction.
assess --document <id> reads the saved proposal assessment; --prompt-file <path|-> POSTs a complete unsaved document or {document} to the same assessment endpoint (use - for stdin).
overview [--variant <id>] reports every page, its blocks and the source limit/planning target.
move-block --variant <id> --source-page <id> --block <id> --target-page <id>
  or --prompt-file with {variantId,sourcePageId,blockId,targetPageId}.
reorder-pages --variant <id> --page-order <id,id,...>
  or --prompt-file with {variantId,pageIds:[...]}.
budget [--mode maximum|exact|flexible] [--limit <n|none>] [--target <n|none>] [--source <citation>] [--note <text>]
  accepts a budget object through --prompt-file; a plain-text file supplies its note.
Editing commands read the current revision and save through the same HTTP endpoint as the editor. Conflicts fail without overwriting.`); return;
  }
  if (!actions.includes(action)) throw new Error('Unknown blockout command');
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index]!;
    if (['--json', '--refresh', '--wait'].includes(key)) { flags.set(key, 'true'); continue; }
    if (!['--project', '--document', '--prompt-file', '--daemon-url', '--variant', '--count', '--request-id', '--source-page', '--block', '--target-page', '--page', '--page-order', '--mode', '--limit', '--target', '--source', '--note'].includes(key) || !rest[index + 1] || rest[index + 1]!.startsWith('--')) throw new Error(`Invalid blockout option: ${key}`);
    flags.set(key, rest[++index]!);
  }
  const project = flags.get('--project'); if (!project) throw new Error('--project is required');
  const writing = ['save', 'brief', 'append-alternatives', 'catalog-set', 'design-record'].includes(action), file = flags.get('--prompt-file');
  if (writing && !file) throw new Error('--prompt-file <path|-> is required');
  if (!writing && !editingActions.includes(action) && !['assess', 'request-alternatives'].includes(action) && file) throw new Error('--prompt-file applies to save, brief, alternatives, catalog-set, assess or editing commands');
  if (action !== 'inventory' && (flags.has('--refresh') || flags.has('--wait'))) throw new Error('--refresh and --wait apply only to inventory');
  let input: unknown;
  if (file) {
    const text = await readInput(file);
    if ((action === 'budget' || action === 'request-alternatives') && !text.trimStart().startsWith('{')) input = { [action === 'budget' ? 'note' : 'instruction']: text };
    else input = JSON.parse(text);
  }
  const document = flags.get('--document') ?? 'document-1';
  // The revision guards edits made since the document was read; an agent cannot guess it, so name where it comes from.
  if (action === 'save' && !(input && typeof input === 'object' && 'baseRaw' in input)) throw new Error(`save needs baseRaw: run od blockout show --project ${project} --document ${document} --json and send its raw string unchanged as baseRaw (null only for a document that does not exist yet).`);
  const base = await resolveDaemonUrl({ flagUrl: flags.get('--daemon-url') ?? null });
  if (action === 'design-record') { const value = objectInput(input); input = { ...value, runId: value.runId ?? process.env.OD_RUN_ID }; }
  const projectUrl = `${base.replace(/\/$/, '')}/api/projects/${encodeURIComponent(project)}`;
  const url = action === 'inventory' ? `${projectUrl}/blockout-materials` : `${projectUrl}/blockout-documents${action === 'list' || action === 'catalog-set' ? '' : `/${encodeURIComponent(document)}`}${action === 'brief' ? '/starting-point' : action === 'assess' ? '/assessment' : action === 'append-alternatives' ? '/alternatives' : action.startsWith('design') ? `/design${action === 'design-page' ? `/pages/${encodeURIComponent(requiredString(flags.get('--page'), '--page'))}` : ''}` : ''}`;
  const dispatcher = new Agent();
  const inventoryDeadline = action === 'inventory' ? Date.now() + 120_000 : undefined;
  try {
    const request = async (method: string, body?: unknown, target = url): Promise<unknown> => {
      const workspaceId = process.env.OD_WORKSPACE_ID?.trim() ?? '', memberId = process.env.OD_WORKSPACE_MEMBER_ID?.trim() ?? '';
      if (Boolean(workspaceId) !== Boolean(memberId)) throw new Error('The run workspace identity is incomplete');
      const response = await fetch(target, { method, dispatcher,
        ...(inventoryDeadline === undefined ? {} : { signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, inventoryDeadline - Date.now()))) }),
        headers: { ...(workspaceId && memberId ? { 'x-od-workspace-id': workspaceId, 'x-od-workspace-member-id': memberId } : {}), ...((action === 'design-record' || action === 'save' || action === 'append-alternatives') && process.env.OD_RUN_ID ? { 'x-od-run-id': process.env.OD_RUN_ID } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await response.json() as { error?: { code?: string; message?: string; details?: { resultPath?: string } } };
      if (!response.ok) throw new Error([result.error?.code, result.error?.message ?? `Blockout returned HTTP ${response.status}`, result.error?.details?.resultPath].filter(Boolean).join(': '));
      return result;
    };
    let result: unknown;
    if (action === 'request-alternatives') {
      const current = await request('GET') as BlockoutWorkspaceResponse;
      if (!current.document || !current.raw) throw new Error('Blockout document not found');
      const values = input === undefined ? {} : objectInput(input);
      const requestId = flags.get('--request-id') ?? values.requestId;
      const variantId = flags.get('--variant') ?? values.variantId ?? current.document.selectedVariantId ?? current.document.activeVariantId;
      result = await request('POST', { document: current.document, baseRaw: current.raw, action: 'request-proposals', variantId,
        ...(requestId === undefined ? {} : { requestId }), operation: { type: 'append-alternatives', count: flags.has('--count') ? Number(flags.get('--count')) : values.count ?? 1, instruction: values.instruction ?? '' } }, `${url}/starting-point`);
    } else if (action === 'append-alternatives') result = await request('POST', input);
    else if (action === 'inventory') {
      let current = BlockoutInventoryResponseSchema.parse(await request(flags.has('--refresh') ? 'POST' : 'GET', flags.has('--refresh') ? {} : undefined));
      const deadline = inventoryDeadline!;
      while (flags.has('--wait') && ['preparing', 'waiting'].includes(current.inventory.status) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        current = BlockoutInventoryResponseSchema.parse(await request('GET'));
      }
      result = current;
    } else if (action === 'assess') result = await request(file ? 'POST' : 'GET', file ? input : undefined);
    else if (action === 'overview' || editingActions.includes(action)) {
      const current = await request('GET') as BlockoutWorkspaceResponse;
      if (!current.document) throw new Error('Blockout document not found');
      const document = BlockoutDocumentSchema.parse(current.document);
      if (action === 'overview') {
        const variantId = flags.get('--variant');
        const variants = document.variants.filter((variant) => !variantId || variant.id === variantId);
        if (!variants.length) throw new Error('Blockout proposal not found');
        result = { documentId: document.documentId, title: document.title, pageBudget: document.pageBudget,
          activeVariantId: document.activeVariantId, approval: document.approval, needsReadaptation: document.needsReadaptation,
          proposals: variants.map((variant) => ({ ...variant, pageBudgetStatus: getBlockoutPageBudgetStatus(document, variant.id) })) };
      } else {
        const values = input === undefined ? {} : objectInput(input);
        const variantId = flags.get('--variant') ?? values.variantId ?? document.activeVariantId;
        let next: BlockoutDocument;
        if (action === 'move-block') next = moveBlockoutBlock(document, {
          variantId: requiredString(variantId, '--variant'),
          sourcePageId: requiredString(flags.get('--source-page') ?? values.sourcePageId, '--source-page'),
          blockId: requiredString(flags.get('--block') ?? values.blockId, '--block'),
          targetPageId: requiredString(flags.get('--target-page') ?? values.targetPageId, '--target-page'),
        });
        else if (action === 'reorder-pages') {
          const pageIds: unknown = flags.has('--page-order') ? flags.get('--page-order')!.split(',').map((id) => id.trim()) : values.pageIds;
          if (!Array.isArray(pageIds) || !pageIds.every((id) => typeof id === 'string' && id.length > 0)) throw new Error('--page-order or pageIds is required');
          next = reorderBlockoutPages(document, requiredString(variantId, '--variant'), pageIds as string[]);
        } else next = pageBudget(document, flags, input);
        result = await request('PUT', { document: next, baseRaw: current.raw });
      }
    } else result = await request(action === 'brief' || action === 'design-record' ? 'POST' : writing ? 'PUT' : 'GET', writing ? input : undefined);
    console.log(JSON.stringify(result, null, flags.has('--json') ? undefined : 2));
  } finally { await dispatcher.close(); }
}
