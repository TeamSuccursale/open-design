import { useEffect, useMemo, useState } from 'react';
import { Button, Input } from '@open-design/components';
import { blockoutImageFromAsset, intakeSourceLabel, type BlockoutImage, type IntakeAsset, type WorkspaceCollabContext } from '@open-design/contracts';
import { fetchProjectIntake } from '../../providers/project-intake';
import { projectRawUrl } from '../../providers/registry';
import { useT } from '../../i18n';
import styles from './BlockoutWorkspace.module.css';

export function BlockoutAssetPicker({ projectId, workspaceContext, value, onChange }: {
  projectId: string; workspaceContext?: WorkspaceCollabContext | null; value: BlockoutImage[]; onChange: (images: BlockoutImage[]) => void;
}) {
  const t = useT();
  const [assets, setAssets] = useState<IntakeAsset[]>([]), [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(false);
    void fetchProjectIntake(projectId, workspaceContext, undefined, controller.signal).then((catalog) => {
      if (!controller.signal.aborted) { setAssets(catalog.assets.filter((asset) => asset.status === 'ready')); setLoading(false); }
    }).catch(() => { if (!controller.signal.aborted) { setError(true); setLoading(false); } });
    return () => controller.abort();
  }, [projectId, workspaceContext, reload]);
  const visible = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return assets.filter((asset) => terms.every((term) => [asset.title, asset.description, asset.sourceName, ...asset.tags].join(' ').toLocaleLowerCase().includes(term)));
  }, [assets, query]);
  return <div className={styles.assetPicker}>
    <div className={styles.searchRow}><Input aria-label={t('blockout.searchGallery')} placeholder={t('blockout.searchGallery')} value={query} onChange={(event) => setQuery(event.target.value)} />
      <Button variant="ghost" onClick={() => setReload((n) => n + 1)}>{t('blockout.refresh')}</Button></div>
    {value.length > 0 && <div className={styles.chosenImages}>{value.map((image) => <Button key={image.assetId} variant="secondary" onClick={() => onChange(value.filter((item) => item.assetId !== image.assetId))} aria-label={t('blockout.removeImage', { name: image.title })}>
      <img src={projectRawUrl(projectId, image.imagePath, workspaceContext)} alt="" /><span>{image.title}</span><span aria-hidden>×</span>
    </Button>)}</div>}
    {loading ? <p role="status">{t('common.loading')}</p> : error ? <p role="alert">{t('blockout.galleryFailed')}</p> : !visible.length ? <p>{t('blockout.galleryEmpty')}</p> :
      <div className={styles.assetGrid}>{visible.map((asset) => <label key={asset.id}>
        <img src={projectRawUrl(projectId, asset.imagePath, workspaceContext)} alt="" loading="lazy" />
        <input type="checkbox" checked={value.some((image) => image.assetId === asset.id)} disabled={value.length >= 30 && !value.some((image) => image.assetId === asset.id)} onChange={() => onChange(value.some((image) => image.assetId === asset.id) ? value.filter((image) => image.assetId !== asset.id) : [...value, blockoutImageFromAsset(asset)])} />
        <span>{asset.title}</span><small>{intakeSourceLabel(asset, (name, page) => `${name} · ${page}`)}</small>
      </label>)}</div>}
  </div>;
}
