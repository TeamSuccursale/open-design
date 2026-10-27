import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BlockoutDesignRecordRequestSchema, BlockoutDesignStateSchema, BlockoutDocumentSchema, BlockoutHandoffSchema, blockoutHandoffSnapshot, blockoutMarginOverflow, blockoutOutsideSafeArea, blockoutWorkspacePath, type BlockoutDesignState, type BlockoutDesignRevision, type BlockoutDesignUnderlay } from '@open-design/contracts';
import { containedIntakePath } from './project-intake-settings.js';
import { withProjectHistoryMutation } from '../project-history-observer.js';
import { replaceFileAtomically } from '../storage/atomic-file.js';

export type BlockoutDesignRunTarget = Readonly<{ projectId: string; documentId: string; handoffId: string; handoffSha256: string }>;
export type BlockoutDesignRun = { projectId: string | null; status: string; deliverableValid?: boolean; blockoutDesignTargets?: readonly BlockoutDesignRunTarget[] };
export type BlockoutDesignRunLookup = (id: string) => BlockoutDesignRun | null | undefined | Promise<BlockoutDesignRun | null | undefined>;
const MEASURED_MARGIN_TOLERANCE_MM = 1;
const locks = new Map<string, Promise<unknown>>();
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const prefix = (id: string) => { if (!/^(?!\.{1,2}$)[\w.-]{1,120}$/.test(id)) throw new Error('Invalid Blockout identity'); return `blockouts/${id}/design`; };
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
async function locked<T>(root: string, id: string, action: () => Promise<T>): Promise<T> {
  const key = `${root}\0${id}`, previous = locks.get(key) ?? Promise.resolve();
  const job = previous.catch(() => {}).then(action); locks.set(key, job);
  try { return await job; } finally { if (locks.get(key) === job) locks.delete(key); }
}
async function text(root: string, file: string): Promise<string | null> {
  try { const target = await containedIntakePath(root, file); if ((await stat(target)).size > 2_000_000) throw new Error('Design metadata exceeds its size limit'); return await readFile(target, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function write(root: string, file: string, content: string): Promise<void> {
  if (Buffer.byteLength(content) > 2_000_000) throw new Error('Design metadata exceeds its size limit');
  const folder = await containedIntakePath(root, path.posix.dirname(file), true); await mkdir(folder, { recursive: true });
  const target = await containedIntakePath(root, file), temporary = await containedIntakePath(root, `${file}.${randomUUID()}.tmp`);
  await withProjectHistoryMutation({ root, paths: [file] }, async () => {
    try { await writeFile(temporary, content, { flag: 'wx' }); await replaceFileAtomically(temporary, target); }
    finally { await rm(temporary, { force: true }); }
  });
}
async function stored(root: string, id: string): Promise<BlockoutDesignState> {
  const value = await text(root, `${prefix(id)}/state.json`);
  return value ? BlockoutDesignStateSchema.parse(JSON.parse(value)) : { version: 1, documentId: id, applied: null, pending: [], sourceChanged: false, pendingChanges: false };
}
export async function appliedBlockoutDesignEntry(root: string, documentId: string): Promise<string | undefined> { return (await stored(root, documentId)).applied?.entryFile; }
/** Delivery attribution reads the registrar's exact run/handoff/files without promoting its pending receipt. */
export async function registeredBlockoutDesignDelivery(root: string, documentId: string, runId: string, runProjectId: string): Promise<string | undefined> {
  const state = await stored(root, documentId);
  for (const revision of [state.applied, ...state.pending].filter((value): value is BlockoutDesignRevision => value !== null).reverse()) {
    if (revision.runId !== runId || (revision.runProjectId ?? runProjectId) !== runProjectId
      || !['pending', 'applied', 'failed'].includes(revision.status) || revision.snapshot.documentId !== documentId) continue;
    const handoffText = await text(root, `blockouts/${documentId}/handoffs/${revision.handoffId}.blockout-update.json`);
    if (!handoffText || revision.handoffSha256 && hash(handoffText) !== revision.handoffSha256) continue;
    const handoff = BlockoutHandoffSchema.parse(JSON.parse(handoffText));
    if (handoff.id !== revision.handoffId || handoff.action === 'request-proposals'
      || handoff.snapshot.documentId !== documentId || json(handoff.snapshot) !== json(revision.requested)
      || !await filesMatch(root, revision)) continue;
    return revision.entryFile;
  }
  return undefined;
}
async function filesMatch(root: string, revision: BlockoutDesignRevision): Promise<boolean> {
  for (const file of revision.files) {
    try { if (hash(await readFile(await containedIntakePath(root, file.path))) !== file.sha256) return false; } catch { return false; }
  }
  return true;
}
export const comparableDesignSnapshot = (value: BlockoutDesignRevision['snapshot']) => {
  const { approval: _approval, needsReadaptation: _readaptation, ...layout } = value;
  return JSON.stringify(layout);
};

/** Stage metadata during a real run. Only a successful, valid terminal run can become the design baseline. */
export async function recordBlockoutDesign(root: string, documentId: string, projectId: string, input: unknown, getRun: BlockoutDesignRunLookup): Promise<BlockoutDesignState> {
  const request = BlockoutDesignRecordRequestSchema.parse(input), run = await getRun(request.runId);
  if (!run?.projectId || !['running', 'succeeded'].includes(run.status)) throw new Error('Design registration requires this project’s active or successful run');
  const runProjectId = run.projectId;
  return locked(root, documentId, async () => {
    const state = await stored(root, documentId);
    const inputDigest = hash(json(request));
    const replay = [state.applied, ...state.pending].find((entry) => entry?.runId === request.runId && entry.handoffId === request.handoffId);
    if (replay && (replay.runProjectId ?? projectId) === runProjectId) { if (replay.inputDigest !== inputDigest) throw new Error('This run already registered another composition'); return state; }
    const handoffText = await text(root, `blockouts/${documentId}/handoffs/${request.handoffId}.blockout-update.json`);
    if (!handoffText) throw new Error('The design request is missing');
    const authorizedTarget = run.blockoutDesignTargets?.some((target) => target.projectId === projectId && target.documentId === documentId
      && target.handoffId === request.handoffId && target.handoffSha256 === hash(handoffText));
    if (runProjectId !== projectId && !authorizedTarget) throw new Error('Design registration requires this project’s run or its explicitly attached document handoff');
    const handoff = BlockoutHandoffSchema.parse(JSON.parse(handoffText));
    if (handoff.snapshot.documentId !== documentId || handoff.action === 'request-proposals') throw new Error('This request does not authorize design work');
    if ((handoff.designBase?.revisionId ?? null) !== (state.applied?.revisionId ?? null)) throw new Error('A newer design superseded this request');
    const requested = handoff.snapshot, snapshot = structuredClone(requested);
    if (new Set(request.pages.map((page) => page.pageId)).size !== request.pages.length || request.pages.length !== snapshot.variant.pages.length) throw new Error('Map each document page exactly once');
    for (const [pageIndex, page] of snapshot.variant.pages.entries()) {
      const mapping = request.pages.find((item) => item.pageId === page.id);
      if (!mapping || new Set(mapping.blocks.map((item) => item.blockId)).size !== mapping.blocks.length) throw new Error('Missing page or duplicate block mapping');
      if (mapping.blocks.some((item) => !page.blocks.some((block) => block.id === item.blockId))) throw new Error('Unknown mapped block');
      for (const block of page.blocks) {
        const mapped = mapping.blocks.find((item) => item.blockId === block.id);
        if (!mapped && block.designRole !== 'background') throw new Error(`Missing conceptual bounds for ${block.id}`);
        // Bounds are measured on the rendered page, so a block that crosses the margin crosses it on paper. A border or
        // rounding may add a fraction of a millimetre; a block the approved Blockout itself placed outside stays the engineer's choice.
        const overflow = mapped && blockoutMarginOverflow(mapped.box, page);
        if (overflow && overflow.mm > MEASURED_MARGIN_TOLERANCE_MM && !blockoutOutsideSafeArea(block.box, page)) {
          throw new Error(`${block.label} (${block.id}) on page ${pageIndex + 1} runs ${overflow.mm.toFixed(1)} mm past the ${overflow.side} margin. Keep it inside the page margins, measure the page again and register the design again.`);
        }
        if (mapped) block.box = mapped.box;
      }
    }
    const paths = new Set([request.entryFile, ...request.pages.map((page) => page.filePath), ...request.files]);
    // Track local linked styles/images too. Their changes invalidate a stale underlay/map.
    for (const file of [...paths]) if (/\.html?$/i.test(file)) {
      const html = await text(root, file); if (!html) throw new Error(`Missing design file: ${file}`);
      for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
        const reference = match[1]!.split(/[?#]/)[0]!;
        if (!reference || /^(?:[a-z]+:|\/|#)/i.test(reference)) continue;
        const relative = path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURIComponent(reference)));
        if (!/\.(?:css|png|jpe?g|webp|svg|gif|woff2?)$/i.test(relative)) continue;
        await containedIntakePath(root, relative); paths.add(relative);
      }
    }
    if (paths.size > 200) throw new Error('Too many design dependencies');
    const files = [];
    for (const file of paths) { const target = await containedIntakePath(root, file); if ((await stat(target)).size > 40_000_000) throw new Error('Design dependency exceeds its size limit'); files.push({ path: file, sha256: hash(await readFile(target)) }); }
    const revisionId = randomUUID();
    const attributes = (tag: string) => Object.fromEntries([...tag.matchAll(/\b(data-blockout-(?:document|page)-id)\s*=\s*["']([^"']+)["']/gi)].map((match) => [match[1]!.toLowerCase(), match[2]]));
    const entryHtml = await text(root, request.entryFile);
    if (!entryHtml || ![...entryHtml.matchAll(/<[a-z][^>]*>/gi)].some((match) => attributes(match[0])['data-blockout-document-id'] === documentId)) throw new Error(`Add data-blockout-document-id="${documentId}" to the design entry`);
    for (const page of request.pages) {
      const html = await text(root, page.filePath);
      const markers = html ? [...html.matchAll(/<[a-z][^>]*>/gi)].map((match) => attributes(match[0])).filter((tag) => tag['data-blockout-page-id'] === page.pageId) : [];
      if (!html || markers.length !== 1 || markers[0]!['data-blockout-document-id'] !== documentId) throw new Error(`Add data-blockout-document-id="${documentId}" and data-blockout-page-id="${page.pageId}" together to exactly one designed page`);
      await write(root, `${prefix(documentId)}/revisions/${revisionId}/${page.pageId}.html`, html);
    }
    const revision: BlockoutDesignRevision = { revisionId, handoffId: request.handoffId, runId: request.runId, entryFile: request.entryFile,
      runProjectId, handoffSha256: hash(handoffText), files, snapshot, requested, pages: request.pages, createdAt: new Date().toISOString(), baseDesignRevisionId: state.applied?.revisionId ?? null, inputDigest, status: 'pending' };
    state.pending = [...state.pending.slice(-19), revision];
    await write(root, `${prefix(documentId)}/revisions/${revisionId}/composition.json`, json(revision));
    await write(root, `${prefix(documentId)}/state.json`, json(state)); return state;
  });
}

/** Lazy terminal reconciliation also works after reconnect: preparing a brief never advances this pointer. */
export async function readBlockoutDesignState(root: string, documentId: string, projectId?: string, getRun?: BlockoutDesignRunLookup): Promise<BlockoutDesignState> {
  return locked(root, documentId, async () => {
    const state = await stored(root, documentId); let changed = false;
    if (getRun) for (const pending of state.pending.filter((entry) => entry.status === 'pending' || entry.status === 'failed')) {
      const run = await getRun(pending.runId);
      if (!run || run.projectId !== (pending.runProjectId ?? projectId) || ['running', 'queued', 'pending'].includes(run.status)) continue;
      // Earlier entry attribution can be repaired from this run's verified
      // registration. Retry a failed receipt only after that authoritative
      // verdict becomes valid; failed/cancelled runs remain terminal failures.
      if (pending.status === 'failed' && !(run.status === 'succeeded' && run.deliverableValid === true)) continue;
      if (run.status === 'succeeded' && run.deliverableValid === undefined) continue;
      pending.status = run.status === 'succeeded' && run.deliverableValid === true
        ? pending.baseDesignRevisionId !== (state.applied?.revisionId ?? null) ? 'superseded' : await filesMatch(root, pending) ? 'applied' : 'source-changed'
        : 'failed';
      if (pending.status === 'applied') state.applied = structuredClone(pending);
      changed = true;
    }
    state.sourceChanged = state.applied ? !await filesMatch(root, state.applied) : false;
    const raw = await text(root, blockoutWorkspacePath(documentId));
    if (state.applied && raw) {
      const document = BlockoutDocumentSchema.parse(JSON.parse(raw));
      const current = comparableDesignSnapshot(blockoutHandoffSnapshot(document));
      state.pendingChanges = current !== comparableDesignSnapshot(state.applied.snapshot) && current !== comparableDesignSnapshot(state.applied.requested);
    }
    if (changed) await write(root, `${prefix(documentId)}/state.json`, json(state));
    return state;
  });
}
export async function readBlockoutDesignUnderlay(root: string, id: string, pageId: string): Promise<BlockoutDesignUnderlay> {
  const state = await stored(root, id), applied = state.applied, page = applied?.pages.find((value) => value.pageId === pageId);
  if (!applied || !page) throw new Error('No applied design for this page');
  const html = await text(root, `${prefix(id)}/revisions/${applied.revisionId}/${pageId}.html`);
  if (!html) throw new Error('The saved design preview is unavailable');
  return { revisionId: applied.revisionId, pageId, html, filePath: page.filePath, widthPx: page.widthPx, heightPx: page.heightPx };
}
