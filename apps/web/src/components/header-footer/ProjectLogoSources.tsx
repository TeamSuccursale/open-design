import { useEffect, useState } from 'react';
import { Button } from '@open-design/components';
import type { HeaderFooterSourceFilesResponse, WorkspaceCollabContext } from '@open-design/contracts';
import { useT } from '../../i18n';
import { getHeaderFooterSourceFiles } from '../../providers/header-footer';
import styles from './ProjectLogoSources.module.css';

/** A source receipt, not an import: the header/footer editor owns logo selection. */
export function ProjectLogoSources({ projectId, context }: { projectId: string; context?: WorkspaceCollabContext | null }) {
  const t = useT();
  const [result, setResult] = useState<HeaderFooterSourceFilesResponse | null>(null);
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const contextKey = JSON.stringify(context ?? null);
  useEffect(() => {
    const abort = new AbortController(); setResult(null); setFailed(false);
    const timeout = window.setTimeout(() => { abort.abort(); setFailed(true); }, 15_000);
    void getHeaderFooterSourceFiles(projectId, context, abort.signal).then((value) => {
      if (!abort.signal.aborted) setResult(value);
    }).catch(() => { if (!abort.signal.aborted) setFailed(true); }).finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); abort.abort(); };
    // Compare the authority's contents rather than the caller's object allocation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, contextKey, attempt]);
  if (failed) return <div className={styles.sources}><p role="status">{t('documentChat.logoSourcesFailed')}</p><Button variant="ghost" onClick={() => setAttempt((value) => value + 1)}>{t('documentChat.logoSourcesRetry')}</Button></div>;
  if (!result?.files.length) return null;
  return <details className={styles.sources}>
    <summary>{t('documentChat.logoSources')} <span>{result.files.length}{result.truncated ? '+' : ''}</span></summary>
    <ul>{result.files.map((file) => <li key={file.id}><span>{file.name}</span><small>{file.kind === 'zip' ? 'ZIP' : file.name.split('.').pop()?.toUpperCase()}</small></li>)}</ul>
    <p>{t('documentChat.logoSourcesHint')}</p>
  </details>;
}
