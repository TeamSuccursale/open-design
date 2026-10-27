import { z } from 'zod';
import type { ProjectDocument } from './project-documents.js';

export const HeaderFooterIdSchema = z.string().min(1).max(120).regex(/^[\w.-]+$/);
export const HeaderFooterTargetSchema = z.object({ documentId: HeaderFooterIdSchema, setId: HeaderFooterIdSchema.optional(), region: z.enum(['header', 'footer']), blockId: HeaderFooterIdSchema.optional() }).strict();
export type HeaderFooterTarget = z.infer<typeof HeaderFooterTargetSchema>;
const safeText = z.string().trim().max(12_000);
/** Values a page supplies to its recurring graphics: a field block prints one, a text block may name several as {field}. */
export const HEADER_FOOTER_FIELDS = ['projectName', 'documentName', 'pageNumber', 'totalPages', 'date', 'revision'] as const;
export type HeaderFooterField = typeof HEADER_FOOTER_FIELDS[number];
export const HeaderFooterBlockSchema = z.object({
  id: HeaderFooterIdSchema, region: z.enum(['header', 'footer']), kind: z.enum(['logo', 'text', 'field', 'rule']),
  x: z.number().finite().min(-1).max(2), y: z.number().finite().min(-1).max(2),
  width: z.number().finite().positive().max(2), height: z.number().finite().positive().max(2),
  text: safeText.optional(), field: z.enum(HEADER_FOOTER_FIELDS).optional(),
  assetId: HeaderFooterIdSchema.optional(), fontSize: z.number().min(5).max(72).optional(),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional(), align: z.enum(['left', 'center', 'right']).optional(),
  guidance: safeText.optional(), lockedRatio: z.boolean().optional(),
}).strict();
export type HeaderFooterBlock = z.infer<typeof HeaderFooterBlockSchema>;
export const HeaderFooterVariantSchema = z.object({
  id: HeaderFooterIdSchema, name: z.string().trim().min(1).max(120),
  pageWidthMm: z.number().min(80).max(1500), pageHeightMm: z.number().min(80).max(1500),
  headerHeightMm: z.number().min(0).max(180), footerHeightMm: z.number().min(0).max(180),
  blocks: z.array(HeaderFooterBlockSchema).max(120),
}).strict();
export type HeaderFooterVariant = z.infer<typeof HeaderFooterVariantSchema>;
export const HeaderFooterDraftSchema = z.object({
  version: z.literal(1), name: z.string().trim().min(1).max(240), guidance: safeText,
  logoPlan: z.enum(['provided', 'later', 'none']).optional(),
  stage: z.enum(['structural', 'graphic']), variants: z.array(HeaderFooterVariantSchema).min(1).max(20),
}).strict();
export type HeaderFooterDraft = z.infer<typeof HeaderFooterDraftSchema>;
export interface HeaderFooterRevision extends Omit<HeaderFooterDraft, 'version' | 'stage'> {
  id: number; setId: string; stage: 'graphic'; createdAt: string; originDocumentId?: string;
}
export interface HeaderFooterSet {
  id: string; name: string; draft: HeaderFooterDraft; draftVersion: number; revision: number;
  publishedRevision: HeaderFooterRevision | null; archivedAt: string | null; createdAt: string; updatedAt: string;
}
export interface HeaderFooterAsset {
  id: string; name: string; filename: string; mimeType: string; sha256: string; size: number;
  width?: number; height?: number; source: 'upload' | 'web'; sourceUrl?: string; organisation?: string; createdAt: string; url: string;
}
export interface HeaderFooterSearch {
  id: string; target: string; website?: string; guidance?: string;
  status: 'queued' | 'searching' | 'candidate' | 'ready' | 'failed' | 'cancelled';
  model: 'gpt-6.1-sol'; effort: 'low'; sessionId?: string; workerId?: string; attempt: number;
  assetIds: string[]; candidates?: { label: string; sourceUrl: string; assetId?: string }[];
  error?: string; createdAt: string; updatedAt: string;
}
export interface HeaderFooterBinding {
  documentId: string; setId: string | null; followUpdates: boolean; header: boolean; footer: boolean; showOnCover: boolean;
  version: number; appliedRevision: number | null; snapshot: HeaderFooterRevision | null;
  pendingRevision?: number; status: 'applied' | 'pending' | 'needs-review' | 'disabled'; error?: string; updatedAt: string;
}
export interface HeaderFooterTransaction {
  id: string; setId: string; revision: number; originDocumentId?: string; createdAt: string;
  status: 'applying' | 'applied' | 'pending'; documents: { documentId: string; status: 'pending' | 'applied' | 'needs-review' | 'superseded'; error?: string }[];
}
export interface HeaderFooterHistoryEntry { id: string; createdAt: string; action: string; setId?: string; documentIds: string[]; revision?: number; originDocumentId?: string }
export interface HeaderFooterDraftVersion { id: string; draft: HeaderFooterDraft; draftVersion: number; createdAt: string }
export interface HeaderFooterHistoryResponse { revisions: HeaderFooterRevision[]; drafts: HeaderFooterDraftVersion[] }
export interface HeaderFooterPageContext { documentId: string; totalPages?: number; initialFormat?: { widthMm: number; heightMm: number } }
/** A file in an already selected source folder, not a logo received by the library. */
export interface HeaderFooterSourceFile { id: string; name: string; relativePath: string; folder: string; size: number; kind: 'image' | 'zip' }
export interface HeaderFooterSourceFilesResponse { files: HeaderFooterSourceFile[]; truncated: boolean }
export const ImportHeaderFooterSourcesRequestSchema = z.object({ sourceIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(128) }).strict();
export interface HeaderFooterWorkspaceResponse {
  projectId: string; sets: HeaderFooterSet[]; bindings: HeaderFooterBinding[]; assets: HeaderFooterAsset[];
  searches: HeaderFooterSearch[]; documents: ProjectDocument[]; transactions: HeaderFooterTransaction[]; history: HeaderFooterHistoryEntry[];
  uploadErrors?: { name: string; error: string; createdAt: string }[];
  pageContexts?: HeaderFooterPageContext[];
}
export const CreateHeaderFooterSetRequestSchema = z.object({ name: z.string().trim().min(1).max(240), guidance: safeText.optional(), logoPlan: HeaderFooterDraftSchema.shape.logoPlan, variants: z.array(HeaderFooterVariantSchema).min(1).max(20).optional() }).strict();
export const SaveHeaderFooterDraftRequestSchema = z.object({ expectedDraftVersion: z.number().int().nonnegative(), draft: HeaderFooterDraftSchema }).strict();
export const ValidateHeaderFooterRequestSchema = z.object({ documentId: HeaderFooterIdSchema.optional(), expectedDraftVersion: z.number().int().nonnegative().optional() }).strict();
export interface ValidateHeaderFooterResponse { valid: true; setId: string; draftVersion: number; documentIds: string[] }
export const ApplyHeaderFooterRequestSchema = z.object({ setId: HeaderFooterIdSchema, revision: z.number().int().positive().optional(), followUpdates: z.boolean(), header: z.boolean(), footer: z.boolean(), showOnCover: z.boolean(), expectedBindingVersion: z.number().int().nonnegative().optional() }).strict();
export const PublishHeaderFooterRequestSchema = z.object({
  expectedDraftVersion: z.number().int().nonnegative(), expectedRevision: z.number().int().nonnegative(), stage: z.literal('graphic-approved'), originDocumentId: HeaderFooterIdSchema.optional(),
  binding: ApplyHeaderFooterRequestSchema.omit({ setId: true, revision: true }).extend({ documentId: HeaderFooterIdSchema }).optional(),
}).strict();
export const HeaderFooterSearchRequestSchema = z.object({ target: z.string().trim().min(1).max(500), website: z.string().url().max(2048).optional(), guidance: safeText.optional() }).strict();
export const HeaderFooterDetachRequestSchema = z.object({ expectedBindingVersion: z.number().int().nonnegative() }).strict();
export const RestoreHeaderFooterRequestSchema = z.object({ revision: z.number().int().positive(), expectedRevision: z.number().int().nonnegative(), expectedDraftVersion: z.number().int().nonnegative(), originDocumentId: HeaderFooterIdSchema.optional(), documentId: HeaderFooterIdSchema.optional() }).strict();
export type CreateHeaderFooterSetRequest = z.infer<typeof CreateHeaderFooterSetRequestSchema>;
export type SaveHeaderFooterDraftRequest = z.infer<typeof SaveHeaderFooterDraftRequestSchema>;
export type ValidateHeaderFooterRequest = z.infer<typeof ValidateHeaderFooterRequestSchema>;
export type PublishHeaderFooterRequest = z.infer<typeof PublishHeaderFooterRequestSchema>;
export type ApplyHeaderFooterRequest = z.infer<typeof ApplyHeaderFooterRequestSchema>;
export type HeaderFooterSearchRequest = z.infer<typeof HeaderFooterSearchRequestSchema>;
export type RestoreHeaderFooterRequest = z.infer<typeof RestoreHeaderFooterRequestSchema>;
export const HEADER_FOOTER_LINK_EXPLANATION = 'Se questa intestazione o questo piè di pagina viene modificato nell’editor o dall’agente, anche da un altro documento, le modifiche si applicano a tutti i documenti di questo progetto che usano lo stesso modello con questa opzione attiva. Se la disattivi, questo documento conserva una copia indipendente.';

export function headerFooterVariantForFormat(variants: readonly HeaderFooterVariant[], widthMm: number, heightMm: number): HeaderFooterVariant | null {
  return variants.find((variant) => Math.abs(variant.pageWidthMm - widthMm) < 1 && Math.abs(variant.pageHeightMm - heightMm) < 1) ?? null;
}
export function headerFooterBlockWarnings(block: HeaderFooterBlock): string[] {
  const warnings: string[] = [];
  if (block.x < 0 || block.y < 0 || block.x + block.width > 1.00001 || block.y + block.height > 1.00001) warnings.push('Il blocco supera il bordo sicuro della fascia.');
  if (block.kind === 'logo' && !block.assetId) warnings.push('Scegli il logo per questo blocco.');
  if (block.kind === 'text' && !block.text?.trim()) warnings.push('Inserisci il testo del blocco.');
  if (block.kind === 'field' && !block.field) warnings.push('Scegli il campo dinamico.');
  return warnings;
}
