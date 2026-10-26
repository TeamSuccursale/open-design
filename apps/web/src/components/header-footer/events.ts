export const HEADER_FOOTER_UPDATED_EVENT = 'melillodesign:header-footer-updated';
export const HEADER_FOOTER_REQUEST_EVENT = 'melillodesign:header-footer-request';
export interface HeaderFooterAgentRequest { projectId: string; documentId: string; setId?: string; action: 'propose' | 'refine' | 'question'; prompt: string; }
export function requestHeaderFooterAgent(detail: HeaderFooterAgentRequest) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(HEADER_FOOTER_REQUEST_EVENT, { detail }));
}
import type { ComponentProps } from 'react';
import type { HeaderFooterTarget } from '@open-design/contracts';
import type { QuestionFormView } from '../QuestionForm';

export const HEADER_FOOTER_QUESTION_EVENT = 'melillodesign:header-footer-question';
export interface HeaderFooterQuestionRequest { key: string; projectId: string; conversationId: string | null; target: HeaderFooterTarget; props: ComponentProps<typeof QuestionFormView> }
export interface HeaderFooterQuestionEvent { request: HeaderFooterQuestionRequest; open: boolean; clear?: boolean }
const pending = new Map<string, HeaderFooterQuestionRequest>();
export function publishHeaderFooterQuestion(request: HeaderFooterQuestionRequest, open = true) { pending.set(`${request.projectId}:${request.conversationId ?? ''}`, request); window.dispatchEvent(new CustomEvent<HeaderFooterQuestionEvent>(HEADER_FOOTER_QUESTION_EVENT, { detail: { request, open } })); }
export function pendingHeaderFooterQuestion(projectId: string, conversationId: string | null = null) { return pending.get(`${projectId}:${conversationId ?? ''}`) ?? null; }
export function clearHeaderFooterQuestion(projectId: string, conversationId: string | null, key: string) { const identity = `${projectId}:${conversationId ?? ''}`, request = pending.get(identity); if (request?.key !== key) return; pending.delete(identity); window.dispatchEvent(new CustomEvent<HeaderFooterQuestionEvent>(HEADER_FOOTER_QUESTION_EVENT, { detail: { request, open: false, clear: true } })); }
