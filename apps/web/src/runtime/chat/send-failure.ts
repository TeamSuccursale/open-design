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
