import { describe, expect, it } from 'vitest';
import type { HeaderFooterSet, HeaderFooterWorkspaceResponse, ProjectDocument } from '@open-design/contracts';
import { createDocumentPresentation } from '@open-design/contracts';
import { headerFooterAwaitingReview, headerFooterCompanionDocuments, headerFooterReviewTarget, singleHeaderFooterProposal } from '../../src/components/header-footer/review-target';

const time = '2026-10-26T10:00:00.000Z';
const footer = { id: 'number', region: 'footer' as const, kind: 'field' as const, field: 'pageNumber' as const, x: .8, y: .2, width: .1, height: .5 };
function set(id: string, options: { stage?: 'structural' | 'graphic'; a3?: boolean; published?: boolean; updatedAt?: string } = {}): HeaderFooterSet {
  const variants = [{ id: 'a4', name: 'A4 verticale', pageWidthMm: 210, pageHeightMm: 297, headerHeightMm: 0, footerHeightMm: 14, blocks: [footer] },
    { id: 'a3', name: 'A3 orizzontale', pageWidthMm: 420, pageHeightMm: 297, headerHeightMm: 0, footerHeightMm: 14, blocks: options.a3 === false ? [] : [footer] }];
  return { id, name: id, draft: { version: 1, name: id, guidance: 'Numerazione a destra', stage: options.stage ?? 'graphic', variants }, draftVersion: 2, revision: options.published ? 1 : 0,
    publishedRevision: options.published ? { id: 1, setId: id, name: id, guidance: 'Numerazione a destra', stage: 'graphic', variants: structuredClone(variants), createdAt: time } : null, archivedAt: null, createdAt: time, updatedAt: options.updatedAt ?? time };
}
function document(id: string, name: string): ProjectDocument {
  return { id, projectId: 'project', workspaceProjectId: 'project', name, kind: 'document', workingDirectory: `/${id}`, folderMode: 'managed', availability: 'available', conversationIds: [], archivedAt: null, createdAt: time, updatedAt: time,
    presentation: { ...createDocumentPresentation(name), header: false, footer: true } };
}
function state(sets: HeaderFooterSet[]): HeaderFooterWorkspaceResponse {
  return { projectId: 'project', sets, bindings: [], assets: [], searches: [], transactions: [], history: [],
    documents: [document('report', 'Relazione B'), document('booklet', 'Fascicolo grafico B')],
    pageContexts: [{ documentId: 'report', totalPages: 8, initialFormat: { widthMm: 210, heightMm: 297 } }, { documentId: 'booklet', totalPages: 4, initialFormat: { widthMm: 420, heightMm: 297 } }] };
}

describe('header/footer proposals awaiting review', () => {
  it('treats unapproved graphics as awaiting review, but not structural drafts or an unchanged published design', () => {
    expect(headerFooterAwaitingReview(set('proposal'))).toBe(true);
    expect(headerFooterAwaitingReview(set('structure', { stage: 'structural' }))).toBe(false);
    expect(headerFooterAwaitingReview(set('applied', { published: true }))).toBe(false);
    const edited = set('edited', { published: true }); edited.draft.guidance = 'Numerazione al centro';
    expect(headerFooterAwaitingReview(edited)).toBe(true);
  });

  it('lands on a single proposal but leaves alternatives side by side', () => {
    expect(singleHeaderFooterProposal([set('one'), set('structure', { stage: 'structural' })])?.id).toBe('one');
    expect(singleHeaderFooterProposal([set('one'), set('two')])).toBeNull();
  });

  it('applies one approval to every waiting document whose format the design provides', () => {
    const current = state([set('shared')]);
    expect(headerFooterCompanionDocuments(current, current.sets[0]!.draft, 'report').map((item) => item.id)).toEqual(['booklet']);
    const withoutA3 = set('a4-only', { a3: false });
    expect(headerFooterCompanionDocuments(current, withoutA3.draft, 'report')).toEqual([]);
    current.bindings = [{ documentId: 'booklet', setId: null, followUpdates: false, header: false, footer: false, showOnCover: false, version: 1, appliedRevision: null, snapshot: null, status: 'disabled', updatedAt: time }];
    expect(headerFooterCompanionDocuments(current, current.sets[0]!.draft, 'report')).toEqual([]);
  });

  it('opens the proposal saved during the turn on a waiting document, and nothing for older drafts', () => {
    const since = Date.parse('2026-10-26T12:00:00.000Z');
    expect(headerFooterReviewTarget(state([set('old')]), since)).toBeNull();
    expect(headerFooterReviewTarget(state([set('fresh', { updatedAt: '2026-10-26T12:03:00.000Z' })]), since)).toEqual({ documentId: 'report', setId: 'fresh' });
  });

  it('opens the library when the turn saved alternatives, and the bound document when an applied design was edited', () => {
    const since = Date.parse('2026-10-26T12:00:00.000Z'), later = '2026-10-26T12:03:00.000Z';
    expect(headerFooterReviewTarget(state([set('first', { updatedAt: later }), set('second', { updatedAt: later })]), since)).toEqual({ documentId: 'report', setId: null });
    const edited = set('shared', { published: true, updatedAt: later }); edited.draft.guidance = 'Numerazione al centro';
    const current = state([edited]);
    current.bindings = [{ documentId: 'booklet', setId: 'shared', followUpdates: true, header: false, footer: true, showOnCover: false, version: 1, appliedRevision: 1, snapshot: edited.publishedRevision, status: 'applied', updatedAt: later }];
    expect(headerFooterReviewTarget(current, since)).toEqual({ documentId: 'booklet', setId: 'shared' });
  });
});
