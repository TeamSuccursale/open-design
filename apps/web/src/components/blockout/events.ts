import type { ComponentProps } from 'react';
import type { BlockoutTarget } from '@open-design/contracts';
import type { QuestionFormView } from '../QuestionForm';

export const BLOCKOUT_QUESTION_EVENT = 'melillodesign:blockout-question';
export const BLOCKOUT_OPEN_EVENT = 'melillodesign:blockout-open';
export const OPEN_BLOCKOUT_PROPOSALS_EVENT = 'melillodesign:blockout-proposals-open';
export interface BlockoutOpenRequest { projectId: string; documentId?: string; pageId?: string; variantId?: string; blockId?: string }
export interface BlockoutAgentRequest { text:string; attachments:import('@open-design/contracts').ChatAttachment[]; requestId:string; documentId:string }
export function openBlockoutEditor(request: BlockoutOpenRequest) { window.dispatchEvent(new CustomEvent<BlockoutOpenRequest>(BLOCKOUT_OPEN_EVENT, { detail: request })); }
/** Comparison is a separate navigation surface; opening it never opens or approves an editor page. */
export function openBlockoutProposals(request: BlockoutOpenRequest) { window.dispatchEvent(new CustomEvent<BlockoutOpenRequest>(OPEN_BLOCKOUT_PROPOSALS_EVENT, { detail: request })); }
export interface BlockoutQuestionRequest {
  key: string;
  projectId: string;
  conversationId: string | null;
  target: BlockoutTarget;
  props: ComponentProps<typeof QuestionFormView>;
}
export interface BlockoutQuestionEvent { request: BlockoutQuestionRequest; open: boolean }
const pending = new Map<string, BlockoutQuestionRequest>();
export function publishBlockoutQuestion(request: BlockoutQuestionRequest, open = true) {
  pending.set(`${request.projectId}:${request.conversationId ?? ''}`, request);
  window.dispatchEvent(new CustomEvent<BlockoutQuestionEvent>(BLOCKOUT_QUESTION_EVENT, { detail: { request, open } }));
}
export function pendingBlockoutQuestion(projectId: string, conversationId: string | null = null) { return pending.get(`${projectId}:${conversationId ?? ''}`) ?? null; }
export function clearBlockoutQuestion(projectId: string, conversationId: string | null, key: string) {
  const identity = `${projectId}:${conversationId ?? ''}`;
  if (pending.get(identity)?.key === key) pending.delete(identity);
}
