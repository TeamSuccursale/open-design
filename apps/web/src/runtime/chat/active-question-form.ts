import { splitOnQuestionForms } from '../../artifacts/question-form';
import { stripArtifact } from '../../artifacts/strip';

/** Match the transcript's interactive-form boundary: a later user turn retires
 * the question, while assistant-only host notices do not. Incomplete/quoted
 * payloads cannot hide recovery because they have no answerable controls. */
export function hasActiveQuestionForm(messages: readonly { role: string; content: string }[], suppressDirectionForms = false, options: { excludeHeaderFooterTargets?: boolean; requiredOnly?: boolean } = {}): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === 'user') return false;
    if (message.role !== 'assistant') continue;
    if (splitOnQuestionForms(stripArtifact(message.content)).some((segment) => segment.kind === 'form' && !(options.excludeHeaderFooterTargets && segment.form.headerFooterTarget) && (!options.requiredOnly || segment.form.questions.some((question) => question.required)) && !(suppressDirectionForms && (
      segment.form.id.toLowerCase() === 'direction'
      || segment.form.title.toLowerCase().includes('visual direction')
      || segment.form.questions.some((question) => question.type === 'direction-cards')
    )))) return true;
  }
  return false;
}
