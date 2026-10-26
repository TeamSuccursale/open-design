import { z } from 'zod';
import { BlockoutBoxSchema, type BlockoutDocument } from './blockout.js';
import { BlockoutDesignBaseSchema, BlockoutHandoffSnapshotSchema, blockoutHandoffSnapshot } from './blockout-handoff.js';

const id = z.string().min(1).max(120).regex(/^(?!\.{1,2}$)[\w.-]+$/);
const file = z.string().min(1).max(2000).refine((value) => !/^(?:[a-z]+:|[\\/])/i.test(value) && !value.replaceAll('\\', '/').split('/').some((part) => part === '..' || part === '.'), 'Expected a project-relative file');
export const BlockoutDesignPageSchema = z.object({
  pageId: id, filePath: file, widthPx: z.number().positive().max(16000), heightPx: z.number().positive().max(16000),
  // Conceptual content bounds, not a mandatory DOM grid. Decorative layers need no mapping.
  blocks: z.array(z.object({ blockId: id, box: BlockoutBoxSchema })).max(200),
});
export const BlockoutDesignRecordRequestSchema = z.object({
  handoffId: id, runId: z.string().min(1).max(240), entryFile: file,
  pages: z.array(BlockoutDesignPageSchema).min(1).max(60), files: z.array(file).max(140).default([]),
}).strict();
export type BlockoutDesignRecordRequest = z.infer<typeof BlockoutDesignRecordRequestSchema>;
export const BlockoutDesignRevisionSchema = BlockoutDesignBaseSchema.extend({
  createdAt: z.string(), baseDesignRevisionId: id.nullable(), inputDigest: z.string(),
  /** Validated run owner; a collection chat may target an explicitly attached child document. */
  runProjectId: z.string().min(1).max(240).optional(),
  handoffSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  requested: BlockoutHandoffSnapshotSchema, pages: z.array(BlockoutDesignPageSchema).max(60),
  status: z.enum(['pending', 'applied', 'failed', 'superseded', 'source-changed']),
});
export type BlockoutDesignRevision = z.infer<typeof BlockoutDesignRevisionSchema>;
export const BlockoutDesignStateSchema = z.object({
  version: z.literal(1), documentId: id, applied: BlockoutDesignRevisionSchema.nullable(),
  pending: z.array(BlockoutDesignRevisionSchema).max(20),
  sourceChanged: z.boolean(), pendingChanges: z.boolean(),
});
export type BlockoutDesignState = z.infer<typeof BlockoutDesignStateSchema>;
export interface BlockoutDesignUnderlay { revisionId: string; pageId: string; html: string; filePath: string; widthPx: number; heightPx: number }

/** Adopt realized bounds only if no newer composition edit exists, including an unsaved local edit. */
export function adoptAppliedBlockoutDesign(document: BlockoutDocument, applied: BlockoutDesignRevision): BlockoutDocument {
  if (document.documentId !== applied.snapshot.documentId || !document.variants.some((variant) => variant.id === applied.requested.variant.id)) return document;
  const comparable = (value: BlockoutDesignRevision['snapshot']) => {
    const { approval: _approval, needsReadaptation: _readaptation, ...layout } = value;
    return JSON.stringify(layout);
  };
  const snapshot = blockoutHandoffSnapshot({ ...document, activeVariantId: applied.requested.variant.id });
  if (comparable(snapshot) !== comparable(applied.requested)) return document;
  const next = { ...document, needsReadaptation: false, variants: document.variants.map((variant) => variant.id === applied.snapshot.variant.id ? applied.snapshot.variant : variant) };
  return JSON.stringify(next) === JSON.stringify(document) ? document : next;
}
