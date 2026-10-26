import { type BlockoutBox, type BlockoutDocument, type BlockoutPage, type BlockoutPageBudget } from './blockout.js';
import { blockoutBounds, blockoutSafeArea } from './blockout-geometry.js';
import { type DocumentSetup } from './document-setup.js';

/** No page count is guessed from unrelated dates, A4, font sizes or source page numbers. */
function confirmedPageRule(value: string): { count: number; mode: 'maximum' | 'exact' } | undefined {
  const normalized = value.toLocaleLowerCase('it').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const unit = '(?:pagin[ae]|facciat[ae]|cartell[ae]|tavol[ae]|pages?|sheets?)';
  if (new RegExp(`\\d+\\s*(?:[-–—/]|a|to)\\s*\\d+\\s*${unit}\\b`, 'i').test(normalized)) return undefined;
  const counts = [...normalized.matchAll(new RegExp(`(?<![\\d.,/])\\b(\\d{1,5})(?:\\s*\\([^)]{1,30}\\))?\\s*${unit}\\b`, 'g')),
    ...normalized.matchAll(new RegExp(`\\b${unit}\\s*(?:n(?:umero)?\\.?\\s*)?(\\d{1,5})(?![\\d.,/])\\b`, 'g'))]
    .map((match) => Number(match[1]));
  if (!counts.length || new Set(counts).size !== 1 || counts[0]! < 1 || counts[0]! > 10_000) return undefined;
  const maximum = /\b(?:massim[oaie]|max\.?|maximum|at most|no more than|non (?:superiore|oltre)|limite)\b/.test(normalized);
  const exact = /\b(?:esattamente|exactly|obbligatoriamente)\b|\bcompost[ao]\s+da\b/.test(normalized);
  if (!maximum && !exact) return undefined;
  return { count: counts[0]!, mode: exact ? 'exact' : 'maximum' };
}

/** Explicit engineer targets override the default full tender ceiling, without changing the source rule. */
export function deriveBlockoutPageBudget(setup: DocumentSetup): BlockoutPageBudget | undefined {
  if (setup.status !== 'confirmed' || !setup.confirmed) return undefined;
  const pageTarget = setup.confirmed.pageTarget;
  const constraints = setup.confirmed.constraints.filter((constraint) => constraint.kind === 'page-limit');
  if (constraints.some((constraint) => constraint.status === 'conflict')) {
    if (pageTarget !== undefined) throw new Error('Resolve the source page allowance before choosing a page target');
    return undefined;
  }
  const rules = constraints.filter((constraint) => constraint.status === 'confirmed');
  const parsed = rules.map((constraint) => confirmedPageRule(constraint.value));
  if (!parsed.length) return pageTarget === undefined ? undefined : { mode: 'flexible', target: pageTarget };
  if (parsed.some((rule) => !rule) || new Set(parsed.map((rule) => rule!.count)).size !== 1) {
    if (pageTarget !== undefined) throw new Error('Resolve the source page allowance before choosing a page target');
    return undefined;
  }
  const limit = parsed[0]!.count;
  const mode = parsed.some((rule) => rule!.mode === 'exact') ? 'exact' : 'maximum';
  if (pageTarget !== undefined && mode === 'exact' && pageTarget !== limit) throw new Error('The page target must match the exact source page requirement');
  if (pageTarget !== undefined && pageTarget > limit) throw new Error('The page target cannot exceed the source maximum');
  const tender = setup.intent.kind === 'tender-offer' || setup.intent.kind === 'tender-form';
  const sourceIds = new Set(rules.flatMap((constraint) => constraint.sourceIds));
  const sources = setup.scan.sources.filter((source) => sourceIds.has(source.id))
    .map((source) => `${source.title || source.path}${source.page ? ` (p. ${source.page})` : ''} [${source.id}]`);
  return { mode, limit, target: pageTarget ?? (tender || mode === 'exact' ? limit : undefined),
    source: sources.length ? sources.join('; ').slice(0, 2000) : undefined,
    note: rules.map((constraint) => constraint.value).join('\n\n').slice(0, 12_000) };
}

export interface BlockoutPageBudgetStatus {
  total: number;
  counted: number;
  excluded: number;
  mode?: 'maximum' | 'exact' | 'flexible';
  limit?: number;
  target?: number;
  remaining?: number;
  over: number;
  unfilled: number;
}

/** Editing may exceed a source limit; the overview reports it without discarding pages. */
export function getBlockoutPageBudgetStatus(document: BlockoutDocument, variantId = document.activeVariantId): BlockoutPageBudgetStatus {
  const variant = document.variants.find((item) => item.id === variantId);
  if (!variant) throw new Error('Blockout proposal is missing');
  const total = variant.pages.length, counted = variant.pages.filter((page) => page.countsTowardLimit !== false).length;
  const budget = document.pageBudget;
  const limit = budget?.mode !== 'flexible' ? budget?.limit : undefined;
  const target = budget?.mode === 'exact' ? budget.limit : budget?.target;
  return { total, counted, excluded: total - counted,
    ...(budget ? { mode: budget.mode } : {}),
    ...(limit === undefined ? {} : { limit, remaining: Math.max(0, limit - counted) }),
    ...(target === undefined ? {} : { target }),
    over: limit === undefined ? 0 : Math.max(0, counted - limit),
    unfilled: target === undefined ? 0 : Math.max(0, target - counted) };
}

/** Preserve physical proportions between paper sizes. Only an oversized block is uniformly reduced. */
export function projectBlockoutBoxToPage(box: BlockoutBox, source: BlockoutPage, target: BlockoutPage): { box: BlockoutBox; scaled: boolean } {
  if (source.widthMm === target.widthMm && source.heightMm === target.heightMm && source.safeMarginMm === target.safeMarginMm) {
    return { box: { ...box }, scaled: false };
  }
  const width = box.width * source.widthMm / target.widthMm, height = box.height * source.heightMm / target.heightMm;
  const safe = blockoutSafeArea(target), aspect = target.widthMm / target.heightMm;
  const bounds = blockoutBounds({ ...box, width, height }, aspect);
  const maximumScale = Math.min(100 / width, 100 / height,
    (safe.right - safe.left) / (bounds.right - bounds.left), (safe.bottom - safe.top) / (bounds.bottom - bounds.top));
  // The serialized transform uses at least 1% on each axis. Reject an impossible
  // aspect ratio rather than distort the block while transferring it.
  const minimumScale = Math.max(1 / width, 1 / height);
  if (minimumScale > maximumScale) throw new Error('This block cannot fit the destination paper without changing its proportions');
  const scale = Math.max(minimumScale, Math.min(1, maximumScale));
  const next = { ...box, width: width * scale, height: height * scale };
  const projectedBounds = blockoutBounds(next, aspect);
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
  const centerX = box.x + box.width / 2, centerY = box.y + box.height / 2;
  const halfX = (projectedBounds.right - projectedBounds.left) / 2, halfY = (projectedBounds.bottom - projectedBounds.top) / 2;
  next.x = Math.max(0, clamp(centerX, Math.max(next.width / 2, safe.left + halfX), Math.min(100 - next.width / 2, safe.right - halfX)) - next.width / 2);
  next.y = Math.max(0, clamp(centerY, Math.max(next.height / 2, safe.top + halfY), Math.min(100 - next.height / 2, safe.bottom - halfY)) - next.height / 2);
  return { box: next, scaled: Math.abs(scale - 1) > 0.000_001 };
}

export interface MoveBlockoutBlockRequest {
  variantId: string;
  sourcePageId: string;
  blockId: string;
  targetPageId: string;
}

/** Immutable user-requested transfer; this never reflows or replaces neighboring blocks. */
export function moveBlockoutBlock(document: BlockoutDocument, request: MoveBlockoutBlockRequest): BlockoutDocument {
  const variant = document.variants.find((item) => item.id === request.variantId);
  const source = variant?.pages.find((page) => page.id === request.sourcePageId);
  const target = variant?.pages.find((page) => page.id === request.targetPageId);
  const block = source?.blocks.find((item) => item.id === request.blockId);
  if (!variant || !source || !target || !block) throw new Error('The source block or destination page is missing');
  if (source.id === target.id) return document;
  if (target.blocks.length >= 200) throw new Error('The destination page already contains the maximum number of blocks');
  const existing = new Set(target.blocks.map((item) => item.id));
  let blockId = block.id, suffix = 2;
  while (existing.has(blockId)) {
    const ending = `-${suffix++}`;
    blockId = `${block.id.slice(0, 120 - ending.length)}${ending}`;
  }
  const moved = { ...block, id: blockId, box: projectBlockoutBoxToPage(block.box, source, target).box };
  const answers = document.answers.map((answer) => {
    const match = (!answer.target.documentId || answer.target.documentId === document.documentId)
      && (answer.target.variantId ?? document.activeVariantId) === variant.id
      && answer.target.pageId === source.id && answer.target.blockId === block.id;
    return match ? { ...answer, target: { ...answer.target, variantId: variant.id, pageId: target.id, blockId } } : answer;
  });
  return { ...document,
    needsReadaptation: document.needsReadaptation || document.approval?.variantId === variant.id,
    variants: document.variants.map((item) => item.id !== variant.id ? item : { ...item, pages: item.pages.map((page) =>
      page.id === source.id ? { ...page, blocks: page.blocks.filter((item) => item.id !== block.id) }
        : page.id === target.id ? { ...page, blocks: [...page.blocks, moved] } : page) }),
    answers };
}

/** The caller supplies the complete permutation so an accidental omission cannot delete a page. */
export function reorderBlockoutPages(document: BlockoutDocument, variantId: string, orderedPageIds: string[]): BlockoutDocument {
  const variant = document.variants.find((item) => item.id === variantId);
  if (!variant) throw new Error('Blockout proposal is missing');
  const pages = new Map(variant.pages.map((page) => [page.id, page]));
  if (orderedPageIds.length !== pages.size || new Set(orderedPageIds).size !== pages.size || orderedPageIds.some((id) => !pages.has(id))) {
    throw new Error('Page order must include every page exactly once');
  }
  if (orderedPageIds.every((id, index) => variant.pages[index]!.id === id)) return document;
  return { ...document, needsReadaptation: document.needsReadaptation || document.approval?.variantId === variant.id,
    variants: document.variants.map((item) => item.id === variant.id ? { ...item, pages: orderedPageIds.map((id) => pages.get(id)!) } : item) };
}
