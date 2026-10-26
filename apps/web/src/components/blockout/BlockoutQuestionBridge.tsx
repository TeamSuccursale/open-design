import { useEffect, useRef, type ComponentProps } from 'react';
import { Button } from '@open-design/components';
import { useT } from '../../i18n';
import { QuestionFormView } from '../QuestionForm';
import { Icon } from '../Icon';
import { clearBlockoutQuestion, publishBlockoutQuestion } from './events';

/** Embed the same question form in the page inspector, keeping the existing answer/upload path. */
export function BlockoutQuestionBridge({ projectId, conversationId = null, occurrenceKey, ...props }: ComponentProps<typeof QuestionFormView> & { projectId: string; conversationId?: string | null; occurrenceKey: string }) {
  const t = useT();
  const published = useRef(false);
  const target = props.form.blockoutTarget;
  useEffect(() => {
    if (!target || !props.interactive) return;
    publishBlockoutQuestion({ key: occurrenceKey, projectId, conversationId, target, props }, !published.current);
    published.current = true;
  }, [projectId, conversationId, occurrenceKey, target, props]);
  useEffect(() => () => clearBlockoutQuestion(projectId, conversationId, occurrenceKey), [projectId, conversationId, occurrenceKey]);
  return <>
    <Button variant="secondary" onClick={() => target && publishBlockoutQuestion({ key: occurrenceKey, projectId, conversationId, target, props })}>
      <Icon name="artboard" size={16} />{t('blockout.viewQuestion')}
    </Button>
    <QuestionFormView {...props} autoContinueAfterTimeout={false} />
  </>;
}
