import { describe, expect, it } from 'vitest';
import { composeSystemPrompt } from '../src/prompts/system.js';
import { BLOCKOUT_ALTERNATIVES_DIRECTIVE, BLOCKOUT_MODE_DIRECTIVE, BLOCKOUT_DESIGN_DIRECTIVE, ENGINEER_GRAPHICS_SKILL_SCOPE } from '../src/prompts/blockout-mode.js';
import { composeOdNextStrategyRequestPromptV2, type OdNextStrategyRequestRecipeV2 } from '../src/prompts/od-next-strategy.js';

const recipe: OdNextStrategyRequestRecipeV2 = {
  recipe: 'od-next-plan-build-v2',
  strategyId: 'od-next-strategy',
  strategyVersion: '2.0.0',
  snapshotId: 'blockout-test',
  packageHash: 'a'.repeat(64),
  taskProfileDigest: 'b'.repeat(64),
  taskProfileVersion: '2.0.0',
  taskType: 'prototype',
  executionProfile: 'filesystem',
  coreStrategy: '# Core\nBuild the requested deliverable.',
  generalOrchestration: '# Orchestration\nPlan, then Build.',
  taskSkill: '# Prototype\nCreate the requested artifact.',
  activeStages: [
    { name: 'discovery', atoms: [{ name: 'discovery-question-form' }] },
    { name: 'plan', atoms: [{ name: 'direction-picker' }, { name: 'todo-write' }] },
    { name: 'generate', atoms: [{ name: 'file-write' }, { name: 'live-artifact' }] },
  ],
};

describe('Blockout mode across prompt stacks', () => {
  it('talks to the engineer about the document, not the machinery', () => {
    // Live run, 27 Oct 2026: the preparation turn told the engineer "Uso la skill linguaggio-umano per le indicazioni in italiano".
    expect(ENGINEER_GRAPHICS_SKILL_SCOPE).toContain('without naming skills, tools, commands or internal files');
  });
  it.each(['legacy BYOK', 'OD Next BYOK', 'OD Next filesystem'] as const)('names proposals as the comparison shows them in %s', (path) => {
    // The agent wrote "proposta A" while the screen said "Lettura continua", and a blind reader lost track of which structure changed.
    const prompt = path === 'OD Next filesystem'
      ? composeOdNextStrategyRequestPromptV2(recipe, { sessionMode: 'blockout' })
      : composeSystemPrompt({
        sessionMode: 'blockout',
        ...(path === 'OD Next BYOK' ? { odNextStrategyRecipe: { ...recipe, executionProfile: 'text_artifact' } } : {}),
      });
    expect(prompt).toContain('call a proposal by that label exactly as the comparison shows it, never by a letter, a number or its id');
  });
  it('keeps design revision and page-wide decoration free across both composers', () => {
    for (const prompt of [composeSystemPrompt({ sessionMode: 'design' }), composeOdNextStrategyRequestPromptV2(recipe, { sessionMode: 'design' })]) {
      expect(prompt).toContain(BLOCKOUT_DESIGN_DIRECTIVE);
      expect(prompt).toContain('need no block'); expect(prompt).toContain('designBase.snapshot'); expect(prompt).toContain('design-record');
    }
  });
  it.each(['legacy BYOK', 'OD Next BYOK', 'OD Next filesystem'] as const)('carries the same structural scope in %s', (path) => {
    const prompt = path === 'OD Next filesystem'
      ? composeOdNextStrategyRequestPromptV2(recipe, { sessionMode: 'blockout' })
      : composeSystemPrompt({
        sessionMode: 'blockout',
        ...(path === 'OD Next BYOK' ? { odNextStrategyRecipe: { ...recipe, executionProfile: 'text_artifact' } } : {}),
      });
    expect(prompt).toContain(BLOCKOUT_MODE_DIRECTIVE);
    expect(prompt).toContain(BLOCKOUT_ALTERNATIVES_DIRECTIVE);
    expect(prompt).toContain('od blockout request-alternatives');
    expect(prompt).toContain('od blockout append-alternatives');
    expect(prompt).toContain('blockout-comparison.html');
    expect(prompt).toContain('The engineer owns the supplied text, data, technical meaning and decisions.');
    expect(prompt).toContain('Do not claim parallel execution without evidence');
    expect(prompt).toContain('Stop after the blockout comparison.');
    expect(prompt).toContain(ENGINEER_GRAPHICS_SKILL_SCOPE);
    expect(prompt).toContain('Do not open, load, invoke, apply or delegate ANY gare-* skill');
    expect(prompt).toContain('impaginazione-elaborati-strutturali');
    expect(prompt).toContain('linguaggio-umano remains allowed');
    expect(prompt).toContain('every native worker or delegated proposal');
    expect(prompt).toContain('EMPTY FUNCTIONAL BLOCKS');
    expect(prompt).toContain('Do not require complete text/image inventory');
    expect(prompt).toContain('planningStage:"structure"');
    expect(prompt).toContain('Check each saved document with od blockout assess');
    expect(prompt).toContain('Never fill the comparison with photographs, extracted drawings, Lorem ipsum paragraphs or full tables');
    expect(prompt).toContain('Empty structural boxes cannot establish final text fit');
    expect(prompt).toContain('read-only preview modal on that exact page');
    expect(prompt).not.toContain('Material preparation is a prerequisite:');
  });

  it('does not inject blockout constraints into Design mode', () => {
    expect(composeSystemPrompt({ sessionMode: 'design' })).not.toContain(BLOCKOUT_MODE_DIRECTIVE);
    expect(composeOdNextStrategyRequestPromptV2(recipe, { sessionMode: 'design' })).not.toContain(BLOCKOUT_MODE_DIRECTIVE);
  });
});
