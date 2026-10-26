import { describe, expect, it } from 'vitest';
import { IMAGE_SPECIALISTS, imageSpecialistsDirective } from '../src/prompts/image-specialists.js';
import { composeSystemPrompt } from '../src/prompts/system.js';
import { composeOdNextStrategyRequestPromptV2, type OdNextStrategyRequestRecipeV2 } from '../src/prompts/od-next-strategy.js';

const recipe: OdNextStrategyRequestRecipeV2 = {
  recipe: 'od-next-plan-build-v2', strategyId: 'od-next-strategy', strategyVersion: '2.0.0',
  snapshotId: 'images-test', packageHash: 'a'.repeat(64), taskProfileDigest: 'b'.repeat(64),
  taskProfileVersion: '2.0.0', taskType: 'prototype', executionProfile: 'filesystem',
  coreStrategy: 'Build the requested deliverable.', generalOrchestration: 'Plan, then Build.',
  taskSkill: 'Create the requested artifact.',
  activeStages: [
    { name: 'discovery', atoms: [{ name: 'discovery-question-form' }] },
    { name: 'plan', atoms: [{ name: 'direction-picker' }, { name: 'todo-write' }] },
    { name: 'generate', atoms: [{ name: 'file-write' }, { name: 'live-artifact' }] },
  ],
};

describe('native image specialists', () => {
  it.each(['legacy', 'OD Next BYOK', 'OD Next filesystem'] as const)('carries the catalogue through %s composition', (stack) => {
    const prompt = stack === 'OD Next filesystem'
      ? composeOdNextStrategyRequestPromptV2(recipe, { agentId: 'codex', sessionMode: 'design' })
      : composeSystemPrompt({ agentId: 'codex', sessionMode: 'design', ...(stack === 'OD Next BYOK'
        ? { odNextStrategyRecipe: { ...recipe, executionProfile: 'text_artifact' } } : {}) });
    expect(prompt).toContain(imageSpecialistsDirective('codex', 'design'));
  });
  it.each(['native', 'API/BYOK'] as const)('preserves Fast editorial questions and production tools without researchers in OD Next %s', (host) => {
    const context = { agentId: 'codex', sessionMode: 'design', metadata: { kind: 'other', projectMode: 'fast' } } as const;
    const prompt = host === 'native' ? composeOdNextStrategyRequestPromptV2(recipe, context)
      : composeSystemPrompt({ ...context, odNextStrategyRecipe: { ...recipe, executionProfile: 'text_artifact' } });
    expect(prompt).toContain('name="fast-project"');
    expect(prompt).toContain('od blockout assess');
    expect(prompt).not.toContain('od blockout inventory');
    expect(prompt).toContain('melillo_photo_vector');
    expect(prompt).not.toContain('name="document-research-specialists"');
    expect(prompt).toContain('Fast mode still requires explicit editorial choices in chat');
    expect(prompt).toContain('header yes/no, footer yes/no, cover yes/no and page numbering yes/no');
  });
  it('keeps stable, unique role identities and marks both SVG work and its review for stronger execution', () => {
    expect(IMAGE_SPECIALISTS.map(({ id, vectorWork }) => ({ id, vectorWork }))).toEqual([
      { id: 'melillo_image_alpha', vectorWork: false },
      { id: 'melillo_photo_vector', vectorWork: true },
      { id: 'melillo_image_review', vectorWork: true },
    ]);
    expect(new Set(IMAGE_SPECIALISTS.map(({ id }) => id)).size).toBe(3);
  });

  it.each([undefined, null, 'claude', 'opencode', 'codex-custom'])('does not advertise native Codex roles for %s', (agentId) => {
    expect(imageSpecialistsDirective(agentId, 'design')).toBe('');
  });

  it.each(['plan', 'chat'])('preserves the %s execution restriction', (sessionMode) => {
    expect(imageSpecialistsDirective('codex', sessionMode)).toBe('');
  });

  it.each([undefined, 'design', 'blockout'])('advertises the registered catalogue in allowed mode %s', (sessionMode) => {
    const directive = imageSpecialistsDirective('codex', sessionMode);
    for (const role of IMAGE_SPECIALISTS) {
      expect(directive).toContain(`${role.id}: ${role.description}`);
      expect(role.instructions.trim().length).toBeGreaterThan(0);
    }
  });
});
