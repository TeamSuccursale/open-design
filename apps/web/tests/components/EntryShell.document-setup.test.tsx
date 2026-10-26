// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginLoopSubmit } from '../../src/components/PluginLoopHome';
import { EntryShell } from '../../src/components/EntryShell';
import { I18nProvider } from '../../src/i18n';
import { resetTeamProjectsCache, resetWorkspaceContextCache } from '../../src/collab/useWorkspaceContext';
import { checkAmrBalanceGate } from '../../src/runtime/amr-balance-gate';

const selected = vi.hoisted(() => ({ managed: false, fast: false }));
vi.mock('../../src/components/HomeView', () => ({ HomeView: ({ onSubmit }: { onSubmit: (payload: PluginLoopSubmit) => void }) => <button onClick={() => onSubmit({
  prompt: 'Prepare the report layout', pluginId: 'stale-plugin', pluginTitle: null, appliedPluginSnapshotId: 'stale-snapshot', taskKind: null,
  pluginInputs: { prompt: 'Do not run this unconfirmed draft' }, projectKind: 'prototype', conversationMode: 'design',
  projectMetadata: { kind: 'prototype', documentSetupIntent: { kind: 'report', subtype: 'Technical report', purpose: 'Prepare the report layout', contextRoots: ['/reference/context'], imageIntakeConsent: true } },
  ...(selected.managed ? {} : { workingDir: '/chosen/output', workingDirToken: 'host-folder-token' }), linkedDirs: ['/unrelated/stale-folder'], attachments: [new File(['source'], 'brief.pdf', { type: 'application/pdf' })],
  ...(selected.fast ? { projectMetadata: { kind: 'other', projectMode: 'fast' }, workingDir: null } : {}),
})}>Create setup document</button> }));
vi.mock('../../src/runtime/amr-balance-gate', async (original) => ({ ...(await original<typeof import('../../src/runtime/amr-balance-gate')>()), checkAmrBalanceGate: vi.fn() }));

function view(agentId = 'codex') {
  const onCreateProject = vi.fn().mockResolvedValue(true), onBeginProjectCreation = vi.fn();
  const props: ComponentProps<typeof EntryShell> = {
    skills: [], designTemplates: [], designSystems: [], projects: [], templates: [], promptTemplates: [], defaultDesignSystemId: null, connectors: [], connectorsLoading: false,
    config: { mode: 'daemon', agentId, agentModels: {}, apiProtocol: 'anthropic', apiProtocolConfigs: {}, apiKey: '', baseUrl: '', model: '', skillId: null, designSystemId: null, theme: 'system' },
    agents: [{ id: agentId, name: agentId, bin: agentId, available: true, models: [] }], daemonLive: true,
    onModeChange: vi.fn(), onAgentChange: vi.fn(), onAgentModelChange: vi.fn(), onApiProtocolChange: vi.fn(), onApiModelChange: vi.fn(), onConfigPersist: vi.fn(), onRefreshAgents: vi.fn(), onCreateProject, onBeginProjectCreation,
    onAmrBalanceGateBlockChange: vi.fn(), onCreatePluginShareProject: vi.fn(), onImportClaudeDesign: vi.fn(), onOpenProject: vi.fn(), onOpenLiveArtifact: vi.fn(), onDeleteProject: vi.fn(), onRenameProject: vi.fn(), onChangeDefaultDesignSystem: vi.fn(), onPersistComposioKey: vi.fn(), onOpenSettings: vi.fn(), onCompleteOnboarding: vi.fn(),
  };
  render(<I18nProvider initial="en"><EntryShell {...props} /></I18nProvider>);
  return { onCreateProject, onBeginProjectCreation };
}
beforeEach(() => {
  selected.managed = false; selected.fast = false;
  window.history.replaceState(null, '', '/');
  resetWorkspaceContextCache(); resetTeamProjectsCache();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ context: null, projects: [], plugins: [], servers: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); resetWorkspaceContextCache(); resetTeamProjectsCache(); });

describe('setup-only project creation handoff', () => {
  it.each(['codex', 'amr'])('creates local setup state with %s without a run handoff or funding preflight', async (agentId) => {
    const h = view(agentId);
    fireEvent.click(await screen.findByRole('button', { name: 'Create setup document' }));
    await waitFor(() => expect(h.onCreateProject).toHaveBeenCalledOnce());
    const input = h.onCreateProject.mock.calls[0]![0];
    expect(input).toMatchObject({ pendingPrompt: undefined, autoSendFirstMessage: false, conversationMode: 'blockout', userWorkingDirToken: 'host-folder-token', metadata: { kind: 'other', intent: 'document', userWorkingDir: '/chosen/output', linkedDirs: ['/reference/context'], documentSetupIntent: { purpose: 'Prepare the report layout', imageIntakeConsent: true } } });
    expect(input.pendingFiles[0].name).toBe('brief.pdf');
    expect(input).not.toHaveProperty('pluginInputs');
    expect(input).not.toHaveProperty('pluginId');
    expect(input).not.toHaveProperty('appliedPluginSnapshotId');
    expect(h.onBeginProjectCreation).not.toHaveBeenCalled();
    expect(checkAmrBalanceGate).not.toHaveBeenCalled();
  });
  it('keeps app-managed output separate from additional read-only context folders', async () => {
    selected.managed = true;
    const h = view(); fireEvent.click(await screen.findByRole('button', { name: 'Create setup document' }));
    await waitFor(() => expect(h.onCreateProject).toHaveBeenCalledOnce());
    const input = h.onCreateProject.mock.calls[0]![0];
    expect(input.metadata.userWorkingDir).toBeUndefined();
    expect(input.userWorkingDirToken).toBeUndefined();
    expect(input.metadata.linkedDirs).toEqual(['/reference/context']);
  });
});


describe('fast creation handoff', () => {
  it('hands files and the first prompt to one working chat without a default scenario or guided setup', async () => {
    selected.fast = true;
    const h = view(); fireEvent.click(await screen.findByRole('button', { name: 'Create setup document' }));
    await waitFor(() => expect(h.onCreateProject).toHaveBeenCalledOnce());
    const input = h.onCreateProject.mock.calls[0]![0];
    expect(input).toMatchObject({ pendingPrompt: 'Prepare the report layout', autoSendFirstMessage: true, conversationMode: 'design', metadata: { kind: 'other', projectMode: 'fast' } });
    expect(input.pendingFiles[0].name).toBe('brief.pdf');
    for (const key of ['pluginId', 'pluginInputs', 'appliedPluginSnapshotId', 'automaticStrategyTaskProfile', 'userWorkingDirToken']) expect(input).not.toHaveProperty(key);
    expect(input.metadata.documentSetupIntent).toBeUndefined(); expect(input.metadata.userWorkingDir).toBeUndefined();
    expect(input.metadata.linkedDirs ?? []).toEqual([]);
  });
});
