import { describe, expect, it } from 'vitest';

import { OD_NEXT_CONFIRMED_BRIEF_EXCEPTION, renderChatTurnHostProtocolInstructions } from '../src/prompts/chat-turn-host-protocol.js';
import { composeOdNextStrategyBundleHeadV2, type OdNextStrategyRequestRecipeV2 } from '../src/prompts/od-next-strategy.js';

const KEY = '0123456789abcdef';

describe('chat turn host protocol', () => {
  it('renders the same keyed done, next-step, and focus protocol for ordinary chat', () => {
    const result = renderChatTurnHostProtocolInstructions(KEY);

    expect(result.doneMarker).toContain(`<od-done key="${KEY}"/>`);
    expect(result.nextSteps).toContain(`<od-next key="${KEY}" value="Add an orders list page"/>`);
    expect(result.nextSteps).not.toContain('</od-next>');
    expect(result.artifactFocus).toContain(`<od-focus key="${KEY}"`);
    expect(result.text).not.toContain('OD Next host handoff gate');
  });

  it('gives the planning turn one keyed continuation marker and no other output protocol', () => {
    const result = renderChatTurnHostProtocolInstructions(KEY, 'od_next_request');
    expect(result.text).toContain(`<od-production-ready key="${KEY}" />`);
    expect(result.text).toContain('last');
    expect(result.doneMarker).toBe('');
    expect(result.nextSteps).toBe('');
    expect(result.artifactFocus).toBe('');
  });
  it('makes a host-dispatched confirmed brief the production turn, with no planning marker to wait for', () => {
    const result = renderChatTurnHostProtocolInstructions(KEY, 'od_next_confirmed_request');
    expect(result.text).toContain('Confirmed-brief production');
    expect(result.text).toContain('Do not write a separate planning response');
    expect(result.text).not.toContain('<od-production-ready');
    expect(result.doneMarker).toContain(`<od-done key="${KEY}"/>`);
    expect(result.text).toContain(`<od-next key="${KEY}" value="Add an orders list page"/>`);
    expect(result.text).toContain('omit all three protocols');
  });
  it('lets the planning rule every request turn carries give way to the confirmed-brief gate it names', () => {
    const recipe: OdNextStrategyRequestRecipeV2 = {
      recipe: 'od-next-plan-build-v2', strategyId: 'od-next-strategy', strategyVersion: '2.0.0', snapshotId: 'confirmed-brief',
      packageHash: 'a'.repeat(64), taskProfileDigest: 'b'.repeat(64), taskProfileVersion: '2.0.0', taskType: 'prototype', executionProfile: 'filesystem',
      coreStrategy: '# Core', generalOrchestration: '# Orchestration', taskSkill: '# Prototype',
      activeStages: [{ name: 'discovery', atoms: [{ name: 'discovery-question-form' }] }, { name: 'plan', atoms: [{ name: 'direction-picker' }, { name: 'todo-write' }] }, { name: 'generate', atoms: [{ name: 'file-write' }, { name: 'live-artifact' }] }],
    };
    const planning = composeOdNextStrategyBundleHeadV2(recipe).coreSystemPrompt.discoveryAndPlanningSurface;
    expect(planning).toContain('needs a separate planning turn');
    expect(planning).toContain(OD_NEXT_CONFIRMED_BRIEF_EXCEPTION);
    expect(OD_NEXT_CONFIRMED_BRIEF_EXCEPTION).toContain('Confirmed-brief production');
    expect(renderChatTurnHostProtocolInstructions(KEY, 'od_next_confirmed_request').text).toContain('Confirmed-brief production:');
  });
  it('describes production completion without requiring retired model state declarations', () => {
    const result = renderChatTurnHostProtocolInstructions(KEY, 'od_next_production');

    expect(result.text).not.toContain('response declares');
    expect(result.text).not.toContain('inputStage=');
    expect(result.text).not.toContain('outcome=');
    expect(result.text).toContain('omit all three protocols');
    expect(result.text).toContain(`<od-next key="${KEY}" value="Add an orders list page"/>`);
    expect(renderChatTurnHostProtocolInstructions('', 'od_next_production')).toEqual({
      doneMarker: '',
      nextSteps: '',
      artifactFocus: '',
      text: '',
    });
  });
});
