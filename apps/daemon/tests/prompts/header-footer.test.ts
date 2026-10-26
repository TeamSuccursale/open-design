import { describe, expect, it } from 'vitest';
import { DOCUMENT_PRESENTATION_GROUPING_PROMPT, HEADER_FOOTER_WORKFLOW_DIRECTIVE, type OdNextStrategyRequestRecipeV2 } from '@open-design/contracts';
import { composeSystemPrompt } from '../../src/prompts/system.js';

const recipe: OdNextStrategyRequestRecipeV2 = {
  recipe: 'od-next-plan-build-v2', strategyId: 'od-next-strategy', strategyVersion: '2.0.0', snapshotId: 'daemon-header-footer-host',
  packageHash: 'a'.repeat(64), taskProfileDigest: 'b'.repeat(64), taskProfileVersion: '2.0.0', taskType: 'prototype', executionProfile: 'filesystem',
  coreStrategy: '# Core', generalOrchestration: '# Orchestration', taskSkill: '# Editable document', activeStages: [
    { name: 'discovery', atoms: [{ name: 'discovery-question-form' }] },
    { name: 'plan', atoms: [{ name: 'direction-picker' }, { name: 'todo-write' }] },
    { name: 'generate', atoms: [{ name: 'file-write' }, { name: 'live-artifact' }] },
  ],
};
function expectWorkflow(prompt: string) {
  expect(prompt.match(/# Document headers and footers — before page Blockout/g)).toHaveLength(1);
  expect(prompt).toContain(DOCUMENT_PRESENTATION_GROUPING_PROMPT);
  expect(prompt).toContain('one gpt-6.1-sol/low native session');
  expect(prompt).toContain('headerFooterTarget:{documentId,setId,region:');
  expect(prompt).toContain('any other linked document');
  expect(prompt).toContain('Do not attach the whole project gallery');
  expect(prompt).toContain('Internal read-only planning turns cannot execute acquisition or publish designs');
  expect(prompt).toContain('Before requesting graphic-preview approval, run od header-footer validate');
}
describe('daemon header/footer prompt routing', () => {
  for (const promptCoreVariant of ['classic', 'slim'] as const) for (const streamFormat of ['ndjson', 'plain']) for (const fast of [false, true]) {
    const metadata = fast ? { kind: 'other' as const, projectMode: 'fast' as const } : { kind: 'other' as const };
    it(`exposes the canonical workflow in ${promptCoreVariant}/${streamFormat}, Fast=${fast}`, () => {
      const prompt = composeSystemPrompt({ agentId: 'codex', sessionMode: 'design', promptCoreVariant, streamFormat, metadata });
      expectWorkflow(prompt); expect(prompt).toContain(HEADER_FOOTER_WORKFLOW_DIRECTIVE);
      if (fast) { expect(prompt).toContain('Fast mode still requires explicit editorial choices in chat'); expect(prompt).not.toContain('melillo_document_facts'); }
    });
    it(`excludes acquisition/publication in ${promptCoreVariant}/${streamFormat} plan, Fast=${fast}`, () => {
      const prompt = composeSystemPrompt({ agentId: 'codex', sessionMode: 'plan', promptCoreVariant, streamFormat, metadata });
      expect(prompt).not.toContain('# Document headers and footers — before page Blockout'); expect(prompt).not.toContain('one gpt-6.1-sol/low native session');
    });
  }
  it.each([false, true].flatMap((fast) => (['filesystem', 'text_artifact'] as const).map((executionProfile) => ({ fast, executionProfile }))))('crosses the daemon OD Next early-return fork, Fast=$fast/$executionProfile', ({ fast, executionProfile }) => {
    const metadata = fast ? { kind: 'other' as const, projectMode: 'fast' as const } : { kind: 'other' as const };
    const prompt = composeSystemPrompt({ odNextStrategyRecipe: { ...recipe, executionProfile }, agentId: 'codex', sessionMode: 'design', metadata });
    expectWorkflow(prompt); expect(prompt).toContain('name="header-footer-workflow"');
    const plan = composeSystemPrompt({ odNextStrategyRecipe: { ...recipe, executionProfile }, agentId: 'codex', sessionMode: 'plan', metadata });
    expect(plan).not.toContain('name="header-footer-workflow"'); expect(plan).not.toContain('one gpt-6.1-sol/low native session');
  });
  it.each(['classic', 'slim'] as const)('keeps grouped editorial questions and recurring-region markup in %s Blockout', (promptCoreVariant) => {
    const prompt = composeSystemPrompt({ sessionMode: 'blockout', promptCoreVariant }); expectWorkflow(prompt);
    expect(prompt).toContain('data-melillodesign-document-page='); expect(prompt).toContain('Do not publish a new shared revision merely to render new pages');
  });
});
