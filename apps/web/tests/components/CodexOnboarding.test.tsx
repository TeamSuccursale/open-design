// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexOnboarding } from '../../src/components/CodexOnboarding';
import { I18nProvider } from '../../src/i18n';
import { testAgent } from '../../src/providers/connection-test';
import type { AgentInfo, AppConfig } from '../../src/types';

vi.mock('../../src/providers/connection-test', () => ({ testAgent: vi.fn() }));

const codex: AgentInfo = {
  id: 'codex', name: 'Codex CLI', bin: 'codex', available: true, authStatus: 'ok',
  models: [{ id: 'gpt-6-luna', label: 'GPT-6 Luna' }],
};

function setup(overrides: Partial<React.ComponentProps<typeof CodexOnboarding>> = {}) {
  const props = {
    config: { mode: 'api', agentId: null, agentModels: {}, apiKey: '', baseUrl: '', model: '' } as AppConfig,
    agents: [codex], daemonLive: true,
    onRefreshAgents: vi.fn(async () => [codex]),
    onConfigPersist: vi.fn(async (_next: AppConfig) => {}),
    onFinish: vi.fn(), onOtherOptions: vi.fn(),
    ...overrides,
  };
  const view = render(<I18nProvider initial="it"><CodexOnboarding {...props} /></I18nProvider>);
  return { ...props, ...view };
}

beforeEach(() => {
  vi.mocked(testAgent).mockResolvedValue({ ok: true, kind: 'success', latencyMs: 1 });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('Codex onboarding', () => {
  it('connects the detected CLI and waits for persisted configuration before finishing', async () => {
    let acknowledge!: () => void;
    const saved = new Promise<void>((resolve) => { acknowledge = resolve; });
    const onConfigPersist = vi.fn((_next: AppConfig) => saved);
    const props = setup({ onConfigPersist });
    fireEvent.click(screen.getByRole('button', { name: 'Collega Codex' }));
    await waitFor(() => expect(onConfigPersist).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'daemon', agentId: 'codex', agentModels: { codex: { model: 'gpt-6-luna' } },
    })));
    expect(props.onFinish).not.toHaveBeenCalled();
    await act(async () => { acknowledge(); });
    expect(props.onFinish).toHaveBeenCalledOnce();
    expect(testAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'codex', model: 'gpt-6-luna' }), expect.any(AbortSignal));
  });

  it.each([
    ['missing CLI', [], 'Codex CLI non trovato'],
    ['signed-out CLI', [{ ...codex, authStatus: 'missing' }], 'codex login'],
  ] as const)('keeps onboarding open for %s', async (_name, agents, message) => {
    const props = setup({ onRefreshAgents: vi.fn(async () => [...agents] as AgentInfo[]) });
    fireEvent.click(screen.getByRole('button', { name: 'Collega Codex' }));
    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(testAgent).not.toHaveBeenCalled();
    expect(props.onFinish).not.toHaveBeenCalled();
  });

  it('does not save or finish when the connection test fails', async () => {
    vi.mocked(testAgent).mockResolvedValue({ ok: false, kind: 'timeout', latencyMs: 1 });
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Collega Codex' }));
    await screen.findByRole('alert');
    expect(props.onConfigPersist).not.toHaveBeenCalled();
    expect(props.onFinish).not.toHaveBeenCalled();
  });

  it('stays on onboarding when saving fails and allows a retry', async () => {
    const onConfigPersist = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const props = setup({ onConfigPersist });
    fireEvent.click(screen.getByRole('button', { name: 'Collega Codex' }));
    await screen.findByRole('alert');
    expect(props.onFinish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Collega Codex' }));
    await waitFor(() => expect(props.onFinish).toHaveBeenCalledOnce());
  });

  it('ignores discovery that finishes after the screen unmounts', async () => {
    let resolve!: (agents: AgentInfo[]) => void;
    const discovered = new Promise<AgentInfo[]>((done) => { resolve = done; });
    const props = setup({ onRefreshAgents: () => discovered });
    fireEvent.click(screen.getByRole('button', { name: 'Collega Codex' }));
    props.unmount();
    await act(async () => { resolve([codex]); });
    expect(testAgent).not.toHaveBeenCalled();
    expect(props.onConfigPersist).not.toHaveBeenCalled();
  });
});
