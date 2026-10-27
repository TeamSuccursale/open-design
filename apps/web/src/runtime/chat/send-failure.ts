import type { ChatMessage } from '@open-design/contracts';

/** Keep a useful bounded reason on the failed user turn instead of a global run error. */
export function userSendFailureFromError(error: Error): ChatMessage['sendFailure'] {
  const detail = error as Error & { code?: unknown; status?: unknown; retryable?: unknown };
  const message = error.message.trim().slice(0, 1200);
  if (!message) return undefined;
  return { message,
    ...(typeof detail.code === 'string' ? { code: detail.code.slice(0, 200) } : {}),
    ...(typeof detail.status === 'number' && Number.isFinite(detail.status) ? { status: detail.status } : {}),
    ...(typeof detail.retryable === 'boolean' ? { retryable: detail.retryable } : {}),
  };
}

/**
 * A refusal the same request can never get past. The resend reuses the failed turn's request id, so after an
 * idempotency conflict it could only meet the same 409: the request already ran under that id.
 */
export function userSendFailureCanRetry(failure: ChatMessage['sendFailure']): boolean {
  return failure?.code !== 'IDEMPOTENCY_CONFLICT';
}

/** The engineer-facing explanation for a refusal whose daemon text names internals, or null to show that text. */
export function userSendFailureMessageKey(failure: ChatMessage['sendFailure']): 'chat.sendAlreadySent' | null {
  return failure?.code === 'IDEMPOTENCY_CONFLICT' ? 'chat.sendAlreadySent' : null;
}
