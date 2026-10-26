import { describe, expect, it } from 'vitest';
import { userSendFailureFromError } from '../../../src/runtime/chat/send-failure';

describe('failed user send details', () => {
  it('keeps the concrete reason and typed server verdict without inventing a run', () => {
    expect(userSendFailureFromError(Object.assign(new Error('Confirm the brief.'), { code: 'DOCUMENT_SETUP_CONFIRMATION_REQUIRED', status: 409, retryable: false })))
      .toEqual({ message: 'Confirm the brief.', code: 'DOCUMENT_SETUP_CONFIRMATION_REQUIRED', status: 409, retryable: false });
  });
  it('bounds excessive transport output and leaves absent reasons absent', () => {
    expect(userSendFailureFromError(new Error('x'.repeat(2000)))?.message).toHaveLength(1200);
    expect(userSendFailureFromError(new Error(' '))).toBeUndefined();
  });
});
