import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Input, Select, Textarea } from '@open-design/components';
import { isOpenDesignHostAvailable, pickHostWorkingDir } from '@open-design/host';
import { DocumentSetupIntentSchema, type DocumentSetupIntent } from '@open-design/contracts';
import { dirExists, openFolderDialog } from '../../providers/registry';
import { useT } from '../../i18n';
import { fetchProjectLocations } from '../../state/project-locations';
import { RequestDeadlineError, withRequestDeadline } from '../../runtime/request-deadline';
import { useCreationWait } from '../useCreationWait';
import { Icon } from '../Icon';
import { DocumentWizardSteps } from './DocumentWizardSteps';
import styles from './DocumentSetup.module.css';

export interface DocumentStartDraft { projectName: string; intent: DocumentSetupIntent; workingDir: string | null; workingDirToken?: string }
const presets = {
  report: ['technical', 'illustrative', 'calculation', 'survey', 'other'],
  'tender-offer': ['complete-offer', 'methodology', 'experience', 'boards', 'other'],
  'tender-form': ['official-form', 'application', 'attachment', 'other'],
} as const;
export function DocumentStartDialog({ purpose, initialProjectName = '', initialFolder, initialWorkingDirToken, initialContextRoots = [], onCancel, onConfirm }: {
  purpose: string; initialProjectName?: string; initialFolder?: string | null; initialWorkingDirToken?: string; initialContextRoots?: string[];
  onCancel: () => void; onConfirm: (value: DocumentStartDraft) => void | boolean | Promise<void | boolean>;
}) {
  const t = useT();
  const [projectName, setProjectName] = useState(initialProjectName);
  const [kind, setKind] = useState<DocumentSetupIntent['kind'] | ''>('');
  const [preset, setPreset] = useState(''), [customType, setCustomType] = useState('');
  const [documentName, setDocumentName] = useState(''), [documentNameEdited, setDocumentNameEdited] = useState(false);
  const subtype = kind === 'other' || preset === 'other' ? customType.trim() : preset ? t(`documentStart.preset.${preset as typeof presets.report[number]}`) : '';
  const namedDocument = (documentNameEdited ? documentName : subtype || (kind ? t(`documentStart.kind.${kind}`) : '')).trim();
  const goal = purpose.trim() || t('documentStart.initialPurpose', { document: subtype || t(`documentStart.kind.${kind || 'free'}`) });
  const [destination, setDestination] = useState<'managed' | 'folder' | ''>(initialFolder ? 'folder' : '');
  const [folder, setFolder] = useState(initialFolder ?? ''), [token, setToken] = useState<string | undefined>(initialWorkingDirToken);
  const [roots, setRoots] = useState(initialContextRoots.join('\n'));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [validationExpired, setValidationExpired] = useState(false);
  const confirming = useRef(false);
  const validation = useRef<AbortController | null>(null);
  const creation = useCreationWait();
  const [step, setStep] = useState<0 | 1>(0);
  const [managedLocation, setManagedLocation] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [locationRetry, setLocationRetry] = useState(0);
  useEffect(() => {
    if (step !== 1) return;
    let canceled = false;
    const controller = new AbortController();
    setLocationStatus('loading');
    void fetchProjectLocations({ signal: controller.signal, throwOnError: true }).then((locations) => {
      if (canceled) return;
      const path = locations.find((location) => location.builtIn)?.path ?? null;
      setManagedLocation(path); setLocationStatus(path ? 'ready' : 'error');
    }).catch(() => { if (!canceled) { setManagedLocation(null); setLocationStatus('error'); } });
    return () => { canceled = true; controller.abort(); };
  }, [step, locationRetry]);
  useEffect(() => () => validation.current?.abort(), []);
  const stepName = (['document', 'folders'] as const)[step];
  async function pick(extra = false) {
    setError(''); setBusy(true);
    try {
      if (!extra && isOpenDesignHostAvailable()) {
        const result = await pickHostWorkingDir();
        if (result.ok) { setFolder(result.baseDir); setToken(result.token); setDestination('folder'); }
        else if (!('canceled' in result && result.canceled)) throw new Error('reason' in result && result.reason || t('documentStart.folderError'));
      } else {
        const result = await openFolderDialog({ throwOnError: true });
        if (result) {
          if (extra) setRoots((value) => [...new Set([...value.split('\n').filter(Boolean), result])].join('\n'));
          else { setFolder(result); setToken(undefined); setDestination('folder'); }
        }
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('documentStart.folderError')); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (confirming.current || busy || !projectName.trim() || !namedDocument || !kind || !destination) return;
    confirming.current = true;
    setBusy(true); setError(''); setValidationExpired(false);
    const controller = new AbortController();
    validation.current = controller;
    try {
      const contextRoots = [...new Set(roots.split('\n').map((value) => value.trim()).filter(Boolean))];
      const intent = DocumentSetupIntentSchema.parse({ kind, subtype, documentName: namedDocument, purpose: goal, contextRoots, imageIntakeConsent: false,
        intakeAnswers: { documentPreset: preset || kind, materialState: 'unsure', notes: purpose.trim() } });
      const selectedFolder = destination === 'folder' ? folder.trim() : null;
      const required = [...contextRoots, ...(selectedFolder ? [selectedFolder] : [])];
      if (destination === 'folder' && !selectedFolder) throw new Error(t('documentStart.folderRequired'));
      const valid = await withRequestDeadline((signal) => Promise.all(required.map(async (value) => ({ value, exists: await dirExists(value, { signal, throwOnError: true }) }))), { signal: controller.signal });
      const missing = valid.find((value) => !value.exists);
      if (missing) throw new Error(t('documentStart.folderMissing', { path: missing.value }));
      if (await creation.observe(() => onConfirm({ projectName: projectName.trim(), intent, workingDir: selectedFolder, ...(token && selectedFolder ? { workingDirToken: token } : {}) })) === false) setError(t('documentWizard.createFailed'));
    } catch (failure) { setValidationExpired(failure instanceof RequestDeadlineError); setError(failure instanceof RequestDeadlineError ? t('documentStart.validationTimeout') : failure instanceof Error && !('issues' in failure) ? failure.message : t('documentStart.required')); }
    finally { validation.current = null; confirming.current = false; setBusy(false); }
  }
  return <Dialog ariaLabel={t('documentStart.title')} className={styles.dialog} backdropClassName={styles.backdrop} includeChromeClassName={false} closeOnBackdrop={false}>
    <DocumentWizardSteps step={step} />
    <header className={styles.header}><div><h2>{t(`documentWizard.title.${stepName}`)}</h2><p>{t(`documentWizard.intro.${stepName}`)}</p></div><Button variant="ghost" aria-label={t('common.close')} disabled={busy} onClick={onCancel}><Icon name="close" size={20} /></Button></header>
    <div className={styles.form}>
      {step === 0 && <>
      <label>{t('documentStart.projectName')}<Input value={projectName} maxLength={240} disabled={busy} placeholder={t('documentStart.projectNameHint')} onChange={(event) => setProjectName(event.target.value)} /></label>
      <p>{t('documentStart.projectScopeHint')}</p>
      <div className={styles.twoColumns}><label>{t('documentStart.kind')}<Select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setPreset(''); }} disabled={busy}>
        <option value="">{t('documentStart.chooseKind')}</option>{(['report','tender-offer','tender-form','other','free'] as const).map((value) => <option key={value} value={value}>{t(`documentStart.kind.${value}`)}</option>)}
      </Select></label>{kind && kind in presets && <label>{t('documentStart.preset')}<Select value={preset} disabled={busy} onChange={(event) => setPreset(event.target.value)}><option value="">{t('documentStart.choosePreset')}</option>{presets[kind as keyof typeof presets].map((value) => <option key={value} value={value}>{t(`documentStart.preset.${value}`)}</option>)}</Select></label>}</div>
      {(kind === 'other' || preset === 'other') && <label>{t('documentStart.customType')}<Input value={customType} maxLength={120} disabled={busy} onChange={(event) => setCustomType(event.target.value)} /></label>}
      <label>{t('documentStart.documentName')}<Input value={documentNameEdited ? documentName : namedDocument} maxLength={240} disabled={busy} onChange={(event) => { setDocumentNameEdited(true); setDocumentName(event.target.value); }} /></label>
      </>}
      {step === 1 && <>
      <section className={styles.folderSection}><h3>{t('documentStart.destination')}</h3><p>{t('documentStart.destinationHint')}</p>
        <div className={styles.destinationChoices}><label><input type="radio" name="destination" disabled={busy} checked={destination === 'folder'} onChange={() => setDestination('folder')} />{t('documentStart.useFolder')}</label><label><input type="radio" name="destination" disabled={busy} checked={destination === 'managed'} onChange={() => setDestination('managed')} />{t('documentStart.managed')}</label></div>
        {destination === 'folder' && <div className={styles.folderRow}><Input aria-label={t('documentStart.workingFolder')} placeholder={t('documentStart.workingFolderHint')} value={folder} disabled={busy} onChange={(event) => { setFolder(event.target.value); setToken(undefined); }} /><Button variant="secondary" disabled={busy} onClick={() => void pick()}>{t('documentStart.browse')}</Button></div>}
        {destination === 'managed' && <div className={styles.storageLocation} role="status"><Icon name="folder" size={18} /><div><strong>{t('documentStart.storageLocation')}</strong><span>{locationStatus === 'loading' ? t('documentStart.storageLoading') : locationStatus === 'ready' ? managedLocation : t('documentStart.storageUnavailable')}</span>{locationStatus === 'error' && <Button variant="ghost" disabled={busy} onClick={() => setLocationRetry((value) => value + 1)}>{t('documentStart.reloadStorage')}</Button>}</div></div>}
        <label>{t('documentStart.extraFolders')}<Textarea rows={2} value={roots} disabled={busy} onChange={(event) => setRoots(event.target.value)} placeholder={t('documentStart.extraFoldersHint')} /></label>
        <Button variant="ghost" disabled={busy} onClick={() => void pick(true)}><Icon name="plus" size={15} />{t('documentStart.addContextFolder')}</Button><small>{t('documentStart.contextReadonly')}</small>
        <p className={styles.wizardNext}>{t('documentStart.folderNext')}</p>
      </section>
      </>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {creation.slow && <div role="status"><p>{t('projectCreation.slow')}</p><Button variant="secondary" onClick={creation.continueWaiting}>{t('projectCreation.continueWaiting')}</Button></div>}
    </div>
    <footer className={styles.footer}>
      <Button variant="ghost" disabled={busy} onClick={() => { setError(''); if (step === 0) onCancel(); else setStep(0); }}>{t(step === 0 ? 'common.cancel' : 'documentWizard.back')}</Button>
      {step === 0 ? <Button variant="primary" disabled={busy || !projectName.trim() || !namedDocument || !kind || (kind !== 'free' && !subtype)} onClick={() => { setError(''); setStep(1); }}>{t('documentWizard.next')}</Button> : <Button variant="primary" disabled={busy || !projectName.trim() || !namedDocument || !destination || (destination === 'folder' && !folder.trim())} onClick={() => void confirm()}>{busy ? t('common.loading') : t(validationExpired ? 'documentStart.retryValidation' : 'documentStart.openChat')}</Button>}
    </footer>
  </Dialog>;
}
