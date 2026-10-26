import { describe, expect, it } from 'vitest';
import { FAST_PROJECT_MODE_DIRECTIVE, isFastProject } from '../src/prompts/fast-project.js';
import { composeSystemPrompt } from '../src/prompts/system.js';

describe('fast project workflow', () => {
  it('keeps production specialists and replaces automatic research with direct material inspection', () => {
    const prompt = composeSystemPrompt({ agentId: 'codex', sessionMode: 'design', metadata: { kind: 'other', projectMode: 'fast' } });
    expect(prompt).toContain(FAST_PROJECT_MODE_DIRECTIVE);
    expect(prompt).toContain('melillo_photo_vector');
    expect(prompt).toContain('melillo_image_alpha');
    expect(prompt).not.toContain('melillo_research_text');
    expect(prompt).not.toContain('melillo_document_facts');
    expect(prompt).toContain('full material inventory and image intake are not prerequisites');
    expect(prompt).toContain('empty functional blocks');
    expect(prompt).not.toContain('od blockout inventory');
    expect(prompt).toContain('od blockout assess');
    expect(prompt).toContain('Fast mode still requires explicit editorial choices in chat');
    expect(prompt).toContain('header yes/no, footer yes/no, cover yes/no and page numbering yes/no');
    expect(prompt).toContain('Keep unresolved values null');
    expect(prompt).toContain('od documents create/update --prompt-file <path|-> --json');
    expect(prompt).toContain('not unrelated prototypes or media requests');
  });
  it('does not change the normal project workflow', () => {
    expect(isFastProject(null)).toBe(false);
    expect(isFastProject({ kind: 'other' })).toBe(false);
    expect(isFastProject({ projectMode: 'fast' })).toBe(true);
    const prompt = composeSystemPrompt({ agentId: 'codex', sessionMode: 'design', metadata: { kind: 'other' } });
    expect(prompt).not.toContain(FAST_PROJECT_MODE_DIRECTIVE);
    expect(prompt).toContain('melillo_research_text');
  });
});
