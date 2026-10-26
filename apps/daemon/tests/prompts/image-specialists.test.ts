import { describe, expect, it } from 'vitest';
import { imageSpecialistsDirective } from '@open-design/contracts';
import { composeSystemPrompt } from '../../src/prompts/system.js';

describe('daemon image specialist prompt routing', () => {
  it.each(['classic', 'slim'] as const)('exposes the native catalogue in the %s charter', (promptCoreVariant) => {
    const prompt = composeSystemPrompt({ agentId: 'codex', sessionMode: 'design', promptCoreVariant });
    expect(prompt).toContain(imageSpecialistsDirective('codex', 'design'));
    expect(composeSystemPrompt({ agentId: 'claude', sessionMode: 'design', promptCoreVariant })).not.toContain('melillo_image_alpha');
    expect(composeSystemPrompt({ agentId: 'codex', sessionMode: 'plan', promptCoreVariant })).not.toContain('melillo_image_alpha');
  });
  it.each(['classic', 'slim'] as const)('keeps Fast production roles and editorial questions without the guided setup in %s', (promptCoreVariant) => {
    const prompt = composeSystemPrompt({ agentId: 'codex', sessionMode: 'design', promptCoreVariant, metadata: { kind: 'other', projectMode: 'fast' } });
    expect(prompt).toContain('Fast project — inspect the material');
    expect(prompt).toContain('melillo_photo_vector');
    expect(prompt).not.toContain('melillo_research_text');
    expect(prompt).not.toContain('melillo_document_facts');
    expect(prompt).toContain('Fast mode still requires explicit editorial choices in chat');
    expect(prompt).toContain('header yes/no, footer yes/no, cover yes/no and page numbering yes/no');
  });

});
