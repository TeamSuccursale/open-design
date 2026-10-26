// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import type { ChatMessage } from '../../src/types';

afterEach(() => cleanup());

describe('ChatPane failed user sends', () => {
  it('offers a read retry before any history exists even though sending is disabled', () => {
    const retry = vi.fn();
    render(<ChatPane messages={[]} streaming={false} sendDisabled error="read unavailable" accessError="messages-unavailable" onRetryConversationRead={retry}
      projectId="project-1" projectFiles={[]} onEnsureProject={async () => 'project-1'} onSend={vi.fn()} onStop={vi.fn()}
      conversations={[]} activeConversationId="conversation-1" onSelectConversation={vi.fn()} onDeleteConversation={vi.fn()} />);
    fireEvent.click(screen.getByTestId('chat-conversation-read-retry'));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('routes the persistent retry action back to the host with the failed user row', () => {
    const failedUser: ChatMessage = {
      id: 'user-pre-run-failure',
      role: 'user',
      content: 'Build the landing page',
      createdAt: 1,
      sendFailed: true,
      sendFailure: { message: 'Reconnect the selected document folder before sending.', code: 'DOCUMENT_UNAVAILABLE', status: 409 },
    };
    const onResendUserMessage = vi.fn();

    render(
      <ChatPane
        messages={[failedUser]}
        streaming={false}
        error={null}
        projectId="project-1"
        projectFiles={[]}
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onResendUserMessage={onResendUserMessage}
        onStop={vi.fn()}
        conversations={[]}
        activeConversationId="conversation-1"
        onSelectConversation={vi.fn()}
        onDeleteConversation={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe('Reconnect the selected document folder before sending.');
    fireEvent.click(screen.getByTestId('user-send-failed'));

    expect(onResendUserMessage).toHaveBeenCalledTimes(1);
    expect(onResendUserMessage).toHaveBeenCalledWith(failedUser);
  });
});
