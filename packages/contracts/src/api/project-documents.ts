import { z } from 'zod';
import { DocumentPresentationSchema } from './document-presentation.js';
import type { DocumentPresentation } from './document-presentation.js';

export const ProjectDocumentIdSchema = z.string().min(1).max(120).regex(/^(?!\.{1,2}$)[\w.-]+$/);
const projectId = z.string().min(1).max(240);
export const ProjectDocumentReferenceSchema = z.object({ projectId, documentId: ProjectDocumentIdSchema }).strict();
export type ProjectDocumentReference = z.infer<typeof ProjectDocumentReferenceSchema>;
export const ProjectDocumentTypeSchema = z.object({ kind: z.enum(['report', 'tender-offer', 'tender-form', 'other', 'free']), subtype: z.string().trim().max(240) }).strict();
export const ProjectDocumentLocationSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('managed') }).strict(),
  z.object({ mode: z.literal('link-existing'), path: z.string().trim().min(1).max(2048), authorized: z.literal(true) }).strict(),
]);
export const ProjectDocumentSchema = z.object({
  id: ProjectDocumentIdSchema, projectId, workspaceProjectId: projectId,
  name: z.string().trim().min(1).max(240), kind: z.enum(['document', 'design']),
  workingDirectory: z.string().min(1).max(2048), folderMode: z.enum(['managed', 'linked']),
  availability: z.enum(['available', 'unavailable', 'broken-link']), availabilityMessage: z.string().optional(),
  aliasPath: z.string().optional(), blockoutDocumentId: ProjectDocumentIdSchema.optional(),
  /** Existing preview file, relative to workspaceProjectId; a rename does not move it. */
  entryFile: z.string().min(1).max(1024).optional(),
  conversationIds: z.array(z.string().min(1).max(240)).max(1000), presentation: DocumentPresentationSchema.optional(),
  /** Historical collection preparation remains reachable but is not this document's editing target. */
  preparationConversationIds: z.array(z.string().min(1).max(240)).max(1000).optional(),
  documentType: ProjectDocumentTypeSchema.optional(),
  createdAt: z.string(), updatedAt: z.string(), archivedAt: z.string().nullable(),
});
export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>;
/** A collection selection is navigation state; only a unique conversation binding establishes an editing target. */
export function projectDocumentForConversation(documents: readonly ProjectDocument[], workspaceProjectId: string, conversationId?: string | null): ProjectDocument | null {
  if (!conversationId) return null;
  const matches = documents.filter((document) => !document.archivedAt && document.workspaceProjectId === workspaceProjectId
    && document.conversationIds.includes(conversationId));
  return matches.length === 1 ? matches[0]! : null;
}
export interface ProjectDocumentCreation { requestId: string; documentId: string; name: string; startedAt: string; request: CreateProjectDocumentRequest }
export interface ProjectDocumentsResponse { documents: ProjectDocument[]; selectedDocumentId: string | null; pendingCreations?: ProjectDocumentCreation[] }
export const CreateProjectDocumentRequestSchema = z.object({
  name: ProjectDocumentSchema.shape.name, kind: ProjectDocumentSchema.shape.kind,
  location: ProjectDocumentLocationSchema.optional(), blockoutDocumentId: ProjectDocumentIdSchema.optional(),
  conversationId: z.string().min(1).max(240).optional(), presentation: DocumentPresentationSchema.optional(), select: z.boolean().optional(),
  documentType: ProjectDocumentTypeSchema.optional(),
  /** Reuse when retrying the same creation; another deliberate creation uses a new identity. */
  requestId: z.string().uuid().optional(),
}).strict();
export type CreateProjectDocumentRequest = z.infer<typeof CreateProjectDocumentRequestSchema>;
export const UpdateProjectDocumentRequestSchema = z.object({
  name: ProjectDocumentSchema.shape.name.optional(), archived: z.boolean().optional(), select: z.boolean().optional(),
  conversationId: z.string().min(1).max(240).optional(), location: ProjectDocumentLocationSchema.optional(),
  presentation: DocumentPresentationSchema.optional(),
  documentType: ProjectDocumentTypeSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Choose a document property to update');
export type UpdateProjectDocumentRequest = z.infer<typeof UpdateProjectDocumentRequestSchema>;
export interface ProjectDocumentFile { path: string; size: number }
export interface ProjectDocumentContextResponse {
  document: ProjectDocument; files: ProjectDocumentFile[]; truncated: boolean; limitations: string[];
  file?: { path: string; size: number; binary: boolean; text?: string; truncated: boolean };
  blockout?: { documentId: string; workspacePath: string; projectId: string; comparisonPath?: string };
}
export interface ProjectDocumentMutationResponse { document: ProjectDocument; selectedDocumentId: string | null }
export interface ProjectDocumentWorkspaceBootstrap {
  projectId: string; documentId: string; name: string; kind: ProjectDocument['kind']; workingDirectory: string; workspaceProjectId?: string;
  presentation?: DocumentPresentation;
  documentType?: z.infer<typeof ProjectDocumentTypeSchema>;
}
export interface ProjectDocumentWorkspaceResult { workspaceProjectId: string; conversationId?: string }
