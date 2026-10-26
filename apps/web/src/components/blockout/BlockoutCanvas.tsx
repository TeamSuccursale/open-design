import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from '@open-design/components';
import { blockoutOutsideSafeArea, blockoutSafeArea, constrainBlockoutBox, resizeBlockoutBox, snapBlockoutBox, documentPresentationPageState, headerFooterReservations, type BlockoutBlock, type BlockoutBox, type BlockoutFitPage, type BlockoutGuide, type BlockoutImage, type BlockoutMaterialInventory, type BlockoutPage, type DocumentPresentation, type WorkspaceCollabContext } from '@open-design/contracts';
import { useT } from '../../i18n';
import { Icon } from '../Icon';
import { BlockoutMaterialPreview, structuralBlockRole } from './BlockoutMaterialPreview';
import styles from './BlockoutWorkspace.module.css';
import { BlockoutPagePresentation } from './BlockoutPagePresentation';
import { BLOCKOUT_GALLERY_DRAG } from './BlockoutGalleryDrawer';
import { BlockoutDesignUnderlay } from './BlockoutDesignUnderlay';
import type { BlockoutDesignUnderlay as DesignUnderlay } from '@open-design/contracts';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Gesture = { pointerId: number; mode: string; block: BlockoutBlock; startX: number; startY: number; paper: DOMRect; angle: number; centerX: number; centerY: number };

export function BlockoutCanvas({ page, presentation, pageIndex = 0, totalPages = 1, selectedId, questionBlockId, questionPage, projectId, workspaceContext, zoom, busy, snapEnabled, onSelect, onTransform, onAdd, onDelete, inventory, assessment, onImagesDrop, imageDrop, onImageDropChoice, onCancelImageDrop, designUnderlay, designProjectId }: {
  page: BlockoutPage; selectedId: string | null; questionBlockId?: string; questionPage: boolean; projectId: string;
  workspaceContext?: WorkspaceCollabContext | null; zoom: number; busy?: boolean; snapEnabled?: boolean;
  inventory?: BlockoutMaterialInventory | null; assessment?: BlockoutFitPage;
  presentation?: DocumentPresentation; pageIndex?: number; totalPages?: number;
  onSelect: (id: string | null) => void; onTransform: (id: string, box: BlockoutBox) => void; onAdd: () => void; onDelete: (id: string) => void;
  onImagesDrop?: (blockId: string, assetIds: string[]) => void;
  imageDrop?: { blockId: string; images: BlockoutImage[] } | null;
  onImageDropChoice?: (append: boolean) => void; onCancelImageDrop?: () => void;
  designUnderlay?: DesignUnderlay | null; designProjectId?: string;
}) {
  if (presentation?.headerFooter) {
    const state = documentPresentationPageState(presentation, { index: pageIndex, role: page.role });
    const reserved = headerFooterReservations(presentation.headerFooter, { widthMm: page.widthMm, heightMm: page.heightMm, isCover: state.isCover });
    page = { ...page, reservedHeaderMm: reserved.headerMm, reservedFooterMm: reserved.footerMm };
  }
  const t = useT(), viewport = useRef<HTMLDivElement>(null), paper = useRef<HTMLDivElement>(null), dropChoice = useRef<HTMLElement>(null);
  const gesture = useRef<Gesture | null>(null), latest = useRef<BlockoutBox | null>(null);
  const [preview, setPreview] = useState<{ id: string; box: BlockoutBox } | null>(null);
  const [guides, setGuides] = useState<BlockoutGuide[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [space, setSpace] = useState({ width: 800, height: 700 });
  useEffect(() => {
    if (!imageDrop || !dropChoice.current) return;
    const previous = document.activeElement as HTMLElement | null;
    dropChoice.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    dropChoice.current.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [imageDrop]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => { const bounds = element.getBoundingClientRect(); if (bounds.width && bounds.height) setSpace({ width: bounds.width, height: bounds.height }); };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const aspect = page.widthMm / page.heightMm;
  const safe = blockoutSafeArea(page);
  const width = Math.max(1, Math.min(space.width - 40, (space.height - 64) * aspect)) * zoom;
  function start(event: PointerEvent<HTMLDivElement>, block: BlockoutBlock) {
    if (busy || event.button !== 0 || !paper.current) return;
    event.preventDefault(); event.stopPropagation(); onSelect(block.id);
    event.currentTarget.focus(); event.currentTarget.setPointerCapture?.(event.pointerId);
    const bounds = paper.current.getBoundingClientRect();
    const centerX = bounds.left + (block.box.x + block.box.width / 2) / 100 * bounds.width;
    const centerY = bounds.top + (block.box.y + block.box.height / 2) / 100 * bounds.height;
    const mode = (event.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle ?? 'move';
    gesture.current = { pointerId: event.pointerId, mode, block, startX: event.clientX, startY: event.clientY, paper: bounds, centerX, centerY,
      angle: Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI };
    latest.current = block.box;
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    let dx = (event.clientX - current.startX) / current.paper.width * 100;
    let dy = (event.clientY - current.startY) / current.paper.height * 100;
    let box: BlockoutBox;
    if (current.mode === 'rotate') {
      let rotation = current.block.box.rotation + Math.atan2(event.clientY - current.centerY, event.clientX - current.centerX) * 180 / Math.PI - current.angle;
      rotation = ((rotation + 540) % 360) - 180;
      if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
      box = constrainBlockoutBox({ ...current.block.box, rotation });
    } else if (current.mode === 'move') {
      if (event.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      box = constrainBlockoutBox({ ...current.block.box, x: current.block.box.x + dx, y: current.block.box.y + dy });
    } else box = resizeBlockoutBox(current.block.box, current.mode, dx, dy, aspect, current.block.lockRatio || event.shiftKey);
    if (snapEnabled && !event.altKey && current.mode !== 'rotate') {
      const axis = current.mode === 'move' && event.shiftKey ? Math.abs(dx) > Math.abs(dy) ? 'x' : 'y' : undefined;
      const snapped = snapBlockoutBox(box, page, current.block.id, current.mode, 600 / current.paper.width, 600 / current.paper.height, current.block.lockRatio || event.shiftKey, axis);
      box = snapped.box; setGuides(snapped.guides);
    } else setGuides([]);
    latest.current = box; setPreview({ id: current.block.id, box });
  }
  function finish(event: PointerEvent<HTMLDivElement>, cancel = false) {
    if (!gesture.current || gesture.current.pointerId !== event.pointerId) return;
    const original = gesture.current.block.box;
    if (!cancel && latest.current && (['x', 'y', 'width', 'height', 'rotation'] as const).some((key) => latest.current![key] !== original[key])) {
      onTransform(gesture.current.block.id, latest.current);
    }
    gesture.current = null; latest.current = null; setPreview(null); setGuides([]);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div className={styles.canvasColumn}>
    {imageDrop && <section ref={dropChoice} className={styles.dropChoice} role="group" aria-label={t('blockout.galleryDropChoice')} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancelImageDrop?.(); } }}>
      <strong>{t('blockout.galleryDropTarget', { name: page.blocks.find((item) => item.id === imageDrop.blockId)?.label ?? '', count: imageDrop.images.length })}</strong>
      <div><Button variant="secondary" disabled={busy} onClick={() => onImageDropChoice?.(false)}>{t('blockout.galleryReplace')}</Button><Button variant="primary" disabled={busy} onClick={() => onImageDropChoice?.(true)}>{t('blockout.galleryAdd')}</Button><Button variant="ghost" aria-label={t('common.cancel')} onClick={onCancelImageDrop}><Icon name="close" size={16} /></Button></div>
    </section>}
    <div className={styles.viewport} ref={viewport}><div className={styles.paperSurround} style={{ width: width + 40, minHeight: width / aspect + 64 }}>
      <div className={`${styles.paper} ${questionPage ? styles.questionOutline : ''}`} ref={paper} role="group" aria-label={page.label || t('blockout.page')}
        data-testid="blockout-paper" data-question-target={questionPage || undefined} style={{ width, height: width / aspect, containerType: 'inline-size' }} onPointerDown={(event) => { if (event.target === event.currentTarget) onSelect(null); }}>
        {designUnderlay && <BlockoutDesignUnderlay value={designUnderlay} projectId={designProjectId ?? projectId} width={width} workspaceContext={workspaceContext} />}
        <div className={styles.safeArea} data-testid="blockout-safe-area" aria-hidden style={{ left: `${safe.left}%`, top: `${safe.top}%`, right: `${100 - safe.right}%`, bottom: `${100 - safe.bottom}%` }} />
        {!designUnderlay && <BlockoutPagePresentation presentation={presentation} index={pageIndex} role={page.role} widthMm={page.widthMm} heightMm={page.heightMm} totalPages={totalPages} workspaceContext={workspaceContext} />}
        {!page.blocks.length && <div className={styles.emptyPaper}>
          <Icon name="blocks" size={36} /><p>{t('blockout.emptyPage')}</p><Button variant="secondary" onClick={onAdd}>{t('blockout.addBlock')}</Button>
        </div>}
        {page.blocks.map((block, index) => {
          const box = preview?.id === block.id ? preview.box : block.box, selected = selectedId === block.id, outside = blockoutOutsideSafeArea(box, page);
          return <div key={block.id} role="group" tabIndex={0} aria-label={`${t('blockout.block')} ${index + 1}: ${block.label}`} data-testid={`blockout-block-${block.id}`}
            data-design-role={structuralBlockRole(block)} data-question-target={questionBlockId === block.id || undefined} data-outside-safe-area={outside || undefined} data-drop-target={dropTarget === block.id || imageDrop?.blockId === block.id || undefined} className={`${styles.block} ${selected ? styles.selectedBlock : ''} ${questionBlockId === block.id ? styles.questionOutline : ''} ${outside ? styles.unsafeBlock : ''}`}
            style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%`, transform: `rotate(${box.rotation}deg)` }}
            onDragOver={(event) => { if (!busy && onImagesDrop && event.dataTransfer.types.includes(BLOCKOUT_GALLERY_DRAG)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropTarget(block.id); } }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
            onDrop={(event) => {
              if (busy || !onImagesDrop || !event.dataTransfer.types.includes(BLOCKOUT_GALLERY_DRAG)) return;
              event.preventDefault(); event.stopPropagation(); setDropTarget(null);
              try { const ids: unknown = JSON.parse(event.dataTransfer.getData(BLOCKOUT_GALLERY_DRAG)); if (Array.isArray(ids) && ids.length <= 30 && ids.every((id) => typeof id === 'string')) onImagesDrop(block.id, ids); } catch { /* Other drags cannot attach project files. */ }
            }}
            onFocus={() => onSelect(block.id)} onPointerDown={(event) => start(event, block)} onPointerMove={move} onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)}
            onKeyDown={(event) => {
              if (busy || event.target !== event.currentTarget) return;
              const amount = event.shiftKey ? 5 : 1;
              if (event.key.startsWith('Arrow')) { event.preventDefault(); onTransform(block.id, constrainBlockoutBox({ ...box,
                x: box.x + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0),
                y: box.y + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0) })); }
              if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); onDelete(block.id); }
              if (event.key === 'Escape') onSelect(null);
            }}>
            <BlockoutMaterialPreview block={block} page={page} inventory={inventory} measurement={assessment?.blocks.find((entry) => entry.blockId === block.id)} projectId={projectId} workspaceContext={workspaceContext} paperWidth={width} designUnderlay={Boolean(designUnderlay)} />
            {outside && <span className={styles.safeWarning} title={t('blockout.outsideSafe')} aria-label={t('blockout.outsideSafe')}><Icon name="alert-triangle" size={12} /><span>{t('blockout.outsideSafeShort')}</span></span>}
            {selected && <>
              {HANDLES.map((handle) => <button key={handle} type="button" className={styles.handle} data-handle={handle} tabIndex={-1} aria-label={t('blockout.resizeHandle', { handle })} />)}
              <button type="button" className={styles.rotationHandle} data-handle="rotate" tabIndex={-1} aria-label={t('blockout.rotation')}><Icon name="refresh" size={13} /></button>
            </>}
          </div>;
        })}
        {guides.map((guide) => <div key={guide.axis} className={styles.snapGuide} aria-hidden data-axis={guide.axis} style={guide.axis === 'x' ? { left: `${guide.position}%` } : { top: `${guide.position}%` }} />)}
      </div>
      <div className={styles.pageCaption}>{page.widthMm} × {page.heightMm} mm · {t('blockout.safeMarginShort', { value: safe.marginMm })}</div>
    </div></div>
  </div>;
}
