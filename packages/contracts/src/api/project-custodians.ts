import { z } from 'zod';

export const CustodianDomainSchema = z.enum(['text', 'images']);
export const ProjectCustodianActivitySchema = z.object({ active: z.boolean() }).strict();
export type CustodianDomain = z.infer<typeof CustodianDomainSchema>;
export const AskProjectCustodianSchema = z.object({
  domain: CustodianDomainSchema,
  question: z.string().trim().min(1).max(12_000),
  limit: z.number().int().min(1).max(12).default(8),
}).strict();
export type AskProjectCustodian = z.infer<typeof AskProjectCustodianSchema>;
export const CustodianCitationSchema = z.object({
  sourceId: z.string().min(1).max(120), title: z.string().max(1000),
  page: z.number().int().positive().optional(), assetId: z.string().max(160).optional(),
});
export const CustodianAnswerSchema = z.object({
  answer: z.string().min(1).max(16_000),
  citations: z.array(CustodianCitationSchema).max(40),
  assetIds: z.array(z.string().min(1).max(160)).max(12),
  gaps: z.array(z.string().max(2000)).max(30),
}).strict();
/** Filled only by the daemon from verified catalog entries, never supplied by the model. */
export const CustodianAssetDescriptorSchema = z.object({
  id: z.string(), title: z.string(), kind: z.enum(['image', 'drawing', 'chart', 'table', 'page']),
  imagePath: z.string(), width: z.number().positive(), height: z.number().positive(),
  page: z.number().int().positive(), sourceName: z.string(), tableDataPath: z.string().optional(),
  tableDataComplete: z.boolean().optional(), metadataTruncated: z.boolean(),
  preferredVector: z.object({ path: z.string(), sha256: z.string(), reason: z.string() }).optional(),
  vectorVersions: z.array(z.object({ id: z.string(), path: z.string(), label: z.string(), sha256: z.string(), updatedAt: z.string() })).optional(),
});
export type CustodianAssetDescriptor = z.infer<typeof CustodianAssetDescriptorSchema>;
export type CustodianAnswer = z.infer<typeof CustodianAnswerSchema> & {
  domain: CustodianDomain; snapshotRevision: string; receiptId: string; assets?: CustodianAssetDescriptor[];
};
export interface CustodianSource {
  sourceId: string; title: string; path: string; sha256?: string; pagesTotal: number;
  textAnalyzedPages: number[]; visualIndexedPages: number[]; assetIds: string[];
  status: 'current' | 'changed' | 'unavailable' | 'unverified';
}
export interface ProjectCustodianLedger {
  version: 1; projectId?: string; snapshotRevision: string; sources: CustodianSource[];
  textStatus: string; imagesStatus: string; imageConsent: boolean; gaps: string[];
}
export interface ProjectCustodianLedgerResponse { ledger: ProjectCustodianLedger }
export interface ProjectCustodianAnswerResponse { result: CustodianAnswer }

export const CustodianIndexingStatusSchema = z.object({
  indexing: z.boolean(), phase: z.enum(['idle', 'checking', 'text', 'images', 'partial', 'failed']),
  lastCheckedAt: z.string().optional(), lastRevision: z.string().optional(),
  queuedChanges: z.array(z.string()), message: z.string(), pendingDomains: z.array(CustodianDomainSchema),
});
export type CustodianIndexingStatus = z.infer<typeof CustodianIndexingStatusSchema>;
export const CustodianJournalEventSchema = z.object({
  seq: z.number().int().positive(), at: z.string(), parentRevision: z.string().nullable(), revision: z.string(),
  domain: z.enum(['text', 'images', 'project']),
  type: z.enum(['sources-changed', 'index-started', 'index-completed', 'index-failed', 'query', 'correction', 'gap']),
  summary: z.string(), sourceIds: z.array(z.string()).optional(),
});
export const CustodianHistorySchema = z.object({
  events: z.array(CustodianJournalEventSchema), revision: z.string().nullable(), verified: z.literal(true),
});
export type CustodianHistory = z.infer<typeof CustodianHistorySchema>;
export const ProjectCustodianLedgerSchema = z.object({
  version: z.literal(1), projectId: z.string().optional(), snapshotRevision: z.string(),
  sources: z.array(z.object({
    sourceId: z.string(), title: z.string(), path: z.string(), sha256: z.string().optional(),
    pagesTotal: z.number().int().nonnegative(), textAnalyzedPages: z.array(z.number().int().positive()),
    visualIndexedPages: z.array(z.number().int().positive()), assetIds: z.array(z.string()),
    status: z.enum(['current', 'changed', 'unavailable', 'unverified']),
  })),
  textStatus: z.string(), imagesStatus: z.string(), imageConsent: z.boolean(), gaps: z.array(z.string()),
});
export const ProjectCustodianLedgerResponseSchema = z.object({
  ledger: ProjectCustodianLedgerSchema, indexing: CustodianIndexingStatusSchema.nullable().optional(),
});
export const ProjectCustodianHistoryResponseSchema = z.object({ history: CustodianHistorySchema });
export const ProjectCustodianActivityResponseSchema = z.object({ indexing: CustodianIndexingStatusSchema.nullable() });
export const ProjectCustodianAnswerResponseSchema = z.object({ result: CustodianAnswerSchema.extend({
  domain: CustodianDomainSchema, snapshotRevision: z.string(), receiptId: z.string(),
  assets: z.array(CustodianAssetDescriptorSchema).max(12).optional(),
}) });
