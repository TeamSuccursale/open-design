import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Select } from '@open-design/components';
import type { BlockoutBlock, IntakeAsset, WorkspaceCollabContext } from '@open-design/contracts';
import { fetchProjectIntake } from '../../providers/project-intake';
import { projectRawUrl } from '../../providers/registry';
import { useT } from '../../i18n';
import { Icon } from '../Icon';
import styles from './BlockoutWorkspace.module.css';

export const BLOCKOUT_GALLERY_DRAG = 'application/x-melillodesign-blockout-images';
const PAGE_SIZE = 18;
export function BlockoutGalleryDrawer({ projectId, workspaceContext, selectedBlock, busy, onAssets, onUse, onClose, onRemove }: {
  projectId: string; workspaceContext?: WorkspaceCollabContext | null; selectedBlock?: BlockoutBlock; busy: boolean;
  onAssets: (assets: IntakeAsset[]) => void; onUse: (ids: string[]) => void; onClose: () => void;
  onRemove: (assetId: string) => void;
}) {
  const t = useT();
  const [assets, setAssets] = useState<IntakeAsset[]>([]), [query, setQuery] = useState(''), [source, setSource] = useState('');
  const [selected, setSelected] = useState<string[]>([]), [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(false);
    const timeout = setTimeout(() => { setLoading(false); setError(true); controller.abort(); }, 15000);
    void fetchProjectIntake(projectId, workspaceContext, undefined, controller.signal).then((catalog) => {
      clearTimeout(timeout); if (controller.signal.aborted) return;
      const ready = catalog.assets.filter((asset) => asset.status === 'ready');
      setAssets(ready); onAssets(ready); setLoading(false); setSelected((ids) => ids.filter((id) => ready.some((asset) => asset.id === id)));
    }).catch(() => { clearTimeout(timeout); if (!controller.signal.aborted) { setLoading(false); setError(true); } });
    return () => { clearTimeout(timeout); controller.abort(); };
  // Callback changes follow selection; they must not refetch the catalog.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, workspaceContext, reload]);
  const filtered = useMemo(() => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return assets.filter((asset) => (!source || asset.documentId === source) && terms.every((term) => [asset.title, asset.description, asset.sourceName, ...asset.tags].join(' ').toLocaleLowerCase().includes(term)));
  }, [assets, query, source]);
  const sources = [...new Map(assets.map((asset) => [asset.documentId, asset.sourceName])).entries()];
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), current = Math.min(page, pages - 1);
  function toggle(id: string) { setSelected((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : ids.length < 30 ? [...ids, id] : ids); }
  return <aside className={styles.galleryDrawer} aria-label={t('blockout.galleryDrawer')}>
    <header><h3>{t('blockout.galleryDrawer')}</h3><Button variant="ghost" aria-label={t('blockout.closeGallery')} onClick={onClose}><Icon name="close" size={18} /></Button></header>
    <p className={styles.galleryHint}>{t('blockout.galleryDragHint')}</p>
    <div className={styles.gallerySearch}>
      <Input aria-label={t('blockout.searchGallery')} placeholder={t('blockout.searchGallery')} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
      <Select aria-label={t('blockout.gallerySource')} value={source} onChange={(event) => { setSource(event.target.value); setPage(0); }}><option value="">{t('blockout.galleryAllSources')}</option>{sources.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select>
    </div>
    <div className={styles.galleryResults}>
      {loading ? <p role="status">{t('common.loading')}</p> : error ? <div role="alert"><p>{t('blockout.galleryFailed')}</p><Button variant="secondary" onClick={() => setReload((value) => value + 1)}>{t('blockout.refresh')}</Button></div> : !filtered.length ? <p>{t(assets.length ? 'blockout.galleryNoResults' : 'blockout.galleryEmpty')}</p> : <>
        <p className={styles.galleryCount}>{t('blockout.galleryResults', { count: filtered.length })}</p>
        <div className={styles.galleryTiles}>{filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((asset) => <article key={asset.id}>
          <button type="button" className={styles.galleryTile} draggable={!busy} aria-pressed={selected.includes(asset.id)} aria-label={t('blockout.gallerySelect', { name: asset.title })}
            title={asset.description} disabled={busy || selected.length >= 30 && !selected.includes(asset.id)} onClick={() => toggle(asset.id)}
            onDragStart={(event) => { const ids = selected.includes(asset.id) ? selected : [asset.id]; event.dataTransfer.setData(BLOCKOUT_GALLERY_DRAG, JSON.stringify(ids)); event.dataTransfer.effectAllowed = 'copy'; }}>
            <img src={projectRawUrl(projectId, asset.imagePath, workspaceContext)} alt="" loading="lazy" draggable={false} />
            <span className={styles.galleryCheck}>{selected.includes(asset.id) ? <Icon name="check" size={14} /> : null}</span>
          </button>
          <strong>{asset.title}</strong><small>{asset.sourceName} · {asset.page}</small>
        </article>)}</div>
      </>}
    </div>
    <footer>
      {pages > 1 && <nav aria-label={t('blockout.galleryPages')}><Button variant="ghost" aria-label={t('blockout.previousPage')} disabled={current <= 0} onClick={() => setPage(current - 1)}><Icon name="arrow-left" size={16} /></Button><span>{current + 1} / {pages}</span><Button variant="ghost" aria-label={t('blockout.nextPage')} disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}><Icon name="arrow-right" size={16} /></Button></nav>}
      <p>{selectedBlock ? t('blockout.galleryTarget', { name: selectedBlock.label }) : t('blockout.galleryChooseBlock')}</p>
      {selectedBlock && selectedBlock.images.length > 0 && <div className={styles.galleryLinked}>{selectedBlock.images.map((image) => <Button key={image.assetId} variant="ghost" disabled={busy} aria-label={t('blockout.removeImage', { name: image.title })} onClick={() => onRemove(image.assetId)}><span>{image.title}</span><Icon name="close" size={12} /></Button>)}</div>}
      <Button variant="secondary" disabled={busy || !selectedBlock || !selected.length} onClick={() => onUse(selected)}>{t('blockout.galleryUseSelection', { count: selected.length })}</Button>
      {selected.length > 0 && <Button variant="ghost" onClick={() => setSelected([])}>{t('blockout.galleryClearSelection')}</Button>}
    </footer>
  </aside>;
}
