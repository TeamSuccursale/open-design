// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatComposer, type ChatComposerHandle } from '../../src/components/ChatComposer';
import { ChatPane } from '../../src/components/ChatPane';
import { BLOCKOUT_OPEN_EVENT, BLOCKOUT_QUESTION_EVENT, OPEN_BLOCKOUT_PROPOSALS_EVENT } from '../../src/components/blockout/events';
import { I18nProvider } from '../../src/i18n';
import { flushMounts } from '../helpers/lexical-composer';

vi.mock('../../src/components/blockout/BlockoutWorkspace', () => ({ BlockoutWorkspace: ({ initialDocumentId, initialPageId, initialVariantId, initialBlockId }: { initialDocumentId?: string; initialPageId?: string; initialVariantId?: string; initialBlockId?: string }) => <div role="dialog" aria-label="Blockout editor">{initialDocumentId}/{initialVariantId}/{initialPageId}/{initialBlockId}</div> }));
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith('/intake') ? { version: 1, documents: [], assets: [] } : url.endsWith('/references') ? { references: [] } : url === '/api/mcp/servers' ? { servers: [], templates: [] } : url === '/api/plugins' ? { plugins: [] } : url === '/api/skills' ? { skills: [] } : {},
  ), { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('blockout is available only after document preparation is confirmed', () => {
  it('carries the preparation gate from the chat transcript into its composer controls', async () => {
    const view = (pending: boolean) => <I18nProvider initial="en"><ChatPane messages={[]} streaming={false} error={null} projectId="project" projectFiles={[]} documentPreparationPending={pending} blockoutNavigationAvailable={!pending} sessionMode="blockout" onSessionModeChange={vi.fn()} onEnsureProject={async () => 'project'} onSend={vi.fn()} onStop={vi.fn()} conversations={[]} activeConversationId={null} onSelectConversation={vi.fn()} onDeleteConversation={vi.fn()} /></I18nProvider>;
    const { rerender } = render(view(true)); await flushMounts();
    expect(screen.queryByRole('button', { name: 'Proposals' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Blockout editor' })).toBeNull();
    rerender(view(false));
    expect(screen.getByRole('button', { name: 'Proposals' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Blockout editor' })).toBeNull();
  });

  it('reveals only proposal navigation after preparation and never exposes a generic editor or starter', async () => {
    const onMode = vi.fn();
    const view = (pending: boolean) => <I18nProvider initial="en"><ChatComposer projectId="project" projectFiles={[]} streaming={false} sessionMode="blockout" documentPreparationPending={pending} blockoutNavigationAvailable={!pending} onSessionModeChange={onMode} onEnsureProject={async () => 'project'} onSend={vi.fn()} onStop={vi.fn()} /></I18nProvider>;
    const { rerender } = render(view(true)); await flushMounts();
    expect(screen.queryByRole('button', { name: 'Proposals' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Blockout editor' })).toBeNull();
    expect(screen.getByTestId('chat-composer-input').getAttribute('contenteditable')).toBe('true');
    rerender(view(false));
    expect(screen.getByRole('button', { name: 'Proposals' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Blockout editor' })).toBeNull();
    const opened = vi.fn(); window.addEventListener(OPEN_BLOCKOUT_PROPOSALS_EVENT, opened);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Proposals' }));
      expect(opened.mock.calls[0]?.[0].detail).toEqual({ projectId: 'project' });
      expect(onMode).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
    } finally { window.removeEventListener(OPEN_BLOCKOUT_PROPOSALS_EVENT, opened); }
  });

  it('ignores editor/question events while pending and closes any existing editor when preparation becomes pending', async () => {
    const view = (pending: boolean) => <I18nProvider initial="en"><ChatComposer projectId="project" projectFiles={[]} streaming={false} documentPreparationPending={pending} onEnsureProject={async () => 'project'} onSend={vi.fn()} onStop={vi.fn()} /></I18nProvider>;
    const { rerender } = render(view(true)); await flushMounts();
    fireEvent(window, new CustomEvent(BLOCKOUT_OPEN_EVENT, { detail: { projectId: 'project' } }));
    fireEvent(window, new CustomEvent(BLOCKOUT_QUESTION_EVENT, { detail: { request: { projectId: 'project', conversationId: null }, open: true } }));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(view(false));
    fireEvent(window, new CustomEvent(BLOCKOUT_OPEN_EVENT, { detail: { projectId: 'project' } }));
    expect(screen.getByRole('dialog', { name: 'Blockout editor' })).toBeTruthy();
    rerender(view(true));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(view(false));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens an existing comparison’s exact page and block even when unrelated preparation is pending', async () => {
    render(<I18nProvider initial="en"><ChatComposer projectId="project" projectFiles={[]} streaming={false} documentPreparationPending blockoutNavigationAvailable onEnsureProject={async () => 'project'} onSend={vi.fn()} onStop={vi.fn()} /></I18nProvider>);
    await flushMounts();
    fireEvent(window, new CustomEvent(BLOCKOUT_OPEN_EVENT, { detail: { projectId: 'unrelated', documentId: 'other' } }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent(window, new CustomEvent(BLOCKOUT_QUESTION_EVENT, { detail: { request: { projectId: 'project', conversationId: null }, open: true } }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent(window, new CustomEvent(BLOCKOUT_OPEN_EVENT, { detail: { projectId: 'project', documentId: 'registered-report', variantId: 'continuous', pageId: 'page-3', blockId: 'closing' } }));
    expect(screen.getByRole('dialog', { name: 'Blockout editor' }).textContent).toBe('registered-report/continuous/page-3/closing');
  });

  it('keeps a seeded preparation chat prompt usable without forwarding an unconfirmed blockout mode', async () => {
    const ref = createRef<ChatComposerHandle>(), onSend = vi.fn(), onMode = vi.fn();
    render(<I18nProvider initial="en"><ChatComposer ref={ref} projectId="project" projectFiles={[]} streaming={false} documentPreparationPending onSessionModeChange={onMode} onEnsureProject={async () => 'project'} onSend={onSend} onStop={vi.fn()} /></I18nProvider>);
    await flushMounts();
    await act(async () => { ref.current?.setDraft('Use the main report as context', { sessionMode: 'blockout' }); await Promise.resolve(); });
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(onSend.mock.calls[0]?.[0]).toBe('Use the main report as context');
    expect(onSend.mock.calls[0]?.[3]?.sessionMode).toBeUndefined();
    expect(onMode).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
  });
});
