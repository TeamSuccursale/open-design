import { describe, expect, it } from 'vitest';
import { projectPreparationSources } from '../../../src/runtime/chat/project-preparation-sources';
import { custodianSnapshot, intakeSnapshot, researchSnapshot } from '../../helpers/project-status-fixtures';

describe('source coverage in the first level of the status drawer', () => {
  it('joins the same source across streams without requiring nested disclosures', () => {
    expect(projectPreparationSources(intakeSnapshot(), researchSnapshot(), custodianSnapshot())).toEqual([
      { path: 'Survey.pdf', title: 'Survey.pdf', total: 2, textPages: 2, imagePages: 2, stale: false, failed: false },
    ]);
  });
  it('does not merge same-named files from different context folders', () => {
    const research = researchSnapshot(); research.run!.sources[0]!.path = 'C:/First/Survey.pdf';
    const custody = custodianSnapshot(); custody.ledger!.sources[0]!.path = 'C:/Second/Survey.pdf';
    expect(projectPreparationSources(null, research, custody).map((source) => source.path)).toEqual(['C:/First/Survey.pdf', 'C:/Second/Survey.pdf']);
  });
  it('does not let an old successful text scan hide a changed source', () => {
    const custody = custodianSnapshot(); custody.ledger!.sources[0]!.status = 'changed'; custody.ledger!.sources[0]!.textAnalyzedPages = [];
    expect(projectPreparationSources(intakeSnapshot(), researchSnapshot(), custody)[0]).toMatchObject({ textPages: 0, stale: true });
  });
  it('counts only unique verified page numbers, never completed-page estimates', () => {
    const intake = intakeSnapshot(); intake.catalog.documents[0]!.indexedPages = [1, 1, 99];
    expect(projectPreparationSources(intake, null, null)[0]).toMatchObject({ imagePages: 1, textPages: 0, total: 2 });
  });
});
