import { describe, expect, it } from 'vitest';
import { projectPreparationStatus } from '../../../src/runtime/chat/project-preparation-status';
import { custodianSnapshot, intakeSnapshot, researchSnapshot } from '../../helpers/project-status-fixtures';

describe('truthful compact project intake indicators', () => {
  it('keeps completed 3/3 text and 2/2 visual pages ready when a partial pass has only qualitative table-review gaps', () => {
    const custody = custodianSnapshot(), text = researchSnapshot(), images = intakeSnapshot();
    text.run!.coverage.pagesTotal = 3; text.run!.coverage.pagesAnalyzed = 3; text.run!.coverage.pagesExtracted = 3;
    text.run!.coverage.sourcesTotal = 2; text.run!.coverage.sourcesAnalyzed = 2;
    custody.ledger!.sources.push({ sourceId: 'instructions', title: 'Instructions.txt', path: 'Instructions.txt', pagesTotal: 1, textAnalyzedPages: [1], visualIndexedPages: [], assetIds: [], status: 'current' });
    custody.ledger!.gaps = ['Two table transcriptions are incomplete.', 'Visual indexing does not verify every table cell.'];
    custody.indexing = { indexing: false, phase: 'partial', queuedChanges: [], pendingDomains: [], message: 'Some sources still need indexing or review.' };
    expect(projectPreparationStatus(images, text, custody)).toEqual({ text: 'ready', images: 'ready' });
    expect(projectPreparationStatus(images, null, custody)).toEqual({ text: 'ready', images: 'ready' });
    expect(custody.ledger!.gaps).toEqual(['Two table transcriptions are incomplete.', 'Visual indexing does not verify every table cell.']);
    text.run!.coverage.pendingPages = 1; text.run!.coverage.pagesAnalyzed = 2;
    expect(projectPreparationStatus(images, text, custody).text).not.toBe('ready');
  });
  it('still flags a failed job of unknown domain even with older completed page coverage', () => {
    const custody = custodianSnapshot();
    custody.indexing = { indexing: false, phase: 'failed', queuedChanges: [], pendingDomains: [], message: 'Index process failed.' };
    expect(projectPreparationStatus(intakeSnapshot(), researchSnapshot(), custody)).toEqual({ text: 'attention', images: 'attention' });
  });
  it.each(['text', 'images'] as const)('keeps an explicitly unfinished partial %s domain separate from the completed other domain', (domain) => {
    const custody = custodianSnapshot();
    custody.indexing = { indexing: false, phase: 'partial', queuedChanges: ['Survey.pdf'], pendingDomains: [domain], message: 'The queued domain still needs indexing.' };
    expect(projectPreparationStatus(intakeSnapshot(), researchSnapshot(), custody)).toEqual(domain === 'text' ? { text: 'attention', images: 'ready' } : { text: 'ready', images: 'attention' });
    custody.indexing.phase = 'checking'; custody.indexing.indexing = true;
    expect(projectPreparationStatus(intakeSnapshot(), researchSnapshot(), custody)).toEqual(domain === 'text' ? { text: 'working', images: 'ready' } : { text: 'ready', images: 'working' });
  });
  it('does not conceal actual visual job failures behind a partial quality-review state', () => {
    const custody = custodianSnapshot(), images = intakeSnapshot();
    custody.indexing = { indexing: false, phase: 'partial', queuedChanges: [], pendingDomains: [], message: 'Review gaps.' };
    images.catalog.documents[0]!.status = 'failed';
    expect(projectPreparationStatus(images, researchSnapshot(), custody)).toEqual({ text: 'ready', images: 'attention' });
  });
  it('does not describe a queued future image check as active before image consent', () => {
    const custody = custodianSnapshot(); custody.ledger!.imageConsent = false;
    custody.indexing = { indexing: true, phase: 'checking', queuedChanges: ['Survey.pdf'], pendingDomains: ['images'], message: 'Checking sources.' };
    expect(projectPreparationStatus(null, researchSnapshot(), custody).images).toBe('waiting');
  });
  it('waits when no coverage is known and requires completed text and image coverage for ready', () => {
    expect(projectPreparationStatus(null, null, null)).toEqual({ text: 'waiting', images: 'waiting' });
    expect(projectPreparationStatus(intakeSnapshot(), researchSnapshot(), custodianSnapshot())).toEqual({ text: 'ready', images: 'ready' });
    const text = researchSnapshot(); text.run!.coverage.pendingPages = 1; text.run!.coverage.pagesAnalyzed = 1;
    const image = intakeSnapshot(); image.catalog.documents[0]!.pageCount = 0;
    expect(projectPreparationStatus(image, text, null)).toEqual({ text: 'waiting', images: 'waiting' });
    expect(projectPreparationStatus(image, text, custodianSnapshot())).toEqual({ text: 'waiting', images: 'waiting' });
  });
  it('does not show cached image success before the actual intake catalog has loaded', () => {
    expect(projectPreparationStatus(null, null, custodianSnapshot()).images).toBe('waiting');
  });
  it('keeps active jobs separate from completion and failures visible even when other material is ready', () => {
    const image = intakeSnapshot(); image.catalog.documents[0]!.status = 'processing';
    const text = researchSnapshot(); text.run!.status = 'full';
    expect(projectPreparationStatus(image, text, null)).toEqual({ text: 'working', images: 'working' });
    image.catalog.documents[0]!.status = 'failed'; text.run!.status = 'partial';
    expect(projectPreparationStatus(image, text, null)).toEqual({ text: 'attention', images: 'attention' });
    expect(projectPreparationStatus({ ...intakeSnapshot(), launchError: true }, researchSnapshot(), null)).toEqual({ text: 'ready', images: 'attention' });
  });
  it('does not trust completed indexes whose source changed or whose verification failed', () => {
    const sources = custodianSnapshot(); sources.ledger!.sources[0]!.status = 'changed';
    expect(projectPreparationStatus(intakeSnapshot(), researchSnapshot(), sources)).toEqual({ text: 'attention', images: 'attention' });
    expect(projectPreparationStatus(intakeSnapshot(), researchSnapshot(), { ...custodianSnapshot(), error: true })).toEqual({ text: 'attention', images: 'attention' });
  });
});
