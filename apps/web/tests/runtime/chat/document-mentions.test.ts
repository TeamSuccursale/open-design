import { expect, it } from 'vitest';
import type { ProjectDocument } from '@open-design/contracts';
import { documentMentionEntities, filterMentionDocuments } from '../../../src/runtime/chat/document-mentions';
import { buildInlineMentionParts } from '../../../src/utils/inlineMentions';
const doc = (id: string, name: string, workingDirectory: string): ProjectDocument => ({ id, projectId: 'p', workspaceProjectId: 'p', name, kind: 'document', workingDirectory, folderMode: 'managed', availability: 'available', conversationIds: [], createdAt: '', updatedAt: '', archivedAt: null });
it('filters named documents across folders and excludes the active document', () => {
 const entities = documentMentionEntities([doc('a','Current','one'), doc('b','Technical report','nested/two')], 'a');
 expect(filterMentionDocuments(entities,'REPORT').map(item => item.id)).toEqual(['b']); expect(JSON.stringify(entities)).not.toContain('nested/two');
});
it('disambiguates duplicate names with stable IDs', () => {
 const entities = documentMentionEntities([doc('a','Report','one'),doc('b','Report','two')]);
 expect(entities.map(item => item.label)).toEqual(['Report [a]','Report [b]']);
 expect(buildInlineMentionParts('@Report [b]',entities)?.[0]).toMatchObject({ kind: 'mention', entity: { id: 'b', kind: 'document' } });
});
