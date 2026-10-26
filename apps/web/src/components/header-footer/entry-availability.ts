import { hasActiveQuestionForm } from '../../runtime/chat/active-question-form';

/** Initial composition follows the editorial interview. Published models remain
 * editable throughout the document's life; targeted block questions use their
 * own editor bridge and must not be treated as another setup interview. */
export function headerFooterEntryAvailable({ applied, busy, messages, suppressDirectionForms = false }: {
  applied: boolean;
  busy: boolean;
  messages: readonly { role: string; content: string }[];
  suppressDirectionForms?: boolean;
}): boolean {
  return applied || (!busy && !hasActiveQuestionForm(messages, suppressDirectionForms, { excludeHeaderFooterTargets: true, requiredOnly: true }));
}
