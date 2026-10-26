import { useEffect, useId, useState } from 'react';
import { Button, Dialog, Input, Textarea } from '@open-design/components';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { useCreationWait } from './useCreationWait';
import styles from './FastProjectDialog.module.css';

export interface FastProjectDraft { name: string; prompt: string; files: File[] }
export function FastProjectDialog({ onCancel, onConfirm }: {
  onCancel: () => void; onConfirm: (draft: FastProjectDraft) => Promise<boolean | void> | boolean | void;
}) {
  const t = useT(), id = useId();
  const [name, setName] = useState(() => t('fastProject.title')), [prompt, setPrompt] = useState(''), [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const creation = useCreationWait();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.getElementById(`${id}-dialog`);
    if (!dialog) return;
    dialog.tabIndex = -1;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button, textarea, input, [tabindex]'))
      .filter((item) => !item.hasAttribute('disabled') && item.tabIndex >= 0)
      .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const nameInput = document.getElementById(`${id}-name`) as HTMLInputElement | null;
    nameInput?.focus(); nameInput?.select();
    const contain = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', contain, true);
    return () => { document.removeEventListener('keydown', contain, true); if (previous?.isConnected) previous.focus(); };
  }, [id]);
  function addFiles(selected: FileList | null) {
    const next = [...files];
    for (const file of Array.from(selected ?? [])) {
      if (!next.some((saved) => saved.name === file.name && saved.size === file.size && saved.lastModified === file.lastModified)) next.push(file);
    }
    if (next.length > 20 || next.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) { setError(t('fastProject.fileLimit')); return; }
    setFiles(next); setError('');
  }
  async function create() {
    if (busy || !name.trim()) return;
    setBusy(true); setError('');
    try {
      if (await creation.observe(() => onConfirm({ name: name.trim(), prompt: prompt.trim() || t('fastProject.startPrompt'), files })) === false) setError(t('fastProject.failed'));
    } catch { setError(t('fastProject.failed')); }
    finally { setBusy(false); }
  }
  return <Dialog id={`${id}-dialog`} ariaLabel={t('fastProject.title')} className={styles.dialog} backdropClassName={styles.backdrop} includeChromeClassName={false} closeOnBackdrop={false} closeOnEscape={!busy} onClose={onCancel}>
    <header className={styles.header}><div><h2>{t('fastProject.title')}</h2><p>{t('fastProject.intro')}</p></div><Button variant="ghost" aria-label={t('common.close')} disabled={busy} onClick={onCancel}><Icon name="close" size={20} /></Button></header>
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <label htmlFor={`${id}-name`}>{t('documentStart.projectName')}</label>
      <Input id={`${id}-name`} type="text" value={name} required maxLength={240} disabled={busy} placeholder={t('documentStart.projectNameHint')} onChange={(event) => setName(event.target.value)} />
      <label className={styles.goalLabel} htmlFor={`${id}-goal`}>{t('fastProject.goal')}</label>
      <Textarea id={`${id}-goal`} rows={3} maxLength={12_000} value={prompt} disabled={busy} placeholder={t('fastProject.goalHint')} onChange={(event) => setPrompt(event.target.value)} />
      <label className={styles.fileLabel} htmlFor={`${id}-files`}>{t('fastProject.files')}</label>
      <input id={`${id}-files`} type="file" multiple disabled={busy} onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
      <p className={styles.hint}>{t('fastProject.filesHint')}</p>
      {files.length ? <ul className={styles.files}>{files.map((file, index) => <li key={`${file.name}-${file.size}-${file.lastModified}`}><span>{file.name}</span><Button variant="ghost" disabled={busy} aria-label={t('fastProject.removeFile', { name: file.name })} onClick={() => setFiles((saved) => saved.filter((_, item) => item !== index))}><Icon name="close" size={15} /></Button></li>)}</ul> : null}
      <p className={styles.hint}>{t('fastProject.folderHint')}</p>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {creation.slow && <div role="status"><p>{t('projectCreation.slow')}</p><Button variant="secondary" onClick={creation.continueWaiting}>{t('projectCreation.continueWaiting')}</Button></div>}
      <footer className={styles.footer}><Button variant="ghost" disabled={busy} onClick={onCancel}>{t('common.cancel')}</Button><Button variant="primary" type="submit" disabled={busy || !name.trim()}>{t(busy ? 'fastProject.creating' : 'fastProject.create')}</Button></footer>
    </form>
  </Dialog>;
}
