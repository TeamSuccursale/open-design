import type { ProjectMetadata } from '@open-design/contracts';
/** Document/editorial decisions always wait for the person, including Fast chats. */
export function allowQuestionTimeout(input: { documentPreparationPending?: boolean; projectMetadata?: ProjectMetadata; activeProjectDocumentId?: string | null; sessionMode?: string }): boolean {
  return !input.documentPreparationPending && input.projectMetadata?.projectMode !== 'fast' && input.projectMetadata?.intent !== 'document' && !input.projectMetadata?.documentSetupIntent && !input.activeProjectDocumentId && input.sessionMode !== 'blockout';
}
