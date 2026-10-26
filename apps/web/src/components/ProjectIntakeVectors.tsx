import { useEffect, useState } from 'react';
import { Button, Input } from '@open-design/components';
import type { IntakeAsset, IntakeSelection, WorkspaceCollabContext } from '@open-design/contracts';
import { useT } from '../i18n';
import { projectRawUrl } from '../providers/registry';
import { updateIntakeVector } from '../providers/project-intake';
import styles from './ProjectGalleryDrawer.module.css';

interface Props {
  projectId: string; asset: IntakeAsset; note: string; workspaceContext?: WorkspaceCollabContext | null;
  onUpdate: (asset: IntakeAsset) => void; onAdd: (selection: IntakeSelection[]) => void;
}

export function ProjectIntakeVectors({ projectId, asset, note, workspaceContext, onUpdate, onAdd }: Props) {
  const t = useT();
  const versions = asset.vectorVersions ?? [];
  const preference = asset.vectorPreference;
  const [versionId, setVersionId] = useState(preference?.available ? preference.versionId : versions[0]?.id ?? '');
  const [reason, setReason] = useState(preference?.reason ?? '');
  const [file, setFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const selected = versions.find((version) => version.id === versionId);
  useEffect(() => {
    setReason(preference?.reason ?? '');
    setVersionId(preference?.available ? preference.versionId : versions[0]?.id ?? '');
  // Polling must not erase an explanation while it is being typed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id, preference?.updatedAt]);
  useEffect(() => {
    if (!versions.some((version) => version.id === versionId)) setVersionId(versions[0]?.id ?? '');
  }, [versions, versionId]);

  async function save(mode: 'link' | 'prefer' | 'clear') {
    setBusy(true); setError(''); setSaved(false);
    try {
      const result = await updateIntakeVector(projectId, asset.id, mode === 'link' ? { path: file.trim() } : { versionId: mode === 'clear' ? null : versionId, reason }, workspaceContext);
      onUpdate(result); setSaved(true);
      if (mode === 'link') setFile('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  return <section className={styles.versions} aria-label={t('intake.versions')}>
    <h4>{t('intake.versions')} · {versions.length}</h4>
    {preference && !preference.available ? <p role="status">{t('intake.preferenceChanged')}</p> : null}
    {versions.length ? <>
      <label>{t('intake.chooseVersion')}<select value={versionId} onChange={(event) => { setVersionId(event.target.value); setSaved(false); }}>
        {versions.map((version) => <option key={version.id} value={version.id}>{version.label}{preference?.available && preference.versionId === version.id ? ` · ${t('intake.preferred')}` : ''}</option>)}
      </select></label>
      {selected ? <>
        <a className={styles.vectorPreview} href={projectRawUrl(projectId, selected.path, workspaceContext)} target="_blank" rel="noopener noreferrer" aria-label={t('intake.openVector')}><img src={projectRawUrl(projectId, selected.path, workspaceContext)} alt={selected.label} /><span>{t('intake.openVector')}</span></a>
        <Button variant="secondary" onClick={() => onAdd([{ asset, note, attachmentPath: selected.path, draftText: [t('intake.useVector', { title: asset.title, version: selected.label }), note.trim()].filter(Boolean).join('\n\n') }])}>{t('intake.addVector')}</Button>
      </> : null}
      <label>{t('intake.preferenceReason')}<textarea value={reason} maxLength={12000} placeholder={t('intake.preferencePlaceholder')} onChange={(event) => { setReason(event.target.value); setSaved(false); }} /></label>
      <p>{t('intake.preferenceHint')}</p>
      <Button variant="secondary" disabled={busy || !selected || !reason.trim()} onClick={() => void save('prefer')}>{t('intake.savePreference')}</Button>
    </> : <p>{t('intake.noVectors')}</p>}
    {preference ? <Button variant="ghost" disabled={busy} onClick={() => void save('clear')}>{t('intake.clearPreference')}</Button> : null}
    <details><summary>{t('intake.linkVector')}</summary>
      <label>{t('intake.vectorPath')}<Input value={file} placeholder="designs/vector/…/v1.svg" onChange={(event) => setFile(event.target.value)} /></label>
      <Button variant="secondary" disabled={busy || !file.trim()} onClick={() => void save('link')}>{t('intake.linkVector')}</Button>
    </details>
    {saved ? <p role="status">{t('intake.vectorSaved')}</p> : null}
    {error ? <p role="alert" className={styles.errorText}>{error}</p> : null}
  </section>;
}
