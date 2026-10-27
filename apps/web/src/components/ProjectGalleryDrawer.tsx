import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Input } from '@open-design/components';
import { canProposeIntakeVector, intakeSourceLabel, type IntakeAsset, type IntakeSelection, type ProjectIntakeCatalog, type WorkspaceCollabContext } from '@open-design/contracts';
import { useI18n, useT } from '../i18n';
import { projectRawUrl, uploadProjectFiles } from '../providers/registry';
import { fetchProjectIntake, proposeIntakeVector } from '../providers/project-intake';
import { Icon } from './Icon';
import { ProjectIntakeFolders } from './ProjectIntakeFolders';
import { ProjectIntakeVectors } from './ProjectIntakeVectors';
import styles from './ProjectGalleryDrawer.module.css';

interface Props {
  projectId: string;
  open: boolean;
  workspaceContext?: WorkspaceCollabContext | null;
  onClose: () => void;
  onAdd: (selection: IntakeSelection[]) => void;
}
const empty: ProjectIntakeCatalog = { version: 1, documents: [], assets: [] };

export function ProjectGalleryDrawer({ projectId, open, workspaceContext, onClose, onAdd }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const [catalog, setCatalog] = useState<ProjectIntakeCatalog>(empty);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [edge, setEdge] = useState<'top' | 'bottom'>(() => {
    try { return localStorage.getItem('melillodesign:gallery-edge') === 'top' ? 'top' : 'bottom'; } catch { return 'bottom'; }
  });
  const [order, setOrder] = useState<'newest' | 'oldest'>(() => {
    try { return localStorage.getItem('melillodesign:gallery-order') === 'oldest' ? 'oldest' : 'newest'; } catch { return 'newest'; }
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showFolders, setShowFolders] = useState(false);
  const [vectorBusy, setVectorBusy] = useState<string | null>(null);
  const drawer = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await fetchProjectIntake(projectId, workspaceContext, undefined, controller.signal);
        if (!controller.signal.aborted) { setCatalog(next); setLoading(false); }
      } catch (failure) {
        if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : String(failure)); setLoading(false); }
      }
      if (!controller.signal.aborted) timer = setTimeout(() => { void refresh(); }, 1800);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, projectId, workspaceContext]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    search.current?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, textarea, a[href]') ?? []);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, [open]);

  const visible = useMemo(() => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    // Items follow when their source arrived in the project; equal times keep the catalog's page order.
    const added = new Map(catalog.documents.map((document) => [document.id, Date.parse(document.addedAt ?? document.updatedAt) || 0]));
    const direction = order === 'oldest' ? 1 : -1;
    return catalog.assets.map((asset, index) => ({ asset, index, time: added.get(asset.documentId) ?? 0 }))
      .sort((a, b) => (a.time - b.time) * direction || a.index - b.index)
      .map(({ asset }) => asset)
      .filter((asset) => {
      if (kind && asset.kind !== kind) return false;
      // Page previews appear while extraction runs. Finished figures take
      // their place in the default view; full pages remain in their filter.
      if (!kind && asset.kind === 'page' && (asset.status === 'ready' || catalog.assets.some((other) => other.documentId === asset.documentId && other.page === asset.page && other.kind !== 'page'))) return false;
      const text = [asset.title, asset.description, asset.sourceName, ...asset.tags].join(' ').toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [catalog.assets, catalog.documents, kind, order, query]);
  const chosen = catalog.assets.filter((asset) => Object.hasOwn(selection, asset.id));
  const processing = catalog.documents.some((document) => ['queued', 'processing'].includes(document.status));

  async function intake(files?: File[]) {
    setBusy(true); setError('');
    try {
      let paths: string[] | undefined;
      if (files) {
        const result = await uploadProjectFiles(projectId, files, 'sources', workspaceContext);
        paths = result.uploaded.map((file) => file.path);
        if (!paths.length) throw new Error(result.error ?? t('intake.uploadFailed'));
        if (result.failed.length && mounted.current) setError(result.error ?? t('intake.uploadFailed'));
      }
      const next = await fetchProjectIntake(projectId, workspaceContext, { ...(paths ? { paths } : {}), retry: true });
      if (mounted.current) setCatalog(next);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (mounted.current) setBusy(false); }
  }
  function toggle(asset: IntakeAsset) {
    setSelection((current) => {
      const next = { ...current };
      if (Object.hasOwn(next, asset.id)) delete next[asset.id]; else next[asset.id] = '';
      return next;
    });
  }
  async function proposeVector(asset: IntakeAsset) {
    if (vectorBusy) return;
    setVectorBusy(asset.id); setError('');
    try {
      const note = selection[asset.id] ?? '';
      const proposal = await proposeIntakeVector(projectId, asset.id, { note, language: locale === 'it' ? 'it' : 'en' }, workspaceContext);
      if (!mounted.current) return;
      onAdd([{ asset: proposal.asset, note, draftText: proposal.prompt }]);
      setSelection((current) => { const next = { ...current }; delete next[asset.id]; return next; });
      onClose();
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (mounted.current) setVectorBusy(null); }
  }
  if (!open) return null;
  return createPortal(
    <div className={styles.overlay}>
      <button className={styles.backdrop} aria-label={t('intake.close')} onClick={onClose} tabIndex={-1} />
      <section ref={drawer} role="dialog" aria-modal="true" aria-labelledby="project-gallery-title" className={`${styles.drawer} ${edge === 'top' ? styles.top : styles.bottom}`}>
        <header className={styles.header}>
          <div><h2 id="project-gallery-title">{t('intake.title')}</h2><p>{t('intake.subtitle')}</p></div>
          <div className={styles.actions}>
            <Button variant="ghost" aria-pressed={showFolders} onClick={() => setShowFolders((value) => !value)}>{t(showFolders ? 'intake.backToGallery' : 'intake.folders')}</Button>
            <Button variant="ghost" onClick={() => { const next = edge === 'bottom' ? 'top' : 'bottom'; setEdge(next); try { localStorage.setItem('melillodesign:gallery-edge', next); } catch {} }}>
              <Icon name={edge === 'bottom' ? 'arrow-up' : 'chevron-down'} size={16} />{t(edge === 'bottom' ? 'intake.moveTop' : 'intake.moveBottom')}
            </Button>
            <Button variant="ghost" aria-label={t('intake.close')} onClick={onClose}><Icon name="close" size={18} /></Button>
          </div>
        </header>
        {showFolders ? <ProjectIntakeFolders projectId={projectId} workspaceContext={workspaceContext} processing={processing} /> : <><div className={styles.toolbar}>
          <Input ref={search} aria-label={t('intake.search')} placeholder={t('intake.search')} value={query} onChange={(event) => setQuery(event.target.value)} />
          <select aria-label={t('intake.filter')} value={kind} onChange={(event) => setKind(event.target.value)}>
            {['all', 'image', 'drawing', 'chart', 'table', 'page'].map((value) => <option key={value} value={value === 'all' ? '' : value}>{t(`intake.kind.${value}` as 'intake.kind.all')}</option>)}
          </select>
          <select aria-label={t('intake.sort')} value={order} onChange={(event) => { const next = event.target.value === 'oldest' ? 'oldest' : 'newest'; setOrder(next); try { localStorage.setItem('melillodesign:gallery-order', next); } catch {} }}>
            <option value="newest">{t('intake.sortNewest')}</option>
            <option value="oldest">{t('intake.sortOldest')}</option>
          </select>
          <input ref={upload} className={styles.fileInput} type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void intake(files); }} />
          <Button variant="secondary" disabled={busy} onClick={() => upload.current?.click()}><Icon name="attach" size={16} />{t('intake.addDocuments')}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void intake()}>{t('intake.scanFolder')}</Button>
        </div>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        <div className={styles.progress} role="status" aria-live="polite">
          {processing ? t('intake.processing') : t('intake.count', { count: visible.length })}
          {catalog.documents.map((document) => <span key={document.id} title={document.error}>{document.name} · {document.completedPages}/{document.pageCount || '…'} · {t(`intake.status.${document.status}` as 'intake.status.ready')}</span>)}
        </div>
        <div className={styles.body}>
          <div className={styles.results}>
            {loading ? <p className={styles.empty}>{t('intake.loading')}</p> : visible.length ? <div className={styles.grid}>
              {visible.map((asset) => <label key={asset.id} className={`${styles.asset} ${Object.hasOwn(selection, asset.id) ? styles.selected : ''}`}>
                <div className={styles.picture}><img src={projectRawUrl(projectId, asset.imagePath, workspaceContext)} alt={asset.title} loading="lazy" /><input type="checkbox" aria-label={t('intake.select', { title: asset.title })} checked={Object.hasOwn(selection, asset.id)} onChange={() => toggle(asset)} /></div>
                <strong>{asset.title}</strong><span>{intakeSourceLabel(asset, (name, page) => `${name} · ${t('intake.page', { page })}`)}</span>
                {asset.vectorVersions?.length ? <span>{t('intake.vectorCount', { count: asset.vectorVersions.length })}{asset.vectorPreference?.available ? ` · ${t('intake.preferred')}` : ''}</span> : null}
                <span className={styles.description}>{asset.description || t(`intake.status.${asset.status}` as 'intake.status.ready')}</span>
                {asset.error ? <span className={styles.errorText}>{t('intake.analysisFailed')}</span> : null}
              </label>)}
            </div> : <div className={styles.empty}><Icon name="image" size={32} /><h3>{t(catalog.assets.length ? 'intake.noResults' : 'intake.empty')}</h3><p>{t(catalog.assets.length ? 'intake.searchHint' : 'intake.emptyHint')}</p></div>}
          </div>
          <aside className={styles.selection} aria-label={t('intake.selection')}>
            <h3>{t('intake.selected', { count: chosen.length })}</h3>
            {chosen.length ? chosen.map((asset) => <div className={styles.note} key={asset.id}>
              <div className={styles.noteHeading}><img src={projectRawUrl(projectId, asset.imagePath, workspaceContext)} alt="" /><span>{asset.title}</span><Button variant="ghost" aria-label={t('intake.remove', { title: asset.title })} onClick={() => toggle(asset)}><Icon name="close" size={14} /></Button></div>
              <label>{t('intake.note')}<textarea value={selection[asset.id]} placeholder={t('intake.notePlaceholder')} onChange={(event) => setSelection((current) => ({ ...current, [asset.id]: event.target.value }))} /></label>
              {canProposeIntakeVector(asset) ? <div className={styles.vectorAction}>
                <Button variant="secondary" disabled={vectorBusy !== null} aria-busy={vectorBusy === asset.id} onClick={() => void proposeVector(asset)}><Icon name="file-code" size={14} />{t(vectorBusy === asset.id ? 'intake.vectorPreparing' : 'intake.vectorAction')}</Button>
                <p>{t('intake.vectorHint')}</p>
              </div> : null}
              {canProposeIntakeVector(asset) || asset.vectorVersions?.length ? <ProjectIntakeVectors projectId={projectId} asset={asset} note={selection[asset.id] ?? ''} workspaceContext={workspaceContext}
                onUpdate={(next) => setCatalog((current) => ({ ...current, assets: current.assets.map((item) => item.id === next.id ? next : item) }))}
                onAdd={(items) => { onAdd(items); onClose(); }} /> : null}
            </div>) : <p>{t('intake.selectionHint')}</p>}
          </aside>
        </div></>}
        <footer className={styles.footer}><span>{t('intake.draftHint')}</span><Button variant="primary" disabled={!chosen.length} onClick={() => { onAdd(chosen.map((asset) => ({ asset, note: selection[asset.id] ?? '' }))); setSelection({}); onClose(); }}>{t('intake.addToChat', { count: chosen.length })}</Button></footer>
      </section>
    </div>, document.body,
  );
}
