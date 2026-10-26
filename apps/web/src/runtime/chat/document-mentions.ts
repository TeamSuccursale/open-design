import type { ProjectDocument } from '@open-design/contracts';
import { inlineMentionToken, type InlineMentionEntity } from '../../utils/inlineMentions';

/** Named app documents remain references; their folders never become attachments. */
export function documentMentionEntities(documents: readonly ProjectDocument[], currentId?: string | null): InlineMentionEntity[] {
  const visible = documents.filter(document => !document.archivedAt && document.id !== currentId && document.availability === 'available');
  const names = new Map<string, number>();
  for (const document of visible) names.set(document.name.toLocaleLowerCase(), (names.get(document.name.toLocaleLowerCase()) ?? 0) + 1);
  return visible.map(document => {
    const label = (names.get(document.name.toLocaleLowerCase()) ?? 0) > 1 ? `${document.name} [${document.id}]` : document.name;
    return { id: document.id, kind: 'document', label, token: inlineMentionToken(label), title: document.name };
  });
}
export function filterMentionDocuments(entities: readonly InlineMentionEntity[], query: string): InlineMentionEntity[] {
  const normalized = query.trim().toLocaleLowerCase();
  return entities.filter(entity => entity.label.toLocaleLowerCase().includes(normalized));
}
