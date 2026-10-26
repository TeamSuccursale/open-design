import { useEffect, useState } from 'react';
import { Button } from '@open-design/components';
import type { DocumentOverviewReading, WorkspaceCollabContext } from '@open-design/contracts';
import { useT } from '../../i18n';
import { fetchDocumentOverviewReading } from '../../providers/document-overview-reading';
import { Icon } from '../Icon';
import styles from './BlockoutWorkspace.module.css';

/** The daemon owns the job. Closing the overview never cancels its readers or a user's edits. */
export function BlockoutBackgroundRead({ projectId, workspaceContext, compact = false }: { projectId: string; workspaceContext?: WorkspaceCollabContext | null; compact?: boolean }) {
  const t = useT(), [reading, setReading] = useState<DocumentOverviewReading | null>(null), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(true);
  const identity = JSON.stringify(workspaceContext ?? null);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    setFailed(false); setPending(true);
    async function update(start = false) {
      try {
        const value = await fetchDocumentOverviewReading(projectId, workspaceContext, start ? { retry: retry > 0 } : undefined, controller.signal);
        if (controller.signal.aborted) return;
        setReading(value); setPending(false);
        if (value && ['queued', 'reading'].includes(value.status)) timer = setTimeout(() => { void update(); }, 2000);
      } catch { if (!controller.signal.aborted) { setFailed(true); setPending(false); } }
    }
    void update(true);
    return () => { controller.abort(); clearTimeout(timer); };
    // The serialized collaboration scope avoids restarting jobs on parent renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, identity, retry]);
  const active = !failed && (pending || Boolean(reading && ['queued', 'reading'].includes(reading.status)));
  const label = failed || reading?.status === 'failed' ? 'blockout.readingFailed' : reading?.status === 'complete' ? 'blockout.readingComplete'
    : reading?.status === 'partial' ? 'blockout.readingPartial' : reading?.status === 'not-ready' || (!reading && !pending) ? 'blockout.readingNotReady' : reading?.status === 'reading' ? 'blockout.readingRunning' : 'blockout.readingQueued';
  const contents = <>
    <div className={styles.readingSummary}><Icon name={active ? 'spinner' : failed || !reading || reading.status === 'failed' || reading.status === 'not-ready' ? 'info' : 'check'} size={15} /><span>{t(label)}</span>
      {!active && <Button variant="ghost" onClick={() => setRetry((value) => value + 1)}>{t('blockout.readingRetry')}</Button>}
    </div>
    {reading && (reading.workers.some((worker) => worker.result || worker.error) || reading.warnings.length > 0) && <details>
      <summary>{t('blockout.readingDetails')}</summary><p>{t('blockout.readingProposalHint')}</p><p>{reading.coverage}</p>
      {reading.workers.map((worker) => <div key={worker.id}>
        {worker.result && <><p>{worker.result.summary}</p><ul>{worker.result.notes.map((note, index) => <li key={index}>{note.text}
          {note.sourceIds.map((id) => { const source = reading.sources.find((item) => item.id === id); return source ? <small key={id}> · {source.title}{source.page ? `, p. ${source.page}` : ''}</small> : null; })}
        </li>)}</ul>{worker.result.questions.map((question, index) => <p key={index}>{question}</p>)}</>}
        {worker.error && <p>{worker.error}</p>}
      </div>)}
      {reading.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
    </details>}
  </>;
  if (compact) return <details className={styles.contextDisclosure}>
    <summary><Icon name={active ? 'spinner' : 'file-text'} size={14} /><span>{t('blockout.contextAction')}</span><small>{t(active ? 'blockout.contextWorking' : failed || reading?.status === 'failed' || reading?.status === 'partial' ? 'blockout.contextGaps' : reading?.status === 'complete' ? 'blockout.contextReady' : 'blockout.contextUnavailable')}</small></summary>
    <section className={styles.contextPanel} aria-label={t('blockout.readingTitle')}>{contents}</section>
  </details>;
  return <section className={styles.backgroundRead} aria-label={t('blockout.readingTitle')}>{contents}</section>;
}
