import { useEffect, useState } from 'react';
import { Button, Input } from '@open-design/components';
import type { ProjectIntakeSettings, WorkspaceCollabContext } from '@open-design/contracts';
import { fetchIntakeSettings } from '../providers/project-intake';
import { openFolderDialog, replaceProjectWorkingDir } from '../providers/registry';
import { useT } from '../i18n';
import styles from './ProjectGalleryDrawer.module.css';

interface Props { projectId: string; workspaceContext?: WorkspaceCollabContext | null; processing: boolean }
export function ProjectIntakeFolders({ projectId, workspaceContext, processing }: Props) {
  const t = useT();
  const [settings, setSettings] = useState<ProjectIntakeSettings | null>(null);
  const [projectDir, setProjectDir] = useState('');
  const [sources, setSources] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetchIntakeSettings(projectId, workspaceContext, undefined, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setSettings(value); setProjectDir(value.projectDir); setSources(value.sourceDirs.join('\n')); setOutputDir(value.outputDir);
    }).catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => controller.abort();
  }, [projectId, workspaceContext]);
  async function save() {
    setBusy(true); setError(''); setSaved(false);
    try {
      const value = await fetchIntakeSettings(projectId, workspaceContext, { version: 1, sourceDirs: sources.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean), outputDir: outputDir.trim() });
      setSettings(value); setSources(value.sourceDirs.join('\n')); setOutputDir(value.outputDir); setSaved(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  async function browse() {
    setError('');
    try { const value = await openFolderDialog({ throwOnError: true }); if (value) setProjectDir(value); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }
  async function link() {
    setBusy(true); setError('');
    try { await replaceProjectWorkingDir(projectId, projectDir.trim(), undefined, workspaceContext); window.location.reload(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); setBusy(false); }
  }
  if (!settings) return <div className={styles.folders}>{error ? <p role="alert" className={styles.errorText}>{error}</p> : <p role="status">{t('intake.loading')}</p>}</div>;
  return <div className={styles.folders}>
    <div className={styles.folderEditor}>
      <section>
        <h3>{t('intake.projectFolder')}</h3>
        <p>{t('intake.projectFolderHint')}</p>
        <label className={styles.field}>{t('intake.projectPath')}<Input value={projectDir} onChange={(event) => setProjectDir(event.target.value)} disabled={busy || processing} /></label>
        <div className={styles.folderActions}><Button variant="secondary" disabled={busy || processing} onClick={() => void browse()}>{t('intake.browse')}</Button><Button variant="secondary" disabled={busy || processing || !projectDir.trim() || projectDir === settings.projectDir} onClick={() => void link()}>{t('intake.linkFolder')}</Button></div>
        <p>{t('intake.linkFolderHint')}</p>
      </section>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <h3>{t('intake.sourceFolders')}</h3>
        <p>{t('intake.sourceFoldersHint')}</p>
        <label className={styles.field}>{t('intake.extraPaths')}<textarea rows={3} value={sources} disabled={busy || processing} onChange={(event) => { setSources(event.target.value); setSaved(false); }} /></label>
        <label className={styles.field}>{t('intake.outputFolder')}<Input value={outputDir} disabled={busy || processing} onChange={(event) => { setOutputDir(event.target.value); setSaved(false); }} /></label>
        <p>{t('intake.outputFolderHint')}</p>
        <div className={styles.folderActions}><Button type="submit" variant="primary" disabled={busy || processing || !outputDir.trim()}>{t(busy ? 'intake.saving' : 'intake.saveFolders')}</Button>{saved ? <span role="status">{t('intake.foldersSaved')}</span> : null}</div>
      </form>
    </div>
    <section className={styles.storagePaths}>
      <h3>{t('intake.storageFormat')}</h3><p>{t('intake.storageFormatHint')}</p>
      <dl>{[[t('intake.configFile'), settings.configPath], [t('intake.catalogFile'), settings.catalogPath], [t('intake.extractedFiles'), settings.outputPath], [t('intake.uploadFolder'), settings.uploadPath]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </section>
    {processing ? <p role="status">{t('intake.waitForIntake')}</p> : null}
    {error ? <p role="alert" className={styles.errorText}>{error}</p> : null}
  </div>;
}
