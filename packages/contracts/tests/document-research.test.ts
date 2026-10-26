import { describe, expect, it } from 'vitest';
import {
  DocumentResearchCoverageSchema, DocumentResearchFindingSchema, DocumentResearchRunSchema,
  DocumentResearchWorkerSchema, StartDocumentResearchSchema,
} from '../src/api/document-research.js';

describe('document research contracts', () => {
  it('accepts a bounded document selection and defaults retry without accepting hidden options', () => {
    expect(StartDocumentResearchSchema.parse({ sourcePaths: ['disciplinare.pdf'], question: 'Find page limits' })).toEqual({ retry: false, sourcePaths: ['disciplinare.pdf'], question: 'Find page limits' });
    expect(StartDocumentResearchSchema.safeParse({ sourcePaths: Array(13).fill('source.pdf') }).success).toBe(false);
    expect(StartDocumentResearchSchema.safeParse({ sourcePaths: [] }).success).toBe(false);
    expect(StartDocumentResearchSchema.safeParse({ imageConsent: true }).success).toBe(false);
  });

  it('requires source pages and makes uncertainty explicit', () => {
    expect(DocumentResearchFindingSchema.parse({ text: 'A4', sourceId: 's1', pages: [3, 4], certainty: 'observed' }).pages).toEqual([3, 4]);
    expect(DocumentResearchFindingSchema.safeParse({ text: 'A4', sourceId: 's1', pages: [], certainty: 'observed' }).success).toBe(false);
    expect(DocumentResearchFindingSchema.safeParse({ text: 'A4', sourceId: 's1', pages: [0], certainty: 'confirmed' }).success).toBe(false);
    expect(DocumentResearchWorkerSchema.safeParse({ id: 'w1', roleId: 'text', phase: 'full', status: 'queued', sourceId: 's1', pageFrom: 3, pageTo: 2 }).success).toBe(false);
    expect(DocumentResearchWorkerSchema.parse({ id: 'w1', roleId: 'text', phase: 'full', status: 'queued', sourceId: 's1', pageFrom: 1, pageTo: 2, requestedModel: 'gpt-6.1-sol', requestedEffort: 'low' }).requestedEffort).toBe('low');
  });

  it('preserves a quick overview while full text analysis remains incomplete', () => {
    const coverage = {
      sourcesTotal: 1, sourcesAnalyzed: 0, pagesTotal: 3, pagesExtracted: 2, pagesAnalyzed: 1, pagesUnreadable: 1, pendingPages: 1,
      sources: [{ sourceId: 's1', pagesTotal: 3, extractedPages: [1, 2], analyzedPages: [1], unreadablePages: [3], pendingPages: [2] }], visual: 'not-performed',
    };
    const run = DocumentResearchRunSchema.parse({
      version: 1, id: 'run', fingerprint: 'a'.repeat(64), status: 'full', stage: 'full', model: 'gpt-6.1-sol', scope: 'selected-project-documents',
      sources: [{ id: 's1', title: 'Source', path: 'source.pdf', root: 'project', sha256: 'b'.repeat(64), pagesTotal: 3 }],
      overview: [{ text: 'Document overview', sourceId: 's1', pages: [1], certainty: 'observed' }], findings: [], workers: [], coverage,
      warnings: ['Page 3 requires OCR; visual review not performed'], createdAt: '2026-10-23T12:00:00Z', updatedAt: '2026-10-23T12:01:00Z', quickCompletedAt: '2026-10-23T12:00:30Z',
    });
    expect(run.overview).toHaveLength(1);
    expect(run.coverage.sources[0]?.pendingPages).toEqual([2]);
    expect(DocumentResearchCoverageSchema.safeParse({ ...coverage, visual: 'complete' }).success).toBe(false);
  });
});
