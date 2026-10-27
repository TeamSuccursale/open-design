import { describe, expect, it } from 'vitest';
import { DOCUMENT_PRESENTATION_GROUPING_PROMPT } from '../src/api/document-presentation.js';
import { HEADER_FOOTER_WORKFLOW_DIRECTIVE, headerFooterWorkflowDirective } from '../src/prompts/header-footer.js';
import { composeSystemPrompt, type ComposeInput } from '../src/prompts/system.js';
import { composeOdNextStrategyStableRequestContextV2, type OdNextStrategyRequestRecipeV2 } from '../src/prompts/od-next-strategy.js';

const recipe: OdNextStrategyRequestRecipeV2 = {
  recipe: 'od-next-plan-build-v2', strategyId: 'od-next-strategy', strategyVersion: '2.0.0', snapshotId: 'header-footer-host-contract',
  packageHash: 'a'.repeat(64), taskProfileDigest: 'b'.repeat(64), taskProfileVersion: '2.0.0', taskType: 'prototype', executionProfile: 'filesystem',
  coreStrategy: '# Core', generalOrchestration: '# Orchestration', taskSkill: '# Editable document', activeStages: [
    { name: 'discovery', atoms: [{ name: 'discovery-question-form' }] },
    { name: 'plan', atoms: [{ name: 'direction-picker' }, { name: 'todo-write' }] },
    { name: 'generate', atoms: [{ name: 'file-write' }, { name: 'live-artifact' }] },
  ],
};
const paths: { name: string; input: ComposeInput }[] = [
  { name: 'API/BYOK legacy native', input: {} }, { name: 'API/BYOK legacy plain', input: { streamFormat: 'plain' } },
  { name: 'API/BYOK OD Next filesystem', input: { odNextStrategyRecipe: recipe } },
  { name: 'API/BYOK OD Next text artifact', input: { streamFormat: 'plain', odNextStrategyRecipe: { ...recipe, executionProfile: 'text_artifact' } } },
];
function expectWorkflow(prompt: string) {
  expect(prompt.match(/# Document headers and footers — before page Blockout/g)).toHaveLength(1);
  expect(prompt).toContain(DOCUMENT_PRESENTATION_GROUPING_PROMPT);
  expect(prompt).toContain('finish its real design before proposing the page-body Blockout');
  expect(prompt).toContain('one gpt-6.1-sol/low native session');
  expect(prompt).toContain('Ambiguous candidates need the user');
  expect(prompt).toContain('Aggiorna se viene modificato in futuro');
  expect(prompt).toContain('any other linked document');
  expect(prompt).toContain('headerFooterTarget:{documentId,setId,region:');
  expect(prompt).toContain('data-melillodesign-document-page=');
  expect(prompt).toContain('Do not publish a new shared revision merely to render new pages');
  expect(prompt).toContain('Do not attach the whole project gallery');
  expect(prompt).toContain('outside every user document workspace');
  expect(prompt).toContain('alternative composition selection belongs to the visual library picker');
  expect(prompt).toContain('Do not generate a standalone HTML comparison or parallel selection interface');
  expect(prompt).toContain('Do not add a separate chat question-form for graphic approval');
  expect(prompt).toContain('Internal read-only planning turns cannot execute acquisition or publish designs');
}

describe('canonical header/footer host workflow', () => {
  for (const path of paths) for (const fast of [false, true]) {
    const metadata = fast ? { kind: 'other' as const, projectMode: 'fast' as const } : { kind: 'other' as const };
    it(`carries editor, sharing, grouping and assets through ${path.name}, Fast=${fast}`, () => {
      const prompt = composeSystemPrompt({ ...path.input, agentId: 'codex', sessionMode: 'design', metadata }); expectWorkflow(prompt);
      if (fast) { expect(prompt).toContain('Fast mode still requires explicit editorial choices in chat'); expect(prompt).not.toContain('melillo_document_facts'); }
      if (!path.input.odNextStrategyRecipe) expect(prompt).toContain(HEADER_FOOTER_WORKFLOW_DIRECTIVE);
    });
    it(`keeps acquisition/publication out of read-only plan in ${path.name}, Fast=${fast}`, () => {
      const prompt = composeSystemPrompt({ ...path.input, agentId: 'codex', sessionMode: 'plan', metadata });
      expect(prompt).not.toContain('# Document headers and footers — before page Blockout');
      expect(prompt).not.toContain('one gpt-6.1-sol/low native session');
      expect(prompt).not.toContain('name="header-footer-workflow"');
    });
  }
  it('asks what an enabled region contains in the same form, prefilled with a proposal', () => {
    // A bare Sì/No per region left the contents to another full agent turn (about two minutes in the flow run).
    expect(HEADER_FOOTER_WORKFLOW_DIRECTIVE).toContain('shown only when that region is enabled');
    expect(HEADER_FOOTER_WORKFLOW_DIRECTIVE).toContain('prefilled with your proposal from the sources');
    expect(HEADER_FOOTER_WORKFLOW_DIRECTIVE).not.toContain('or the next one, when the region choice was just made');
  });
  it('asks every document in scope in one form instead of one form per document', () => {
    // Flow run 2 (27 October): the report's choices, the A3 booklet's choices and the region contents came as
    // three forms, each after a full agent turn of 1–2 minutes, because the rule spoke of a per-document group.
    expect(HEADER_FOOTER_WORKFLOW_DIRECTIVE).toContain('in ONE grouped chat question-form');
    expect(HEADER_FOOTER_WORKFLOW_DIRECTIVE).toContain('never one form per document');
    expect(DOCUMENT_PRESENTATION_GROUPING_PROMPT).not.toContain('This document-specific group may contain up to ten related controls');
    expect(DOCUMENT_PRESENTATION_GROUPING_PROMPT).toContain('do not split it by document');
  });
  it('keeps the shared grouped editorial rule in Blockout and the OD Next stable host context', () => {
    expectWorkflow(composeSystemPrompt({ sessionMode: 'blockout' }));
    const stable = composeOdNextStrategyStableRequestContextV2({ agentId: 'codex', sessionMode: 'blockout', metadata: { projectMode: 'fast' } });
    expectWorkflow(stable); expect(stable).toContain('name="header-footer-workflow"');
    expect(headerFooterWorkflowDirective('plan')).toBe('');
  });
});
