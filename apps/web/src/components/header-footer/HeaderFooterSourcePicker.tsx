import { useEffect, useState } from 'react';
import { Button } from '@open-design/components';
import type { HeaderFooterSourceFilesResponse, HeaderFooterWorkspaceResponse, WorkspaceCollabContext } from '@open-design/contracts';
import { getHeaderFooterSourceFiles, importHeaderFooterSources } from '../../providers/header-footer';
import styles from './HeaderFooterWorkspace.module.css';

export function HeaderFooterSourcePicker({ projectId, context, italian, disabled, onImported }: { projectId: string; context?: WorkspaceCollabContext | null; italian: boolean; disabled?: boolean; onImported: (result: HeaderFooterWorkspaceResponse) => void }) {
  const c = (it: string, en: string) => italian ? it : en;
  const [result, setResult] = useState<HeaderFooterSourceFilesResponse | null>(null), [chosen, setChosen] = useState<string[]>([]), [attempt, setAttempt] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    const abort = new AbortController(); setError(''); setResult(null); setChosen([]);
    const timeout = window.setTimeout(() => { abort.abort(); setError(c('La lettura dei file non è terminata. Riprova.', 'Reading the files did not finish. Retry.')); }, 15_000);
    void getHeaderFooterSourceFiles(projectId, context, abort.signal).then((value) => { if (!abort.signal.aborted) setResult(value); }).catch((reason) => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); abort.abort(); };
  // Scope identity, rather than parent object allocation, controls this read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, JSON.stringify(context ?? null), attempt]);
  async function importChosen() {
    setBusy(true); setError(''); setNotice('');
    try {
      const value = await importHeaderFooterSources(projectId, chosen, context); onImported(value); setChosen([]);
      if (value.errors?.length) setError(value.errors.map((item) => `${item.name}: ${item.error}`).join(' · '));
      else setNotice(c('File importati. I loghi ricevuti sono nella raccolta qui sotto.', 'Files imported. Received logos appear in the collection below.'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  return <section className={styles.sourceFiles} aria-label={c('File già forniti al progetto', 'Files already supplied to this project')}>
    <h4>{c('Usa i file già forniti', 'Use files already supplied')}</h4>
    {error && <p role="alert">{error} <Button variant="ghost" onClick={() => setAttempt((value) => value + 1)} disabled={busy}>{c('Rileggi i file', 'Read files again')}</Button></p>}
    {!result && !error ? <p role="status">{c('Cerco immagini e ZIP nelle cartelle scelte…', 'Finding images and ZIPs in the selected folders…')}</p> : result?.files.length ? <>
      <p>{c('Scegli i file con i loghi da importare nella raccolta. La loro presenza nella cartella non li rende ancora loghi ricevuti.', 'Choose logo files to import into the collection. Files in a folder are not yet received logos.')}</p>
      <ul className={styles.sourceFileList}>{result.files.map((file) => <li key={file.id}><label className={styles.checkLabel}><input type="checkbox" checked={chosen.includes(file.id)} disabled={disabled || busy} onChange={(event) => setChosen((value) => event.target.checked ? [...value, file.id] : value.filter((id) => id !== file.id))} /><span><strong>{file.name}</strong><small>{file.folder} / {file.relativePath} · {file.kind === 'zip' ? 'ZIP' : c('Immagine', 'Image')}</small></span></label></li>)}</ul>
      {result.truncated && <p>{c('Elenco limitato ai primi 128 file nelle cartelle scelte. Puoi caricare direttamente altri loghi.', 'Showing up to 128 files in the selected folders. You can upload other logos directly.')}</p>}
      <Button variant="secondary" disabled={disabled || busy || chosen.length === 0} onClick={() => void importChosen()}>{busy ? c('Importazione…', 'Importing…') : c(`Importa ${chosen.length || ''} ${chosen.length === 1 ? 'file' : 'file'} nella raccolta`, `Import ${chosen.length || ''} files into collection`)}</Button>
    </> : result && <p>{c('Nessuna immagine o ZIP nelle cartelle scelte. Puoi caricare i loghi qui sotto.', 'No images or ZIPs found in the selected folders. You can upload logos below.')}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
