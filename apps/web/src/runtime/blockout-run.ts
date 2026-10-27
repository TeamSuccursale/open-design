import type { ChatMessage } from '../types';

/**
 * Whether the run in flight may still be writing Blockout proposals. A design run works on a document whose
 * structure was already approved, so while it runs the other documents' proposals stay open to choose.
 * An unknown mode keeps them locked.
 */
export function blockoutProposalsInFlight(messages: readonly Pick<ChatMessage, 'role' | 'sessionMode'>[], runInFlight: boolean): boolean {
  if (!runInFlight) return false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === 'assistant') return message.sessionMode !== 'design';
  }
  return true;
}
