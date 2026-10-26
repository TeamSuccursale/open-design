// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatComposer } from '../../src/components/ChatComposer';
import { OPEN_BLOCKOUT_PROPOSALS_EVENT } from '../../src/components/blockout/events';
import { flushMounts, typeInComposer } from '../helpers/lexical-composer';
vi.mock('../../src/providers/blockout', () => ({ listBlockoutDocuments: vi.fn(async () => [{ id: 'document-1', title: '' }]), loadBlockout: vi.fn(async () => ({ document: null, raw: null })), saveBlockout: vi.fn(async () => 'saved'), saveBlockoutStartingPoint: vi.fn(async () => undefined) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChatComposer fixed Design mode', () => {
  it('does not expose a session-mode picker in project chat', async () => {
    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    await flushMounts();

    expect(screen.queryByTestId('composer-mode-trigger')).toBeNull();
    expect(screen.queryByTestId('composer-mode-clear')).toBeNull();
  });

  it('opens proposal comparison without switching modes, opening an editor, or altering the next send', async () => {
    const onSend = vi.fn();
    const onSessionModeChange = vi.fn();
    render(
      <ChatComposer
        projectId="blockout-project"
        projectFiles={[]}
        streaming={false}
        onSessionModeChange={onSessionModeChange}
        onEnsureProject={async () => 'blockout-project'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );
    await flushMounts();
    typeInComposer('Arrange the supplied material in A3 landscape.');
    const opened = vi.fn(); window.addEventListener(OPEN_BLOCKOUT_PROPOSALS_EVENT, opened);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Proposals' }));
      expect(opened.mock.calls[0]?.[0].detail).toEqual({ projectId: 'blockout-project' });
    } finally { window.removeEventListener(OPEN_BLOCKOUT_PROPOSALS_EVENT, opened); }
    expect(onSessionModeChange).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0]?.[3]?.sessionMode).toBeUndefined();
  });

  it('keeps proposal navigation separate from the stored mode and available while proposals are generated', async () => {
    const onSessionModeChange = vi.fn();
    const props = {
      projectId: 'blockout-project', projectFiles: [], streaming: false,
      onSessionModeChange, onEnsureProject: async () => 'blockout-project',
      onSend: vi.fn(), onStop: vi.fn(),
    };
    const { rerender } = render(<ChatComposer {...props} sessionMode="blockout" />);
    await flushMounts();
    expect(screen.getByRole('button', { name: 'Proposals' }).hasAttribute('aria-pressed')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Proposals' }));
    expect(onSessionModeChange).not.toHaveBeenCalled();
    rerender(<ChatComposer {...props} sessionMode="design" />);
    expect(screen.getByRole('button', { name: 'Proposals' }).hasAttribute('aria-pressed')).toBe(false);
    rerender(<ChatComposer {...props} sessionMode="blockout" streaming />);
    expect((screen.getByRole('button', { name: 'Proposals' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('does not expose a generic editor or blank blockout creation in the composer', async () => {
    render(<ChatComposer projectId="editor-identity" projectFiles={[]} streaming={false} onSessionModeChange={vi.fn()} onEnsureProject={async () => 'editor-identity'} onSend={vi.fn()} onStop={vi.fn()} />);
    await flushMounts();
    expect(screen.queryByRole('button', { name: 'Blockout editor' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Blockout' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Build it myself' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Blockout workspace' })).toBeNull();
  });
});
