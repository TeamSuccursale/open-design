import { useEffect, useRef, type ComponentProps } from 'react';
import { Button } from '@open-design/components';
import { useI18n } from '../../i18n';
import { QuestionFormView } from '../QuestionForm';
import { Icon } from '../Icon';
import { clearHeaderFooterQuestion, publishHeaderFooterQuestion } from './events';

/** Uses the existing controlled answers and upload path in both chat and the docked inspector. */
export function HeaderFooterQuestionBridge({ projectId, conversationId = null, occurrenceKey, ...props }: ComponentProps<typeof QuestionFormView> & { projectId: string; conversationId?: string | null; occurrenceKey: string }) {
  const { locale } = useI18n(), first = useRef(false), latest = useRef(props); latest.current = props; const target = props.form.headerFooterTarget;
  const signature = JSON.stringify({ form: props.form, interactive: props.interactive, unanswered: props.unanswered, draftAnswers: props.draftAnswers, submitDisabled: props.submitDisabled, submitting: props.submitting });
  useEffect(() => { const value = latest.current; if (!value.form.headerFooterTarget || !value.interactive) { clearHeaderFooterQuestion(projectId, conversationId, occurrenceKey); return; } publishHeaderFooterQuestion({ key: occurrenceKey, projectId, conversationId, target: value.form.headerFooterTarget, props: { ...value, autoContinueAfterTimeout: false } }, !first.current); first.current = true; }, [projectId, conversationId, occurrenceKey, signature]);
  useEffect(() => () => clearHeaderFooterQuestion(projectId, conversationId, occurrenceKey), [projectId, conversationId, occurrenceKey]);
  return <><Button variant="secondary" onClick={() => target && publishHeaderFooterQuestion({ key: occurrenceKey, projectId, conversationId, target, props: { ...props, autoContinueAfterTimeout: false } })}><Icon name="layout" size={16} />{locale === 'it' ? 'Vedi la domanda su intestazione e piè di pagina' : 'View the question on the header and footer'}</Button><QuestionFormView {...props} autoContinueAfterTimeout={false} /></>;
}
