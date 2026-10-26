import { describe, expect, it } from 'vitest';
import { BLOCKOUT_MODE_DIRECTIVE, BLOCKOUT_DESIGN_DIRECTIVE, ENGINEER_GRAPHICS_SKILL_SCOPE } from '@open-design/contracts';
import { composeSystemPrompt } from '../../src/prompts/system.js';

describe('daemon Blockout mode', () => {
  it.each(['classic', 'slim'] as const)('keeps blockout scope in the %s charter', (promptCoreVariant) => {
    const prompt = composeSystemPrompt({ sessionMode: 'blockout', promptCoreVariant });
    expect(prompt).toContain(BLOCKOUT_MODE_DIRECTIVE);
    expect(prompt).toContain(ENGINEER_GRAPHICS_SKILL_SCOPE);
    expect(prompt).toContain('gare-regia-sessione');
    expect(prompt).toContain('impaginazione-elaborati-strutturali');
    expect(composeSystemPrompt({ sessionMode: 'design', promptCoreVariant })).not.toContain(BLOCKOUT_MODE_DIRECTIVE);
    expect(composeSystemPrompt({ sessionMode: 'design', promptCoreVariant })).toContain(BLOCKOUT_DESIGN_DIRECTIVE);
  });
});
