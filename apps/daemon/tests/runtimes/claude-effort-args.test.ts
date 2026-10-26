import { afterEach, describe, expect, it } from 'vitest';
import { claudeAgentDef, claudeReasoningOptions, getClaudeEffortError } from '../../src/runtimes/defs/claude.js';
import { agentCapabilities } from '../../src/runtimes/capabilities.js';
import { isKnownReasoningEffort } from '../../src/runtimes/models.js';

describe('Claude model and effort forwarding', () => {
  afterEach(() => agentCapabilities.delete('claude'));

  it('offers Opus 5.5 and passes the chosen model and Medium effort to a supported CLI', () => {
    expect(claudeAgentDef.fallbackModels.some((model) => model.id === 'claude-opus-5-5')).toBe(true);
    agentCapabilities.set('claude', { effort: true });
    const args = claudeAgentDef.buildArgs('', [], [], { model: 'claude-opus-5-5', reasoning: 'medium' }, {});
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5-5');
    expect(args[args.indexOf('--effort') + 1]).toBe('medium');
  });

  it('leaves CLI defaults alone when effort is unspecified or default', () => {
    agentCapabilities.set('claude', { effort: true });
    for (const reasoning of [undefined, 'default']) {
      const options = reasoning === undefined ? {} : { reasoning };
      expect(claudeAgentDef.buildArgs('', [], [], options, {})).not.toContain('--effort');
    }
  });

  it('rejects explicit effort on an older CLI instead of silently dropping it', () => {
    agentCapabilities.set('claude', { effort: false });
    expect(() => claudeAgentDef.buildArgs('', [], [], { reasoning: 'medium' }, {}))
      .toThrow('does not advertise --effort');
    expect(getClaudeEffortError('claude-opus-5-5', 'medium', { effort: false }))
      .toMatchObject({ code: 'CLAUDE_EFFORT_UNSUPPORTED' });
  });

  it('keeps default effort compatible with older or unprobed CLIs', () => {
    for (const capabilities of [{ effort: false }, {}]) {
      agentCapabilities.set('claude', capabilities);
      for (const reasoning of [undefined, 'default']) {
        const options = reasoning === undefined ? {} : { reasoning };
        expect(claudeAgentDef.buildArgs('', [], [], options, {})).not.toContain('--effort');
        expect(getClaudeEffortError('claude-opus-4-5', reasoning, capabilities)).toBeNull();
      }
    }
  });

  it('offers the current versioned models with model-scoped effort choices', () => {
    const latestModels = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
    for (const modelId of latestModels) {
      const model = claudeAgentDef.fallbackModels.find((option) => option.id === modelId);
      expect(model?.reasoningOptions?.map((option) => option.id)).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max']);
    }
    expect(claudeAgentDef.fallbackModels.map((model) => model.id)).not.toContain('claude-opus-4-5');
    expect(isKnownReasoningEffort(claudeAgentDef, 'claude-opus-4-6', 'xhigh')).toBe(false);
    expect(isKnownReasoningEffort(claudeAgentDef, 'claude-opus-5-5', 'medium')).toBe(true);
  });

  it.each([
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'anthropic.claude-opus-4-6-v1:0',
    'us.anthropic.claude-sonnet-4-6-v1:0',
    'anthropic/claude-sonnet-4-6@20260217',
    'claude-opus-4-6[1m]',
  ])('does not offer or silently clamp XHigh for %s', (modelId) => {
    expect(claudeReasoningOptions(modelId).map((option) => option.id)).toEqual(['default', 'low', 'medium', 'high', 'max']);
    expect(getClaudeEffortError(modelId, 'xhigh', { effort: true }))
      .toMatchObject({ code: 'CLAUDE_MODEL_EFFORT_UNSUPPORTED' });
    expect(getClaudeEffortError(modelId, 'max', { effort: true })).toBeNull();
  });

  it.each(['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-20250514', 'claude-3-5-sonnet-20241022'])(
    'leaves legacy model %s at its own CLI default', (modelId) => {
      expect(claudeReasoningOptions(modelId).map((option) => option.id)).toEqual(['default']);
      expect(getClaudeEffortError(modelId, 'medium', { effort: true }))
        .toMatchObject({ code: 'CLAUDE_MODEL_EFFORT_UNSUPPORTED' });
    },
  );

  it('keeps provider aliases and custom routes under CLI control', () => {
    for (const modelId of [undefined, 'default', 'opus', 'sonnet', 'haiku', 'fable', 'custom-proxy-model']) {
      expect(getClaudeEffortError(modelId, 'medium', { effort: true })).toBeNull();
    }
  });

  it('rejects unsupported effort values before spawning', () => {
    agentCapabilities.set('claude', { effort: true });
    expect(getClaudeEffortError('claude-opus-5-5', 'ultra', { effort: true }))
      .toMatchObject({ code: 'CLAUDE_EFFORT_INVALID' });
    expect(() => claudeAgentDef.buildArgs('', [], [], { reasoning: '--flag' }, {}))
      .toThrow('does not support effort');
  });
});
