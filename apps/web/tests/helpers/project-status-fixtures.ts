import type { DocumentResearchRun, ProjectIntakeCatalog } from '@open-design/contracts';
import type { CustodianStatusSnapshot, IntakeStatusSnapshot, ResearchStatusSnapshot } from '../../src/runtime/chat/project-preparation-status';

export const statusCatalog = (): ProjectIntakeCatalog => ({ version: 1, documents: [{ id: 'document', name: 'Survey.pdf', sourcePath: 'Survey.pdf', status: 'ready', pageCount: 2, completedPages: 2, indexedPages: [1, 2], updatedAt: '2026-10-23T12:00:00Z' }], assets: [] });
export const intakeSnapshot = (): IntakeStatusSnapshot => ({ catalog: statusCatalog(), loaded: true, error: false, launchError: false });
export const statusResearch = (): DocumentResearchRun => ({
  version: 1, id: 'research', projectId: 'project', fingerprint: 'a'.repeat(64), status: 'complete', stage: 'full', model: 'gpt-6.1-sol', scope: 'selected-project-documents',
  sources: [{ id: 'document', title: 'Survey.pdf', path: 'Survey.pdf', root: 'C:/Selected', sha256: 'b'.repeat(64), pagesTotal: 2 }], overview: [], findings: [], workers: [], warnings: [],
  coverage: { sourcesTotal: 1, sourcesAnalyzed: 1, pagesTotal: 2, pagesExtracted: 2, pagesAnalyzed: 2, pagesUnreadable: 0, pendingPages: 0, visual: 'not-performed', sources: [{ sourceId: 'document', pagesTotal: 2, extractedPages: [1, 2], analyzedPages: [1, 2], unreadablePages: [], pendingPages: [] }] },
  createdAt: '2026-10-23T12:00:00Z', updatedAt: '2026-10-23T12:00:00Z',
});
export const researchSnapshot = (): ResearchStatusSnapshot => ({ run: statusResearch(), busy: null, error: false, unavailable: false, pending: false });
export const custodianSnapshot = (): CustodianStatusSnapshot => ({ ledger: { version: 1, projectId: 'project', snapshotRevision: 'revision', textStatus: 'complete', imagesStatus: 'indexed', imageConsent: true, gaps: [], sources: [{ sourceId: 'document', title: 'Survey.pdf', path: 'Survey.pdf', sha256: 'b'.repeat(64), pagesTotal: 2, textAnalyzedPages: [1, 2], visualIndexedPages: [1, 2], assetIds: [], status: 'current' }] }, indexing: { indexing: false, phase: 'idle', queuedChanges: [], pendingDomains: [], message: '' }, error: false });
