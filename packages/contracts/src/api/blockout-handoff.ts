import { z } from 'zod';
import { BlockoutDocumentSchema, BlockoutPageSchema, type BlockoutAlternativeBatch, type BlockoutDocument } from './blockout.js';
import type { BlockoutWorkspaceResponse } from './blockout-files.js';

const identity = z.string().min(1).max(120).regex(/^(?!\.{1,2}$)[\w.-]+$/);
export const BlockoutHandoffActionSchema = z.enum(['request-proposals', 'develop-design', 'update-design']);
export type BlockoutHandoffAction = z.infer<typeof BlockoutHandoffActionSchema>;
export const BlockoutAlternativeOperationSchema = z.object({
  type: z.literal('append-alternatives'), count: z.number().int().min(1).max(3), instruction: z.string().max(12_000).default(''),
});
export type BlockoutAlternativeOperation = z.infer<typeof BlockoutAlternativeOperationSchema>;
export const BlockoutHandoffRequestSchema = z.object({
  document: BlockoutDocumentSchema,
  baseRaw: z.string().max(2_000_000).optional(),
  action: BlockoutHandoffActionSchema.optional(),
  operation: BlockoutAlternativeOperationSchema.optional(),
  requestId: identity.optional(), variantId: identity.optional(),
});
export type BlockoutHandoffRequest = z.infer<typeof BlockoutHandoffRequestSchema>;
export const BlockoutAppendAlternativesRequestSchema = z.object({
  requestId: identity,
  candidates: z.array(z.object({ label: z.string().min(1).max(240), pages: z.array(BlockoutPageSchema).min(1).max(60) }).strict()).min(1).max(3),
}).strict();
export type BlockoutAppendAlternativesRequest = z.infer<typeof BlockoutAppendAlternativesRequestSchema>;
export interface BlockoutAppendAlternativesResponse extends BlockoutWorkspaceResponse {
  alternativeBatch: BlockoutAlternativeBatch & { replayed: boolean };
}

/** A structural snapshot contains geometry, intentions and file references, never image binaries. */
export function blockoutHandoffSnapshot(document: BlockoutDocument): BlockoutHandoffSnapshot {
  const doc = BlockoutDocumentSchema.parse(document);
  return {
    documentId: doc.documentId, title: doc.title, presentation: doc.presentation, planningStage: doc.planningStage ?? 'structure', pageBudget: doc.pageBudget,
    materialRevision: doc.materialRevision, materialIds: doc.materialIds,
    variant: doc.variants.find((variant) => variant.id === doc.activeVariantId)!,
    approval: doc.approval, needsReadaptation: doc.needsReadaptation,
    answers: doc.answers.filter((answer) => !answer.target.variantId || answer.target.variantId === doc.activeVariantId),
  };
}
export type BlockoutHandoffSnapshot = z.infer<typeof BlockoutHandoffSnapshotSchema>;
export interface BlockoutHandoffChange {
  target: 'document' | 'proposal' | 'page' | 'block';
  operation: 'add' | 'remove' | 'update';
  pageId?: string; blockId?: string; fields: string[];
  before?: unknown; after?: unknown;
}

/** Compare semantic identities so reordering does not become a mass delete/add. */
export function diffBlockoutSnapshots(before: BlockoutHandoffSnapshot, after: BlockoutHandoffSnapshot): BlockoutHandoffChange[] {
  const changes: BlockoutHandoffChange[] = [];
  function updated(target: Omit<BlockoutHandoffChange, 'operation' | 'fields'>, oldValue: object, newValue: object) {
    const old = oldValue as Record<string, unknown>, next = newValue as Record<string, unknown>;
    const fields = [...new Set([...Object.keys(old), ...Object.keys(next)])].filter((key) => JSON.stringify(old[key]) !== JSON.stringify(next[key]));
    if (fields.length) changes.push({ ...target, operation: 'update', fields,
      before: Object.fromEntries(fields.map((key) => [key, old[key] ?? null])), after: Object.fromEntries(fields.map((key) => [key, next[key] ?? null])) });
  }
  const { variant: oldVariant, ...oldDoc } = before, { variant: newVariant, ...newDoc } = after;
  updated({ target: 'document' }, oldDoc, newDoc);
  updated({ target: 'proposal' }, { label: oldVariant.label, pageOrder: oldVariant.pages.map((page) => page.id) },
    { label: newVariant.label, pageOrder: newVariant.pages.map((page) => page.id) });
  for (const pageId of new Set([...oldVariant.pages, ...newVariant.pages].map((page) => page.id))) {
    const old = oldVariant.pages.find((page) => page.id === pageId), next = newVariant.pages.find((page) => page.id === pageId);
    if (!old || !next) { changes.push({ target: 'page', pageId, operation: old ? 'remove' : 'add', fields: [], ...(old ? { before: old } : { after: next }) }); continue; }
    const { blocks: oldBlocks, ...oldPage } = old, { blocks: newBlocks, ...newPage } = next;
    updated({ target: 'page', pageId }, { ...oldPage, blockOrder: oldBlocks.map((block) => block.id) }, { ...newPage, blockOrder: newBlocks.map((block) => block.id) });
    for (const blockId of new Set([...oldBlocks, ...newBlocks].map((block) => block.id))) {
      const oldBlock = oldBlocks.find((block) => block.id === blockId), newBlock = newBlocks.find((block) => block.id === blockId);
      if (!oldBlock || !newBlock) changes.push({ target: 'block', pageId, blockId, operation: oldBlock ? 'remove' : 'add', fields: [], ...(oldBlock ? { before: oldBlock } : { after: newBlock }) });
      else updated({ target: 'block', pageId, blockId }, oldBlock, newBlock);
    }
  }
  return changes;
}

const documentFields = BlockoutDocumentSchema.innerType().shape;
export const BlockoutHandoffSnapshotSchema = z.object({
  documentId: identity, title: documentFields.title, presentation: documentFields.presentation, planningStage: documentFields.planningStage, pageBudget: documentFields.pageBudget, materialRevision: documentFields.materialRevision, materialIds: documentFields.materialIds,
  variant: z.object({ id: identity, label: z.string(), pages: z.array(BlockoutPageSchema) }),
  approval: documentFields.approval, needsReadaptation: z.boolean(), answers: documentFields.answers,
});
export const BlockoutDesignFileSchema = z.object({ path: z.string().min(1).max(2000), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export const BlockoutDesignBaseSchema = z.object({
  revisionId: identity, handoffId: identity, runId: z.string().min(1).max(240), entryFile: z.string().min(1).max(2000),
  files: z.array(BlockoutDesignFileSchema).max(200), snapshot: BlockoutHandoffSnapshotSchema,
});
export const BlockoutHandoffSchema = z.object({
  version: z.literal(1), type: z.literal('blockout-update'), id: identity,
  action: BlockoutHandoffActionSchema, createdAt: z.string(), workspacePath: z.string(), workspaceRevision: z.string(),
  operation: BlockoutAlternativeOperationSchema.optional(),
  previousHandoffId: identity.nullable(), previousWorkspaceRevision: z.string().nullable(),
  comparison: z.enum(['initial', 'same-proposal', 'different-proposal']),
  snapshot: BlockoutHandoffSnapshotSchema,
  comparisonBasis: z.enum(['previous-handoff', 'applied-design']).optional(),
  designBase: BlockoutDesignBaseSchema.optional(),
  changes: z.array(z.object({ target: z.enum(['document', 'proposal', 'page', 'block']), operation: z.enum(['add', 'remove', 'update']),
    pageId: identity.optional(), blockId: identity.optional(), fields: z.array(z.string()), before: z.unknown().optional(), after: z.unknown().optional() })),
});
export interface BlockoutHandoff extends Omit<z.infer<typeof BlockoutHandoffSchema>, 'snapshot'> { snapshot: BlockoutHandoffSnapshot }
export interface BlockoutHandoffResponse { handoff: BlockoutHandoff; path: string }
