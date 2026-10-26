import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { renderAppliedHeaderFooterSvg, type HeaderFooterAsset, type HeaderFooterBlock, type HeaderFooterVariant } from '@open-design/contracts';
import { changeRecurringBlockSize, fitRecurringPageWidth, recurringBlockOutsideSafeArea, snapRecurringGeometry } from './geometry';
import styles from './HeaderFooterWorkspace.module.css';

const fieldLabels: Record<string, string> = { projectName: 'Nome progetto', documentName: 'Nome documento', pageNumber: '1', totalPages: '—', revision: '1' };
export function HeaderFooterPagePreview({ variant, assets, selectedId, onSelect, onTransform, structural = false, snap = true, highlight, projectName, documentName, header = true, footer = true, italian = true, fit = false, zoom = 1, totalPages = null, pageIndex = 0, visibleNumber = 1, revision = 1, appliedAt, isCover = false }: {
  variant: HeaderFooterVariant; assets: readonly HeaderFooterAsset[]; selectedId?: string | null;
  onSelect?: (id: string | null) => void; onTransform?: (id: string, change: Pick<HeaderFooterBlock, 'x' | 'y' | 'width' | 'height'>) => void;
  structural?: boolean; snap?: boolean; highlight?: { region?: 'header' | 'footer'; blockId?: string }; projectName?: string; documentName?: string;
  header?: boolean; footer?: boolean; italian?: boolean; fit?: boolean; zoom?: number;
  totalPages?: number | null; pageIndex?: number; visibleNumber?: number | null; revision?: number; appliedAt?: string; isCover?: boolean;
}) {
  const paperRef = useRef<HTMLDivElement>(null); const [fitWidth, setFitWidth] = useState<number | undefined>();
  useEffect(() => {
    const container = paperRef.current?.parentElement; if (!fit || !container) return;
    const measure = () => { const bounds = container.getBoundingClientRect(); const computed = getComputedStyle(container); const width = bounds.width - parseFloat(computed.paddingLeft || '0') - parseFloat(computed.paddingRight || '0'), height = bounds.height - parseFloat(computed.paddingTop || '0') - parseFloat(computed.paddingBottom || '0'); if (width > 0 && height > 0) setFitWidth(fitRecurringPageWidth(width, height, variant.pageWidthMm, variant.pageHeightMm, zoom)); };
    measure(); if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }
    const observer = new ResizeObserver(measure); observer.observe(container); return () => observer.disconnect();
  }, [fit, zoom, variant.pageWidthMm, variant.pageHeightMm]);
  const gesture = useRef<{ id: string; pointerId: number; mode: 'move' | 'resize'; block: HeaderFooterBlock; x: number; y: number; strip: DOMRect } | null>(null);
  const edit = Boolean(onTransform);
  const previewAssets = new Map(assets.map((asset) => [`preview-assets/${asset.id}`, asset.url]));
  const graphic = structural ? '' : renderAppliedHeaderFooterSvg({ version: 1, projectId: 'preview', documentId: 'preview', setId: null, revision, projectName: projectName ?? (italian ? 'Nome progetto' : 'Project name'), header, footer, showOnCover: true, appliedAt: appliedAt ?? new Date().toISOString(), design: { version: 1, name: 'Anteprima', guidance: '', stage: 'graphic', variants: [variant] }, assets: assets.map((asset) => ({ id: asset.id, mimeType: asset.mimeType, path: `preview-assets/${asset.id}` })) }, { widthMm: variant.pageWidthMm, heightMm: variant.pageHeightMm, documentName: documentName ?? (italian ? 'Nome documento' : 'Document name'), index: pageIndex, totalPages, visibleNumber, isCover, assetUrl: (safePath) => previewAssets.get(safePath) ?? '' });
  function begin(event: PointerEvent<HTMLDivElement>, block: HeaderFooterBlock) {
    if (!edit || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); onSelect?.(block.id); event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const strip = event.currentTarget.parentElement!.getBoundingClientRect();
    gesture.current = { id: block.id, pointerId: event.pointerId, mode: (event.target as HTMLElement).dataset.resize ? 'resize' : 'move', block, x: event.clientX, y: event.clientY, strip };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current; if (!current || current.pointerId !== event.pointerId || !current.strip.width || !current.strip.height) return;
    const dx = (event.clientX - current.x) / current.strip.width, dy = (event.clientY - current.y) / current.strip.height;
    const next = current.mode === 'resize' ? changeRecurringBlockSize(current.block, dx, dy, current.block.lockedRatio || event.shiftKey) : { ...current.block, x: current.block.x + dx, y: current.block.y + dy };
    const transformed = snapRecurringGeometry(next, snap && !event.altKey);
    onTransform?.(current.id, { x: Math.max(-1, Math.min(2, transformed.x)), y: Math.max(-1, Math.min(2, transformed.y)), width: Math.min(2, transformed.width), height: Math.min(2, transformed.height) });
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function fieldText(block: HeaderFooterBlock) {
    if (block.field === 'projectName') return projectName ?? (italian ? 'Nome progetto' : 'Project name');
    if (block.field === 'documentName') return documentName ?? (italian ? 'Nome documento' : 'Document name');
    if (block.field === 'date') return new Intl.DateTimeFormat(italian ? 'it-IT' : 'en-GB').format(new Date());
    if (block.field === 'totalPages') return totalPages === null ? '—' : String(totalPages);
    if (block.field === 'pageNumber') return visibleNumber === null ? '' : String(visibleNumber);
    if (block.field === 'revision') return String(revision);
    return fieldLabels[block.field ?? ''] ?? (italian ? 'Campo dinamico' : 'Dynamic field');
  }
  return <div ref={paperRef} className={styles.paper} data-testid="header-footer-page" data-width-mm={variant.pageWidthMm} data-height-mm={variant.pageHeightMm} data-page-index={pageIndex} data-cover={isCover || undefined} style={{ aspectRatio: `${variant.pageWidthMm} / ${variant.pageHeightMm}`, ...(fitWidth ? { width: fitWidth, maxWidth: 'none' } : {}) }} onClick={(event) => { if (event.target === event.currentTarget) onSelect?.(null); }}>
    {!structural && <div className={styles.actualGraphics} data-testid="header-footer-canonical-graphics" dangerouslySetInnerHTML={{ __html: graphic }} />}
    <div className={styles.bodyPlaceholder} style={{ top: `${(header ? variant.headerHeightMm : 0) / variant.pageHeightMm * 100 + 4}%`, bottom: `${(footer ? variant.footerHeightMm : 0) / variant.pageHeightMm * 100 + 4}%` }}>
      <strong>{isCover ? italian ? 'Copertina' : 'Cover' : italian ? 'Contenuto della pagina' : 'Page content'}</strong>
      <span>{italian ? 'Area riservata al contenuto della pagina. Qui modifichi solo intestazione e piè di pagina.' : 'Space reserved for page content. Here you edit only the header and footer.'}</span>
      <div className={styles.bodyLines} aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <i key={index} />)}</div>
    </div>
    {(['header', 'footer'] as const).filter((region) => region === 'header' ? header : footer).map((region) => <div key={region} className={styles.paperStrip} data-region={region} data-graphic={!structural || undefined} data-editable={edit || undefined} data-highlight={highlight?.region === region || undefined} style={{ height: `${(region === 'header' ? variant.headerHeightMm : variant.footerHeightMm) / variant.pageHeightMm * 100}%` }}>
      {edit && <><div className={styles.safeArea} aria-hidden="true" /><span className={styles.stripLabel}>{region === 'header' ? italian ? 'Intestazione' : 'Header' : italian ? 'Piè di pagina' : 'Footer'}</span></>}
      {variant.blocks.filter((block) => block.region === region).map((block) => {
        const asset = assets.find((item) => item.id === block.assetId);
        return <div key={block.id} className={styles.block} role={edit ? 'button' : undefined} tabIndex={edit ? 0 : undefined} aria-label={`${region === 'header' ? italian ? 'Intestazione' : 'Header' : italian ? 'Piè di pagina' : 'Footer'}: ${block.kind === 'logo' ? asset?.name ?? 'Logo' : block.kind === 'field' ? fieldText(block) : block.text || block.kind}`}
            data-editable={edit || undefined} data-selected={selectedId === block.id || undefined} data-highlight={highlight?.blockId === block.id || undefined} data-unsafe={edit && recurringBlockOutsideSafeArea(block) || undefined} data-structural={structural || undefined} data-graphic-overlay={!structural || undefined} data-testid={`header-footer-block-${block.id}`}
          style={{ left: `${block.x * 100}%`, top: `${block.y * 100}%`, width: `${block.width * 100}%`, height: `${block.height * 100}%`, fontSize: `${(block.fontSize ?? 10) * .3528 / variant.pageWidthMm * 100}cqw`, color: block.color ?? '#243d39', justifyContent: block.align === 'right' ? 'flex-end' : block.align === 'center' ? 'center' : 'flex-start', textAlign: block.align ?? 'left' }}
          onClick={(event) => { if (edit) { event.stopPropagation(); onSelect?.(block.id); } }} onPointerDown={(event) => begin(event, block)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
          onKeyDown={(event) => { if (!edit || event.target !== event.currentTarget) return; const amount = event.shiftKey ? .025 : .005; if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); onTransform?.(block.id, { x: block.x + (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0), y: block.y + (event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0), width: block.width, height: block.height }); } if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect?.(block.id); } }}>
          {structural ? <span>{block.kind === 'logo' ? asset?.name ?? 'Logo' : block.kind === 'field' ? fieldText(block) : block.kind === 'rule' ? italian ? 'Separatore' : 'Separator' : block.text || (italian ? 'Testo' : 'Text')}</span> : null}
          {edit && selectedId === block.id && <span className={styles.resize} data-resize="true" aria-hidden="true" />}
        </div>;
      })}
    </div>)}
  </div>;
}
