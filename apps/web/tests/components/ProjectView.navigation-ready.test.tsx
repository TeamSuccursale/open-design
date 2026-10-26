// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentSetup, ProjectDocument } from '@open-design/contracts';

import { navigationTiming } from '../../src/observability/navigation-timing';
import { reportSafetyEvent } from '../../src/analytics/error-tracking';
import { ProjectView } from '../../src/components/ProjectView';
import type { QuestionFormSubmitHandler } from '../../src/components/AssistantMessage';
import { navigate, registerNavigationGuard, useRoute } from '../../src/router';
import type {
  AgentInfo,
  AppConfig,
  Conversation,
  DesignSystemSummary,
  Project,
  SkillSummary,
} from '../../src/types';
import {
  cacheTabsLocally,
  createConversation,
  listConversations,
  listMessages,
  loadTabs,
  saveMessage,
} from '../../src/state/projects';
import { fetchPreviewComments, fetchProjectFiles } from '../../src/providers/registry';

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (key: string) => key,
  }),
  useT: () => (key: string) => key,
}));

vi.mock('../../src/analytics/error-tracking', () => ({ reportSafetyEvent: vi.fn() }));

vi.mock('../../src/providers/anthropic', () => ({
  streamMessage: vi.fn(),
}));

vi.mock('../../src/providers/daemon', () => ({
  fetchChatRunStatus: vi.fn(),
  listActiveChatRuns: vi.fn().mockResolvedValue([]),
  listProjectRuns: vi.fn().mockResolvedValue([]),
  publishDaemonRunFinishedEvent: vi.fn(),
  reattachDaemonRun: vi.fn(),
  streamViaDaemon: vi.fn(),
}));

vi.mock('../../src/providers/project-events', () => ({
  useProjectFileEvents: vi.fn(),
}));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    deletePreviewComment: vi.fn(),
    fetchDesignSystem: vi.fn(),
    fetchLiveArtifacts: vi.fn().mockResolvedValue([]),
    fetchPreviewComments: vi.fn(),
    fetchProjectFiles: vi.fn().mockResolvedValue([]),
    fetchSkill: vi.fn(),
    getTemplate: vi.fn(),
    patchPreviewCommentStatus: vi.fn(),
    upsertPreviewComment: vi.fn(),
    writeProjectTextFile: vi.fn(),
  };
});

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  return {
    ...actual,
    cacheTabsLocally: vi.fn((_projectId: string, state: { tabs: string[]; active: string | null }) => state),
    createConversation: vi.fn(),
    listConversations: vi.fn(),
    listMessages: vi.fn(),
    loadTabs: vi.fn(),
    patchConversation: vi.fn(),
    patchProject: vi.fn(),
    persistTabsToDaemonNow: vi.fn(),
    saveMessage: vi.fn(),
    saveTabs: vi.fn(),
  };
});

vi.mock('../../src/components/AppChromeHeader', () => ({
  AppChromeHeader: ({ children }: { children: ReactNode }) => (
    <header>{children}</header>
  ),
}));

vi.mock('../../src/components/AvatarMenu', () => ({
  AvatarMenu: () => null,
}));

vi.mock('../../src/components/FileWorkspace', () => ({
  DESIGN_SYSTEM_TAB: '__design_system__',
  FileWorkspace: ({ tabsState, onTabsStateChange, designSystemProject, openRequest }: {
    tabsState: { tabs: string[]; active: string | null };
    onTabsStateChange: (state: { tabs: string[]; active: string | null }) => void;
    designSystemProject?: DesignSystemSummary | null;
    openRequest?: { name: string; nonce: number } | null;
  }) => {
    useEffect(() => {
      if (!openRequest?.name) return;
      if (tabsState.active === openRequest.name && tabsState.tabs.includes(openRequest.name)) return;
      const tabs = tabsState.tabs.includes(openRequest.name)
        ? tabsState.tabs
        : [...tabsState.tabs, openRequest.name];
      onTabsStateChange({ tabs, active: openRequest.name });
    }, [onTabsStateChange, openRequest?.name, openRequest?.nonce, tabsState.tabs]);
    return (
      <div data-testid="file-workspace">
        <output data-testid="workspace-active-tab">{tabsState.active ?? ''}</output>
        <output data-testid="workspace-design-system-id">{designSystemProject?.id ?? ''}</output>
        <button
          type="button"
          data-testid="close-all-tabs"
          onClick={() => onTabsStateChange({ tabs: [], active: null })}
        >
          close all tabs
        </button>
      </div>
    );
  },
}));

vi.mock('../../src/components/Loading', () => ({
  CenteredLoader: () => <div data-testid="loader" />,
}));

const chatPane = vi.hoisted(() => ({ onSubmitQuestionForm: null as null | QuestionFormSubmitHandler, submitDisabled: true }));
vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: ({ onSelectConversation, messages, documentSetupContent, onRetryConversationRead, onSubmitQuestionForm, questionFormSubmitDisabled }: { onSelectConversation: (id: string) => void; messages: Array<{ content: string }>; documentSetupContent?: ReactNode; onRetryConversationRead?: () => void; onSubmitQuestionForm?: QuestionFormSubmitHandler; questionFormSubmitDisabled?: boolean }) => {
    chatPane.onSubmitQuestionForm = onSubmitQuestionForm ?? null;
    chatPane.submitDisabled = questionFormSubmitDisabled ?? false;
    return <div data-testid="chat-pane">
      {documentSetupContent}
      <output data-testid="visible-transcript">{messages.map((message) => message.content).join('\n')}</output>
      <button onClick={() => onSelectConversation('conv-2')}>Switch conversation</button>
      {onRetryConversationRead && <button onClick={onRetryConversationRead}>Retry conversation read</button>}
    </div>;
  },
}));
const documentLibrary = vi.hoisted(() => ({ documents: [] as ProjectDocument[] }));
vi.mock('../../src/components/project-documents/useProjectDocuments', () => ({ useProjectDocuments: () => ({
  documents: documentLibrary.documents, selectedDocumentId: null, loading: false, error: false, refresh: vi.fn(),
}) }));
const setupPanel = vi.hoisted(() => ({ onStart: null as null | ((setup: DocumentSetup) => Promise<unknown>) }));
vi.mock('../../src/components/document-setup/DocumentSetupReview', () => ({
  DocumentSetupReview: ({ enabled, onStart }: { enabled: boolean; onStart: (setup: DocumentSetup) => Promise<unknown> }) => {
    setupPanel.onStart = onStart;
    return enabled ? <div data-testid="global-preparation-controls" /> : null;
  },
}));
vi.mock('../../src/components/project-documents/ProjectDocumentsPanel', () => ({
  ProjectDocumentsPanel: ({ onOpen }: { onOpen: (document: unknown) => Promise<void> }) => <button onClick={() => void onOpen({
    id: 'graphics', projectId: 'project-1', workspaceProjectId: 'project-1', name: 'Graphics', kind: 'document',
    conversationIds: ['new-document-chat'], workingDirectory: 'C:/project', folderMode: 'managed', availability: 'available',
    createdAt: '2026-10-24', updatedAt: '2026-10-24', archivedAt: null,
  })}>Open new document</button>,
}));

const mockedListConversations = vi.mocked(listConversations);
const mockedCreateConversation = vi.mocked(createConversation);
const mockedListMessages = vi.mocked(listMessages);
const mockedLoadTabs = vi.mocked(loadTabs);
const mockedCacheTabsLocally = vi.mocked(cacheTabsLocally);
const mockedFetchPreviewComments = vi.mocked(fetchPreviewComments);
const mockedFetchProjectFiles = vi.mocked(fetchProjectFiles);

const config: AppConfig = {
  mode: 'api',
  apiKey: '',
  baseUrl: '',
  model: '',
  agentId: null,
  skillId: null,
  designSystemId: null,
};

const project: Project = {
  id: 'project-1',
  name: 'Project 1',
  skillId: null,
  designSystemId: null,
  createdAt: 1,
  updatedAt: 1,
};

const conversation: Conversation = {
  id: 'conv-1',
  projectId: project.id,
  title: null,
  createdAt: 1,
  updatedAt: 1,
};

function renderProjectView(props?: {
  config?: AppConfig;
  project?: Project;
  designSystems?: DesignSystemSummary[];
  routeFileName?: string | null;
  routeConversationId?: string | null;
  materializationPending?: boolean;
}) {
  function RoutedProjectView() {
    const route = useRoute();
    useLayoutEffect(() => navigationTiming.observeRoute(route), [route]);
    return <ProjectView
      project={props?.project ?? project}
      initialMaterializationPending={props?.materializationPending}
      initialProjectDetail={{ project: props?.project ?? project, resolvedDir: null }}
      initialWorkspaceScope={{ kind: 'unbound', projectId: (props?.project ?? project).id, workspaceId: null, context: null }}
      routeFileName={props?.routeFileName ?? null}
      routeConversationId={props?.routeConversationId ?? (route.kind === 'project' ? route.conversationId : null)}
      config={props?.config ?? config}
      agents={[] as AgentInfo[]}
      skills={[] as SkillSummary[]}
      designTemplates={[] as SkillSummary[]}
      designSystems={props?.designSystems ?? ([] as DesignSystemSummary[])}
      daemonLive
      onModeChange={vi.fn()}
      onAgentChange={vi.fn()}
      onAgentModelChange={vi.fn()}
      onRefreshAgents={vi.fn()}
      onOpenSettings={vi.fn()}
      onBack={vi.fn()}
      onClearPendingPrompt={vi.fn()}
      onTouchProject={vi.fn()}
      onProjectChange={vi.fn()}
      onProjectsRefresh={vi.fn()}
    />;
  }
  return render(<RoutedProjectView />);
}


function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function results() {
  return vi.mocked(reportSafetyEvent).mock.calls
    .filter(([name]) => name === 'client_navigation_result')
    .map(([, props]) => props);
}

beforeEach(() => {
  setupPanel.onStart = null;
  chatPane.onSubmitQuestionForm = null; chatPane.submitDisabled = true;
  navigationTiming.cancel('page_exit');
  vi.clearAllMocks();
  documentLibrary.documents = [];
  navigate({ kind: 'project', projectId: project.id, conversationId: conversation.id, fileName: null }, { replace: true });
  mockedListConversations.mockResolvedValue([conversation]);
  mockedCreateConversation.mockResolvedValue(conversation);
  mockedListMessages.mockResolvedValue([]);
  mockedLoadTabs.mockResolvedValue({ tabs: [], active: null });
  mockedFetchProjectFiles.mockResolvedValue([]);
  mockedFetchPreviewComments.mockResolvedValue([]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => {
  cleanup();
  navigationTiming.cancel('page_exit');
  vi.unstubAllGlobals();
});

describe('ProjectView business Ready wiring', () => {
  it('keeps collection preparation in its original chat and removes those controls from an output’s editing chat', async () => {
    documentLibrary.documents = [{ id: 'graphics', projectId: project.id, workspaceProjectId: project.id, name: 'Graphics', kind: 'document',
      conversationIds: ['new-document-chat'], workingDirectory: 'C:/project', folderMode: 'managed', availability: 'available',
      createdAt: '2026-10-24', updatedAt: '2026-10-24', archivedAt: null }];
    mockedListConversations.mockResolvedValue([conversation, { ...conversation, id: 'new-document-chat' }]);
    renderProjectView({ project: { ...project, metadata: { kind: 'other', documentSetupIntent: { kind: 'report', subtype: 'Two outputs', purpose: 'Two documents', contextRoots: [], imageIntakeConsent: false } } } });
    await screen.findByTestId('global-preparation-controls');
    act(() => navigate({ kind: 'project', projectId: project.id, conversationId: 'new-document-chat', fileName: null }));
    await waitFor(() => expect(mockedListMessages.mock.calls.some((call) => call[1] === 'new-document-chat')).toBe(true));
    expect(screen.queryByTestId('global-preparation-controls')).toBeNull();
  });

  it('refreshes and switches to a newly materialized same-project document chat instead of leaving the preparation transcript visible', async () => {
    mockedListMessages.mockImplementation(async (_projectId, id) => id === 'conv-1'
      ? [{ id: 'preparation-message', role: 'assistant', content: 'Original preparation history', createdAt: 1 }] : []);
    renderProjectView();
    await waitFor(() => expect(screen.getByTestId('visible-transcript').textContent).toBe('Original preparation history'));
    mockedListConversations.mockResolvedValue([conversation, { ...conversation, id: 'new-document-chat', title: 'Graphics' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Documents' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open new document' }));
    await waitFor(() => expect(mockedListMessages.mock.calls.some((call) => call[1] === 'new-document-chat')).toBe(true));
    await waitFor(() => expect(screen.getByTestId('visible-transcript').textContent).toBe(''));
    expect(window.location.pathname).toContain('new-document-chat');
    expect(mockedListConversations.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockedCreateConversation).not.toHaveBeenCalled();
  });

  it('refreshes an externally routed conversation missing from the already-loaded conversation list', async () => {
    renderProjectView(); await waitFor(() => expect(mockedListMessages.mock.calls.some((call) => call[1] === 'conv-1')).toBe(true));
    mockedListConversations.mockResolvedValue([conversation, { ...conversation, id: 'new-route-chat' }]);
    act(() => navigate({ kind: 'project', projectId: project.id, conversationId: 'new-route-chat', fileName: null }));
    await waitFor(() => expect(mockedListMessages.mock.calls.some((call) => call[1] === 'new-route-chat')).toBe(true));
    expect(window.location.pathname).toContain('new-route-chat');
    expect(mockedCreateConversation).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'pending'] as const)('observes existing conversation reconciliation while the router guard is %s', async (mode) => {
    mockedListConversations.mockResolvedValue([conversation, { ...conversation, id: 'conv-2' }]);
    renderProjectView();
    await screen.findByTestId('chat-pane');
    await waitFor(() => expect(mockedListMessages).toHaveBeenCalled());
    const gate = deferred<boolean>();
    const guard = vi.fn(() => gate.promise);
    const unregister = registerNavigationGuard(guard);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Switch conversation' }));
      await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
      expect(results().map(e => e?.status)).toEqual(['started']);
      expect(window.location.pathname).toContain('conv-1');
      await act(async () => { gate.resolve(mode === 'pending'); });
      // The original handler mutates conversation state before the guard.
      // Its route reconciliation can supersede this request; instrumentation
      // observes that cancellation instead of moving mutations behind a guard.
      await waitFor(() => expect(results().map(e => e?.status)).toEqual(['started', 'cancelled']));
      expect(results().at(-1)?.reason).toBe('superseded');
      expect(window.location.pathname).toContain(mode === 'rejected' ? 'conv-1' : 'conv-2');
    } finally { unregister(); }
  });

  it('waits for the current transcript, then reports actionable Ready exactly once', async () => {
    const messages = deferred<Awaited<ReturnType<typeof listMessages>>>();
    mockedListMessages.mockReturnValue(messages.promise);
    navigationTiming.begin({ kind: 'home', view: 'projects' }, { projectId: project.id });
    renderProjectView();
    await waitFor(() => expect(mockedListMessages).toHaveBeenCalled());
    expect(results()[0]?.result).toBe('started');
    expect(results().some(e => e?.result === 'ready')).toBe(false);
    await act(async () => { messages.resolve([]); });
    await waitFor(() => expect(results().map((e) => e?.status)).toEqual(['started', 'first_visible', 'ready']));
    expect(results().at(-1)?.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('measures a conversation switch from its handler and waits for the new transcript', async () => {
    mockedListConversations.mockResolvedValue([conversation, { ...conversation, id: 'conv-2' }]);
    const second = deferred<Awaited<ReturnType<typeof listMessages>>>();
    mockedListMessages.mockImplementation(async (_projectId, conversationId) =>
      conversationId === 'conv-2' ? second.promise : []);
    renderProjectView();
    await screen.findByTestId('chat-pane');
    await waitFor(() => expect(mockedListMessages).toHaveBeenCalled());
    expect(results()).toEqual([]); // mounting is not a navigation intent
    fireEvent.click(screen.getByRole('button', { name: 'Switch conversation' }));
    expect(results()[0]?.result).toBe('started');
    expect(results().some(e => e?.result === 'ready')).toBe(false);
    await act(async () => { second.resolve([]); });
    await waitFor(() => expect(results().map((e) => e?.status)).toEqual(['started', 'first_visible', 'ready']));
    expect(results().at(-1)?.navigation_type).toBe('conversation_switch');
  });

  it('does not call a mounted but still materializing project actionable Ready', async () => {
    navigationTiming.begin({ kind: 'home' }, { projectId: project.id });
    renderProjectView({ materializationPending: true });
    await waitFor(() => expect(mockedListMessages).toHaveBeenCalled());
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    expect(results().map((e) => e?.status)).toEqual(['started', 'first_visible']);
    expect(results().some(e => e?.result === 'ready')).toBe(false);
  });

  it('does not turn a failed transcript read into Ready', async () => {
    mockedListMessages.mockRejectedValue(new Error('private upstream text'));
    navigationTiming.begin({ kind: 'home' }, { projectId: project.id });
    renderProjectView();
    await waitFor(() => expect(results().map((e) => e?.status)).toEqual(['started', 'failed']));
    expect(results()[1]?.reason).toBe('messages_unavailable');
    expect(JSON.stringify(results())).not.toContain('private upstream text');
  });
  it('retries a failed transcript on the same original conversation without creating a chat or document', async () => {
    mockedListMessages.mockRejectedValueOnce(new Error('temporary read failure')).mockResolvedValueOnce([{ id: 'saved-message', role: 'assistant', content: 'Original document brief', createdAt: 1 }]);
    renderProjectView();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry conversation read' }));
    await screen.findByText('Original document brief');
    expect(mockedListMessages.mock.calls.map((call) => call.slice(0, 2))).toEqual([[project.id, conversation.id], [project.id, conversation.id]]);
    expect(mockedCreateConversation).not.toHaveBeenCalled();
  });
  it('retries a failed conversation list while preserving its original deep link', async () => {
    mockedListConversations.mockRejectedValueOnce(new Error('temporary list failure')).mockResolvedValueOnce([conversation]);
    renderProjectView({ routeConversationId: conversation.id });
    fireEvent.click(await screen.findByRole('button', { name: 'Retry conversation read' }));
    await waitFor(() => expect(mockedListMessages).toHaveBeenCalled());
    expect(mockedListMessages.mock.calls[0]?.slice(0, 2)).toEqual([project.id, conversation.id]);
    expect(mockedCreateConversation).not.toHaveBeenCalled();
  });
  it('counts a setup request parked behind a finishing run as sent, so the panel neither reports a failure nor offers a second copy', async () => {
    // The previous turn's stream has ended but its run has not settled yet: the conversation still queues new sends.
    mockedListMessages.mockResolvedValue([{ id: 'confirming', role: 'assistant', content: 'Brief confermato.', createdAt: 1, runId: 'run-confirm', runStatus: 'running' }]);
    const daemon = await import('../../src/providers/daemon');
    vi.mocked(daemon.fetchChatRunStatus).mockReturnValue(new Promise(() => undefined));
    try {
      renderProjectView({ config: { ...config, mode: 'daemon', agentId: 'codex' }, project: { ...project, metadata: { kind: 'other', documentSetupIntent: { kind: 'report', subtype: 'Two outputs', purpose: 'Two documents', contextRoots: [], imageIntakeConsent: false } } } });
      await waitFor(() => expect(screen.getByTestId('visible-transcript').textContent).toBe('Brief confermato.'));
      await waitFor(() => expect(setupPanel.onStart).not.toBeNull());
      const setup = { status: 'confirmed', intent: { editorialSettings: [], preparationConversation: { requestId: 'prep', dispatched: true, blockoutRequestId: 'blockout-once', headerFooterRequestId: 'hf-once' } }, confirmed: { editorialSettings: [] } } as unknown as DocumentSetup;
      let accepted: unknown;
      await act(async () => { accepted = await setupPanel.onStart!(setup); });
      expect(accepted).toBe(true);
      expect(daemon.streamViaDaemon).not.toHaveBeenCalled();
    } finally { vi.mocked(daemon.fetchChatRunStatus).mockReset(); }
  });

  describe('final brief confirmation', () => {
    // The queued send parked by the previous test persists per project in localStorage and would keep this conversation busy.
    beforeEach(() => window.localStorage.clear());
    const setupProject = { ...project, metadata: { kind: 'other' as const, documentSetupIntent: { kind: 'report' as const, subtype: 'Two outputs', purpose: 'Two documents', contextRoots: [], imageIntakeConsent: false } } };
    const summary = { id: 'brief-summary', role: 'assistant' as const, content: 'Riepilogo del brief.', createdAt: 1, runId: 'run-summary', runStatus: 'succeeded' as const };
    const answer = '[form answers — document-setup-confirmation]\n- Confermi il brief riepilogato?: Sì, confermo [value: yes]\n- Come vuoi impostare i blocchi?: Tre strutture complete per ogni documento [value: agent]';
    const confirmCalls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/projects/project-1/document-setup/confirm'));
    async function submit(formId: string, answers: Record<string, string>) {
      // A real form keeps its submit button disabled until the conversation accepts actions.
      await waitFor(() => { expect(chatPane.onSubmitQuestionForm).not.toBeNull(); expect(chatPane.submitDisabled).toBe(false); });
      let accepted: unknown;
      await act(async () => { accepted = await chatPane.onSubmitQuestionForm!(answer, [], undefined, summary.id, formId, answers); });
      return accepted;
    }

    it('records an accepted confirmation itself and lets the setup panel start the Blockout, with no agent turn for the answer', async () => {
      mockedListMessages.mockResolvedValue([summary]);
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ setup: null }) }));
      vi.stubGlobal('fetch', fetchMock);
      const reread = vi.fn();
      window.addEventListener('melillodesign:document-context-updated', reread);
      const daemon = await import('../../src/providers/daemon');
      try {
        renderProjectView({ config: { ...config, mode: 'daemon', agentId: 'codex' }, project: setupProject });
        await waitFor(() => expect(screen.getByTestId('visible-transcript').textContent).toBe('Riepilogo del brief.'));
        expect(await submit('document-setup-confirmation', { 'confirm-brief': 'yes', 'blockout-approach': 'agent' })).toBe(true);
        expect(confirmCalls(fetchMock)).toHaveLength(1);
        expect(JSON.parse(String((confirmCalls(fetchMock)[0] as unknown as [string, RequestInit])[1].body))).toEqual({ source: 'saved-brief', blockoutApproach: 'agent' });
        expect(daemon.streamViaDaemon).not.toHaveBeenCalled();
        expect(vi.mocked(saveMessage)).toHaveBeenCalledWith(project.id, conversation.id,
          expect.objectContaining({ role: 'user', content: answer, id: expect.stringMatching(/^qf-answer-.+-user$/) }), expect.objectContaining({ createOnly: true }));
        await waitFor(() => expect(screen.getByTestId('visible-transcript').textContent).toContain(answer));
        expect(reread).toHaveBeenCalledOnce();
      } finally { window.removeEventListener('melillodesign:document-context-updated', reread); }
    });

    for (const [name, answers, confirmations] of [
      ['the engineer asks to change the brief', { 'confirm-brief': 'no' }, 0],
      ['the saved brief cannot be confirmed as it stands', { 'confirm-brief': 'yes', 'blockout-approach': 'agent' }, 1],
    ] as const) {
      it(`sends the answer to the agent as before when ${name}`, async () => {
        mockedListMessages.mockResolvedValue([summary]);
        const fetchMock = vi.fn(async (url: string) => String(url).endsWith('/document-setup/confirm')
          ? { ok: false, json: async () => ({ error: { message: 'Save each output’s constraints before confirming the saved brief' } }) }
          : { ok: true, json: async () => ({}) });
        vi.stubGlobal('fetch', fetchMock);
        const daemon = await import('../../src/providers/daemon');
        renderProjectView({ config: { ...config, mode: 'daemon', agentId: 'codex' }, project: setupProject });
        await waitFor(() => expect(screen.getByTestId('visible-transcript').textContent).toBe('Riepilogo del brief.'));
        await submit('document-setup-confirmation', answers);
        expect(confirmCalls(fetchMock)).toHaveLength(confirmations);
        await waitFor(() => expect(daemon.streamViaDaemon).toHaveBeenCalledOnce());
      });
    }
  });

  it('does not mount guided document setup in a Fast child with a saved document intent', async () => {
    documentLibrary.documents = [{ id: 'report', projectId: 'collection', workspaceProjectId: project.id, name: 'Fast report', kind: 'document', conversationIds: [conversation.id], workingDirectory: 'C:/fast', folderMode: 'managed', availability: 'available', createdAt: 'now', updatedAt: 'now', archivedAt: null }];
    renderProjectView({ project: { ...project, metadata: { kind: 'other', projectMode: 'fast', collectionProjectId: 'collection', collectionDocumentId: 'report', documentSetupIntent: { kind: 'report', subtype: 'Technical report', purpose: 'Prepare a technical report', contextRoots: [], imageIntakeConsent: false } } } });
    await waitFor(() => expect(mockedListMessages).toHaveBeenCalled());
    expect(screen.queryByTestId('global-preparation-controls')).toBeNull();
  });

  it('cannot finish a cancelled entry when its messages resolve after unmount', async () => {
    const messages = deferred<Awaited<ReturnType<typeof listMessages>>>();
    mockedListMessages.mockReturnValue(messages.promise);
    navigationTiming.begin({ kind: 'home' }, { projectId: project.id });
    const view = renderProjectView();
    await waitFor(() => expect(mockedListMessages).toHaveBeenCalled());
    act(() => navigationTiming.observeRoute({ kind: 'project', projectId: project.id }));
    act(() => navigationTiming.observeRoute({ kind: 'home' }));
    view.unmount();
    await act(async () => { messages.resolve([]); });
    expect(results().at(-1)?.result).toBe('cancelled');
    expect(results().some(e => e?.result === 'ready')).toBe(false);
  });
});
