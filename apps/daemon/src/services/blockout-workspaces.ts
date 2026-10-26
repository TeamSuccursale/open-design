import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withProjectHistoryMutation } from '../project-history-observer.js';
import {
  BLOCKOUT_BRIEF_PATH, BLOCKOUT_DOCUMENTS_PATH, BLOCKOUT_START_PATH, BlockoutDocumentSchema,
  blockoutPageFiles, blockoutWorkspacePath, renderBlockoutBrief,
  BlockoutHandoffRequestSchema, BlockoutHandoffSchema, blockoutHandoffSnapshot, diffBlockoutSnapshots,
  BlockoutAppendAlternativesRequestSchema,
  type BlockoutHandoff, type BlockoutHandoffResponse, type BlockoutAppendAlternativesResponse,
  type BlockoutDocument, type BlockoutDocumentCatalog, type BlockoutReserveAdjustment, type BlockoutWorkspaceResponse,
} from '@open-design/contracts';
import { containedIntakePath } from './project-intake-settings.js';
import { replaceFileAtomically } from '../storage/atomic-file.js';
import { readBlockoutDesignState, type BlockoutDesignRunLookup } from './blockout-design.js';

const pending = new Map<string, Promise<unknown>>();
async function exclusive<T>(root: string, callback: () => Promise<T>): Promise<T> {
  const task = (pending.get(root) ?? Promise.resolve()).catch(() => undefined).then(callback); pending.set(root, task);
  try { return await task; } finally { if (pending.get(root) === task) pending.delete(root); }
}
async function textFile(root: string, relative: string): Promise<string | null> {
  try {
    const target = await containedIntakePath(root, relative);
    if ((await stat(target)).size > 2_000_000) throw new Error('Blockout metadata exceeds its size limit');
    return await readFile(target, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return null; }
}
/**
 * Every file of one save is one history mutation. Each mutation captures the project before and
 * after with Git, so a file-by-file save spawned Git dozens of times per Blockout document.
 */
async function writeAll(root: string, files: ReadonlyArray<readonly [relative: string, content: string]>): Promise<void> {
  const prepared: Array<{ content: string; target: string; temporary: string }> = [];
  for (const [relative, content] of files) {
    await containedIntakePath(root, path.dirname(relative), true);
    prepared.push({ content, target: await containedIntakePath(root, relative), temporary: await containedIntakePath(root, `${relative}.${randomUUID()}.tmp`) });
  }
  await withProjectHistoryMutation({ root, paths: files.map(([relative]) => relative) }, async () => {
    for (const file of prepared) {
      try { await writeFile(file.temporary, file.content, { flag: 'wx' }); await replaceFileAtomically(file.temporary, file.target); }
      finally { await rm(file.temporary, { force: true }); }
    }
  });
}
const write = (root: string, relative: string, content: string) => writeAll(root, [[relative, content]]);
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
export class BlockoutWorkspaceConflict extends Error { constructor() { super('blockout.conflict'); } }
export class BlockoutAlternativeConflict extends Error {
  constructor(public readonly code: string, message: string, public readonly resultPath?: string) { super(message); }
}

export function parseBlockoutCatalog(input: unknown): BlockoutDocumentCatalog {
  const value = input as Partial<BlockoutDocumentCatalog> | null;
  if (!value || value.version !== 1 || !Array.isArray(value.documents) || value.documents.length > 50
    || !value.documents.every((item) => item && typeof item.id === 'string' && item.id.length <= 120
      && /^(?!\.{1,2}$)[\w.-]+$/.test(item.id) && typeof item.title === 'string' && item.title.length <= 240)
    || new Set(value.documents.map((item) => item.id)).size !== value.documents.length) throw new Error('Invalid blockout document catalog');
  return { version: 1, documents: value.documents.map((item) => ({ id: item.id, title: item.title })) };
}
export async function listBlockoutWorkspaces(root: string): Promise<BlockoutDocumentCatalog> {
  const raw = await textFile(root, BLOCKOUT_DOCUMENTS_PATH);
  if (raw !== null) { const value = JSON.parse(raw); return parseBlockoutCatalog(Array.isArray(value) ? { version: 1, documents: value } : value); }
  const first = await readBlockoutWorkspace(root, 'document-1');
  return { version: 1, documents: [{ id: 'document-1', title: first.document?.title ?? '' }] };
}
export async function saveBlockoutCatalog(root: string, input: unknown): Promise<BlockoutDocumentCatalog> {
  const catalog = parseBlockoutCatalog(input);
  return exclusive(root, async () => { await write(root, BLOCKOUT_DOCUMENTS_PATH, json(catalog)); return catalog; });
}
export async function readBlockoutWorkspace(root: string, documentId: string): Promise<BlockoutWorkspaceResponse> {
  const raw = await textFile(root, blockoutWorkspacePath(documentId));
  if (raw === null) return { document: null, raw: null };
  const document = BlockoutDocumentSchema.parse(JSON.parse(raw));
  if (document.documentId !== documentId) throw new Error('Invalid blockout document identity');
  return { document, raw };
}
/** Caller owns the project lock. The canonical rename commits document and receipts together. */
async function persistWorkspace(root: string, document: BlockoutDocument, startingPoint = false): Promise<BlockoutWorkspaceResponse> {
  // Receipt preservation can change property order. Return the same canonical
  // schema order that readers/renderers hash, as well as the same field values.
  document = BlockoutDocumentSchema.parse(document);
  const catalog = await listBlockoutWorkspaces(root);
  const documents = [...catalog.documents.filter((entry) => entry.id !== document.documentId), { id: document.documentId, title: document.title }];
  const raw = json(document);
  await writeAll(root, [
    ...blockoutPageFiles(document).map((file) => [file.path, file.content] as const),
    [BLOCKOUT_DOCUMENTS_PATH, json(parseBlockoutCatalog({ version: 1, documents }))],
    ...(startingPoint ? [[BLOCKOUT_START_PATH, json(document)], [BLOCKOUT_BRIEF_PATH, renderBlockoutBrief(document)]] as const : []),
    [blockoutWorkspacePath(document.documentId), raw],
  ]);
  return { document, raw };
}
/**
 * Seeds the missing documents of a confirmed brief as one save; existing workspaces stay as
 * they are. The first document is the starting point when it is among the new ones.
 */
export async function seedBlockoutWorkspaces(root: string, documents: BlockoutDocument[]): Promise<void> {
  await exclusive(root, async () => {
    const missing: BlockoutDocument[] = [];
    for (const document of documents) if (await textFile(root, blockoutWorkspacePath(document.documentId)) === null) missing.push(BlockoutDocumentSchema.parse(document));
    if (!missing.length) return;
    // Without a catalog file the listing infers document-1; a new multi-output catalog must not list it.
    const listed = await textFile(root, BLOCKOUT_DOCUMENTS_PATH) !== null || await textFile(root, blockoutWorkspacePath('document-1')) !== null
      ? (await listBlockoutWorkspaces(root)).documents : [];
    const catalog = parseBlockoutCatalog({ version: 1, documents: [...listed.filter((entry) => !missing.some((document) => document.documentId === entry.id)),
      ...missing.map((document) => ({ id: document.documentId, title: document.title }))] });
    const start = missing[0]!.documentId === documents[0]?.documentId ? missing[0]! : null;
    await writeAll(root, [
      ...missing.flatMap((document) => blockoutPageFiles(document).map((file) => [file.path, file.content] as const)),
      [BLOCKOUT_DOCUMENTS_PATH, json(catalog)],
      ...(start ? [[BLOCKOUT_START_PATH, json(start)], [BLOCKOUT_BRIEF_PATH, renderBlockoutBrief(start)]] as const : []),
      ...missing.map((document) => [blockoutWorkspacePath(document.documentId), json(document)] as const),
    ]);
  });
}
export async function saveBlockoutWorkspace(root: string, documentId: string, input: unknown): Promise<BlockoutWorkspaceResponse> {
  const value = input as { document?: unknown; baseRaw?: unknown; startingPoint?: unknown } | null;
  if (!value || !(value.baseRaw === null || typeof value.baseRaw === 'string') || (value.startingPoint !== undefined && typeof value.startingPoint !== 'boolean')) throw new Error('Expected document and baseRaw revision');
  const document = BlockoutDocumentSchema.parse(value.document);
  if (document.documentId !== documentId) throw new Error('Document identity does not match the requested workspace');
  blockoutWorkspacePath(documentId);
  return exclusive(root, async () => {
    const current = await readBlockoutWorkspace(root, documentId);
    if (current.raw !== value.baseRaw) throw new BlockoutWorkspaceConflict();
    // Old clients may omit this server-owned metadata. Keep receipts even when
    // the user deliberately removes a generated proposal; a retry cannot revive it.
    const { alternativeBatches: _submittedReceipts, ...editable } = document;
    return persistWorkspace(root, { ...editable, ...(current.document?.alternativeBatches ? { alternativeBatches: current.document.alternativeBatches } : {}) }, value.startingPoint === true);
  });
}
export async function saveBlockoutWorkspaceStartingPoint(root: string, documentId: string, input: unknown, designRun?: { projectId: string; getRun: BlockoutDesignRunLookup }): Promise<BlockoutHandoffResponse> {
  const request = BlockoutHandoffRequestSchema.parse(input), document = request.document;
  if (document.documentId !== documentId) throw new Error('Invalid blockout document identity');
  return exclusive(root, async () => {
    const requestId = request.requestId ?? randomUUID();
    const relative = `blockouts/${documentId}/handoffs/${requestId}.blockout-update.json`;
    const explicitVariant = request.variantId ?? (request.operation ? document.selectedVariantId ?? document.activeVariantId : document.activeVariantId);
    if (!document.variants.some((variant) => variant.id === explicitVariant)) throw new Error('The requested base proposal is missing');
    const next = blockoutHandoffSnapshot({ ...document, activeVariantId: explicitVariant });
    const design = await readBlockoutDesignState(root, documentId, designRun?.projectId, designRun?.getRun);
    if (request.operation && (request.action === 'develop-design' || document.planningStage === 'composition')) throw new Error('Alternatives require an empty structural Blockout request');
    if (request.requestId) {
      const existingRaw = await textFile(root, relative);
      if (existingRaw) {
        const existing = BlockoutHandoffSchema.parse(JSON.parse(existingRaw));
        if (existing.snapshot.documentId !== documentId || json(existing.snapshot) !== json(next) || json(existing.operation) !== json(request.operation)
          || existing.action !== (request.action ?? (request.operation ? 'request-proposals' : document.approval?.variantId === explicitVariant ? 'develop-design' : 'request-proposals'))) {
          throw new BlockoutAlternativeConflict('BLOCKOUT_ALTERNATIVE_REQUEST_CONFLICT', 'This request ID already identifies another Blockout snapshot');
        }
        return { handoff: existing as BlockoutHandoff, path: relative };
      }
    }
    const current = await readBlockoutWorkspace(root, documentId);
    if (!current.document || !current.raw || (request.baseRaw !== undefined && request.baseRaw !== current.raw) || json(current.document) !== json(document)) throw new BlockoutWorkspaceConflict();
    const action = request.action ?? (request.operation ? 'request-proposals' : document.approval?.variantId === explicitVariant ? 'develop-design' : 'request-proposals');
    if (action === 'develop-design' && document.approval?.variantId !== explicitVariant) throw new Error('Graphic design requires approval of this proposal');
    if (action === 'update-design' && !design.applied) throw new Error('No successful design is linked to this document yet');
    const folder = `blockouts/${documentId}/handoffs`, latestPath = `${folder}/.latest.json`;
    const previousRaw = await textFile(root, latestPath);
    const previous = previousRaw ? BlockoutHandoffSchema.parse(JSON.parse(previousRaw)) as BlockoutHandoff : null;
    if (previous && previous.snapshot.documentId !== documentId) throw new Error('Invalid previous Blockout update identity');
    const appliedBase = action === 'update-design' ? design.applied : null;
    const before = appliedBase?.snapshot ?? previous?.snapshot;
    const comparable = before?.variant.id === next.variant.id;
    const handoff: BlockoutHandoff = {
      version: 1, type: 'blockout-update', id: requestId, action, createdAt: new Date().toISOString(),
      ...(request.operation ? { operation: request.operation } : {}),
      workspacePath: blockoutWorkspacePath(documentId), workspaceRevision: createHash('sha256').update(current.raw).digest('hex'),
      previousHandoffId: previous?.id ?? null, previousWorkspaceRevision: previous?.workspaceRevision ?? null,
      comparison: previous ? comparable ? 'same-proposal' : 'different-proposal' : 'initial',
      comparisonBasis: appliedBase ? 'applied-design' : 'previous-handoff',
      ...(appliedBase ? { designBase: { revisionId: appliedBase.revisionId, handoffId: appliedBase.handoffId, runId: appliedBase.runId, entryFile: appliedBase.entryFile, files: appliedBase.files, snapshot: appliedBase.snapshot } } : {}),
      snapshot: next, changes: comparable ? diffBlockoutSnapshots(before!, next) : [],
    };
    if (Buffer.byteLength(json(handoff)) > 2_000_000) throw new Error('Blockout update exceeds its metadata size limit');
    const start = { ...document, activeVariantId: explicitVariant };
    await writeAll(root, [[BLOCKOUT_START_PATH, json(start)], [BLOCKOUT_BRIEF_PATH, renderBlockoutBrief(start)], [relative, json(handoff)], [latestPath, json(handoff)]]);
    return { handoff, path: relative };
  });
}

/** Selection/approval and other proposals may change without invalidating this base. */
function alternativeBase(snapshot: object): string {
  const { approval: _approval, needsReadaptation: _readaptation, ...base } = snapshot as Record<string, unknown>;
  return json(base);
}

/** Generated results have no replacement-document surface; only new proposals are accepted. */
/**
 * Fits only the appended pages, e.g. out of an applied header/footer reserve. It runs after the
 * result digest, so retrying the same result still replays instead of conflicting.
 */
export type BlockoutAlternativeFit = (appended: BlockoutDocument) => Promise<{ document: BlockoutDocument; reserveAdjustments: BlockoutReserveAdjustment[] }>;

export async function appendBlockoutAlternatives(root: string, documentId: string, input: unknown, fit?: BlockoutAlternativeFit): Promise<BlockoutAppendAlternativesResponse> {
  blockoutWorkspacePath(documentId);
  const request = BlockoutAppendAlternativesRequestSchema.parse(input);
  return exclusive(root, async () => {
    const requestRaw = await textFile(root, `blockouts/${documentId}/handoffs/${request.requestId}.blockout-update.json`);
    if (!requestRaw) throw new Error('The saved alternative request is missing');
    const handoff = BlockoutHandoffSchema.parse(JSON.parse(requestRaw));
    if (handoff.id !== request.requestId || handoff.snapshot.documentId !== documentId || handoff.workspacePath !== blockoutWorkspacePath(documentId)
      || handoff.action !== 'request-proposals' || handoff.operation?.type !== 'append-alternatives') throw new Error('This handoff does not authorize structural alternatives for this document');
    if (request.candidates.length !== handoff.operation.count) throw new Error('Return every requested alternative together');
    const payloadDigest = createHash('sha256').update(json(request.candidates)).digest('hex');
    const current = await readBlockoutWorkspace(root, documentId);
    if (!current.document || !current.raw) throw new BlockoutAlternativeConflict('BLOCKOUT_ALTERNATIVE_BASE_CHANGED', 'The original Blockout document no longer exists');
    const receipt = current.document.alternativeBatches?.find((batch) => batch.requestId === request.requestId);
    if (receipt) {
      if (receipt.payloadDigest !== payloadDigest) throw new BlockoutAlternativeConflict('BLOCKOUT_ALTERNATIVE_RESULT_CONFLICT', 'Different results were already committed for this request');
      return { ...current, alternativeBatch: { ...receipt, replayed: true } };
    }
    const resultPath = `blockouts/${documentId}/handoffs/${request.requestId}.${payloadDigest}.alternatives-result.json`;
    const retained = json({ version: 1, requestId: request.requestId, payloadDigest, candidates: request.candidates });
    if (Buffer.byteLength(retained) > 2_000_000) throw new Error('Alternative results exceed the metadata size limit');
    const idStem = `alternative-${createHash('sha256').update(request.requestId).digest('hex').slice(0, 16)}`;
    let variants = request.candidates.map((candidate, index) => ({ id: `${idStem}-${index + 1}`, ...candidate }));
    // Validate every page/block before preserving a rejected result or writing projections.
    BlockoutDocumentSchema.parse({ version: 1, documentId, title: current.document.title, activeVariantId: variants[0]!.id,
      variants, answers: [], needsReadaptation: false });
    const baseVariant = current.document.variants.find((variant) => variant.id === handoff.snapshot.variant.id);
    const currentBase = baseVariant ? blockoutHandoffSnapshot({ ...current.document, activeVariantId: baseVariant.id }) : null;
    if (!currentBase || alternativeBase(currentBase) !== alternativeBase(handoff.snapshot)) {
      await write(root, resultPath, retained);
      throw new BlockoutAlternativeConflict('BLOCKOUT_ALTERNATIVE_BASE_CHANGED', 'The edited base or its page rules changed. Results were retained for review; nothing was replaced.', resultPath);
    }
    if (current.document.variants.length + variants.length > 12 || (current.document.alternativeBatches?.length ?? 0) >= 200) {
      await write(root, resultPath, retained);
      throw new BlockoutAlternativeConflict('BLOCKOUT_ALTERNATIVE_CAPACITY', 'Keep or remove existing proposals before adding these retained alternatives.', resultPath);
    }
    if (variants.some((variant) => current.document!.variants.some((saved) => saved.id === variant.id))) throw new BlockoutAlternativeConflict('BLOCKOUT_ALTERNATIVE_RESULT_CONFLICT', 'A generated proposal identity is already in use');
    let reserveAdjustments: BlockoutReserveAdjustment[] = [];
    if (fit) {
      // Saved proposals are not part of the probe, so nothing the engineer placed moves.
      const { selectedVariantId: _selected, approval: _approval, alternativeBatches: _batches, ...base } = current.document;
      const fitted = await fit(BlockoutDocumentSchema.parse({ ...base, activeVariantId: variants[0]!.id, variants }));
      variants = variants.map((variant) => ({ ...variant, pages: fitted.document.variants.find((item) => item.id === variant.id)?.pages ?? variant.pages }));
      reserveAdjustments = fitted.reserveAdjustments;
    }
    const batch = { requestId: request.requestId, payloadDigest, baseVariantId: handoff.snapshot.variant.id,
      variantIds: variants.map((variant) => variant.id), createdAt: new Date().toISOString() };
    const document = BlockoutDocumentSchema.parse({ ...current.document, variants: [...current.document.variants, ...variants],
      alternativeBatches: [...(current.document.alternativeBatches ?? []), batch] });
    if (Buffer.byteLength(json(document)) > 2_000_000) throw new Error('Blockout workspace exceeds its metadata size limit');
    await write(root, resultPath, retained);
    return { ...await persistWorkspace(root, document), alternativeBatch: { ...batch, replayed: false }, ...(reserveAdjustments.length ? { reserveAdjustments } : {}) };
  });
}
