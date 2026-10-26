import { z } from 'zod';

const identifier = z.string().min(1).max(120);
const pageNumbers = z.array(z.number().int().positive()).max(100_000);

export const DocumentResearchFindingSchema = z.object({
  text: z.string().trim().min(1).max(6000),
  sourceId: identifier,
  /** Physical PDF pages, starting at 1; never printed folio numbers. */
  pages: pageNumbers.min(1),
  certainty: z.enum(['observed', 'inferred', 'conflict']),
});
export type DocumentResearchFinding = z.infer<typeof DocumentResearchFindingSchema>;

export const DocumentResearchWorkerResultSchema = z.object({
  summary: z.string().max(3000),
  findings: z.array(DocumentResearchFindingSchema.omit({ sourceId: true }).extend({
    text: z.string().trim().min(1).max(3000), pages: pageNumbers.min(1).max(10),
  })).max(16),
});

export const DocumentResearchSourceSchema = z.object({
  id: identifier,
  title: z.string().min(1).max(1000),
  path: z.string().min(1).max(4096),
  root: z.string().min(1).max(4096),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  pagesTotal: z.number().int().nonnegative(),
});
export type DocumentResearchSource = z.infer<typeof DocumentResearchSourceSchema>;

export const DocumentResearchWorkerSchema = z.object({
  id: identifier,
  roleId: identifier,
  phase: z.enum(['quick', 'full']),
  status: z.enum(['queued', 'reading', 'complete', 'failed']),
  sourceId: identifier,
  pageFrom: z.number().int().positive(),
  pageTo: z.number().int().positive(),
  requestedModel: z.string().min(1).max(120).optional(),
  requestedEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']).optional(),
  findings: z.array(DocumentResearchFindingSchema).max(500).optional(),
  error: z.string().max(2000).optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
}).refine((worker) => worker.pageTo >= worker.pageFrom, { message: 'pageTo must follow pageFrom', path: ['pageTo'] });
export type DocumentResearchWorker = z.infer<typeof DocumentResearchWorkerSchema>;

export const DocumentResearchSourceCoverageSchema = z.object({
  sourceId: identifier,
  pagesTotal: z.number().int().nonnegative(),
  extractedPages: pageNumbers,
  analyzedPages: pageNumbers,
  unreadablePages: pageNumbers,
  pendingPages: pageNumbers,
});
export type DocumentResearchSourceCoverage = z.infer<typeof DocumentResearchSourceCoverageSchema>;

export const DocumentResearchCoverageSchema = z.object({
  sourcesTotal: z.number().int().nonnegative(),
  sourcesAnalyzed: z.number().int().nonnegative(),
  pagesTotal: z.number().int().nonnegative(),
  pagesExtracted: z.number().int().nonnegative(),
  pagesAnalyzed: z.number().int().nonnegative(),
  pagesUnreadable: z.number().int().nonnegative(),
  pendingPages: z.number().int().nonnegative(),
  sources: z.array(DocumentResearchSourceCoverageSchema).max(1000),
  /** Text analysis never certifies visual/OCR review of drawings or tables. */
  visual: z.literal('not-performed'),
});
export type DocumentResearchCoverage = z.infer<typeof DocumentResearchCoverageSchema>;

export const DocumentResearchRunSchema = z.object({
  version: z.literal(1),
  id: identifier,
  projectId: identifier.optional(),
  fingerprint: z.string().min(1).max(64),
  status: z.enum(['queued', 'quick', 'full', 'complete', 'partial', 'failed']),
  stage: z.enum(['quick', 'full']),
  model: z.literal('gpt-6.1-sol'),
  scope: z.literal('selected-project-documents'),
  question: z.string().max(12_000).optional(),
  sources: z.array(DocumentResearchSourceSchema).max(1000),
  /** Saved quick findings stay available while full source analysis runs. */
  overview: z.array(DocumentResearchFindingSchema).max(1000),
  findings: z.array(DocumentResearchFindingSchema).max(10_000),
  workers: z.array(DocumentResearchWorkerSchema).max(10_000),
  coverage: DocumentResearchCoverageSchema,
  warnings: z.array(z.string().max(4000)).max(1000),
  createdAt: z.string(),
  updatedAt: z.string(),
  quickCompletedAt: z.string().optional(),
  completedAt: z.string().optional(),
});
export type DocumentResearchRun = z.infer<typeof DocumentResearchRunSchema>;

export const StartDocumentResearchSchema = z.object({
  retry: z.boolean().default(false),
  sourcePaths: z.array(z.string().trim().min(1).max(4096)).min(1).max(12).optional(),
  question: z.string().trim().min(1).max(12_000).optional(),
}).strict();
export type StartDocumentResearch = z.infer<typeof StartDocumentResearchSchema>;
export interface DocumentResearchResponse { research: DocumentResearchRun | null }
