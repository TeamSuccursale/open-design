// @vitest-environment jsdom
/**
 * UX-02 · MelilloDesign runs the user's own CLI and wires no Cloud route.
 * A local failure must still offer a visible way forward: retry the same agent.
 * Hosts that do wire the Cloud route keep the OPEND-2807 card unchanged.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/analytics/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/analytics/events')>();
  return {
    ...actual,
    trackChatPanelClick: vi.fn(),
    trackRunFailedToastSurfaceView: vi.fn(),
    trackRunFailedToastGoAmrClick: vi.fn(),
    trackRunRecoveryActionClick: vi.fn(),
    trackRunRecoveryActionSurfaceView: vi.fn(),
  };
});

import { ChatPane } from '../../../src/components/ChatPane';
import {
  trackRunFailedToastGoAmrClick,
  trackRunRecoveryActionClick,
} from '../../../src/analytics/events';
import type { AppConfig, ChatMessage } from '../../../src/types';

/** 真字典 —— 判据钉在用户看到的那行字上,不钉键名 */
vi.mock('../../../src/i18n', async () => {
  const { zhCN } = await import('../../../src/i18n/locales/zh-CN');
  const dict = zhCN as unknown as Record<string, string>;
  const t = (key: string, vars?: Record<string, string | number>): string => {
    const raw = dict[key] ?? key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
      const v = vars[name];
      return v == null ? `{${name}}` : String(v);
    });
  };
  return {
    useI18n: () => ({ locale: 'zh-CN', setLocale: () => undefined, t }),
    useT: () => t,
  };
});

vi.mock('../../../src/components/AssistantMessage', () => ({
  AssistantMessage: ({ message }: { message: ChatMessage }) => (
    <div data-testid={`assistant-${message.id}`}>{message.content}</div>
  ),
}));

vi.mock('../../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef((_props, _ref) => <div data-testid="composer" />),
}));

// ⚠️ 故意**不 mock** `AmrGuidance`:这份文件的第一条判据就是「那张卡还在不在」,
// 把它 stub 掉等于把要照的东西糊住。

beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => store.delete(key),
      setItem: (key: string, value: string) => store.set(key, value),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function failedMessage(agentId: string, code: string): ChatMessage {
  return {
    id: 'msg-failed', role: 'assistant', content: '', createdAt: 1, runId: 'run-failed', runStatus: 'failed', agentId,
    events: [{ kind: 'status', label: 'error', detail: 'Agent "Codex CLI" (`codex`) is not installed or not on PATH.', code }],
  } as ChatMessage;
}

function renderFailure(agentId: string, cloudRoute: boolean) {
  const onRetry = vi.fn();
  render(
    <ChatPane
      messages={[failedMessage(agentId, 'AGENT_UNAVAILABLE')]}
      streaming={false}
      error={null}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      onRetry={onRetry}
      {...(cloudRoute ? { onSwitchToAmrAndRetry: vi.fn() } : {})}
      amrBalanceCardUsd={null}
      onOpenSettings={vi.fn() as never}
      conversations={[{ projectId: 'project-1', id: 'conv-1', title: 'Current', createdAt: 1, updatedAt: 1 }]}
      activeConversationId="conv-1"
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
      config={{ agentId, agentCliEnv: {} } as unknown as AppConfig}
    />,
  );
  return { onRetry };
}

const buttons = () => Array.from(screen.getByTestId('chat-run-error-card').querySelectorAll('button'), (button) => button.dataset.testid);

describe('local CLI failure without a Cloud route', () => {
  it('offers Retry for the same agent instead of a dead end', () => {
    const { onRetry } = renderFailure('codex', false);
    expect(buttons()).toEqual(['chat-error-contact-support', 'chat-error-export-logs', 'chat-error-retry']);
    fireEvent.click(screen.getByTestId('chat-error-retry'));
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-failed' }), 'manual_retry');
  });
  it('keeps the OPEND-2807 Cloud switch where the host wires it', () => {
    renderFailure('codex', true);
    expect(buttons()).toEqual(['chat-error-contact-support', 'chat-error-export-logs', 'chat-error-switch-to-cloud']);
  });
});
