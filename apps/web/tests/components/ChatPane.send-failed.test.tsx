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
  it('explains an already-sent request instead of offering a retry that can only repeat the conflict', () => {
    // A stale queued copy of a request that already ran is refused with IDEMPOTENCY_CONFLICT. The resend reuses the
    // same request id, so "Riprova" could only meet the same refusal, under raw English daemon text.
    const duplicate: ChatMessage = {
      id: 'user-stale-copy', role: 'user', content: 'Brief confermato. Prepara tre proposte di struttura.', createdAt: 1, sendFailed: true,
      sendFailure: { message: 'clientRequestId is already associated with a different logical run request', code: 'IDEMPOTENCY_CONFLICT', status: 409 },
    };
    render(<ChatPane messages={[duplicate]} streaming={false} error={null} projectId="project-1" projectFiles={[]} onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()} onResendUserMessage={vi.fn()} onStop={vi.fn()} conversations={[]} activeConversationId="conversation-1" onSelectConversation={vi.fn()} onDeleteConversation={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toBe('This request was already sent; its reply is in this conversation, so there is nothing to resend.');
    expect(screen.queryByTestId('user-send-failed')).toBeNull();
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
