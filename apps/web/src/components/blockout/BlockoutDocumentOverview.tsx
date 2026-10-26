import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Button, Dialog, Select } from '@open-design/components';
import { blockoutOutsideSafeArea, projectBlockoutBoxToPage, type BlockoutDocument, type BlockoutFitAssessment, type BlockoutMaterialInventory, type DocumentPresentation, type WorkspaceCollabContext } from '@open-design/contracts';
import { useT } from '../../i18n';
import { BlockoutBudgetCount } from './BlockoutPageBudget';
import { Icon } from '../Icon';
import { BlockoutFitSummary } from './BlockoutReadiness';
import { BlockoutMaterialPreview, structuralBlockRole } from './BlockoutMaterialPreview';
import styles from './BlockoutWorkspace.module.css';
import { BlockoutPagePresentation } from './BlockoutPagePresentation';

export interface OverviewBlockSelection { variantId: string; pageId: string; blockId: string }
const DRAG_TYPE = 'application/x-melillodesign-blockout-block';
function proposalName(label: string, index: number, fallback: string) {
  const name = label.trim().replace(/^[A-C](?:\s*[·:—–-]\s*|\.\s+)/, '');
  return name && !/^[A-C]$/.test(name) ? name : `${fallback} ${index + 1}`;
}

function ProposalPreview({ proposal, presentation, pageId, busy, pending, saving, error, onPage, onClose, onChoose }: {
  proposal: BlockoutDocument['variants'][number]; pageId: string; busy: boolean; pending?: boolean; saving: boolean; error: string;
  presentation?: DocumentPresentation;
  onPage: (pageId: string) => void; onClose: () => void; onChoose?: (editPageId?: string) => void;
}) {
  const t = useT(), root = useRef<HTMLDivElement>(null), close = useRef(onClose); close.current = onClose;
  const index = Math.max(0, proposal.pages.findIndex((page) => page.id === pageId)), page = proposal.pages[index]!;
  function navigatePage(nextPageId: string) {
    if (document.activeElement?.hasAttribute('aria-keyshortcuts')) root.current?.querySelector<HTMLButtonElement>('button')?.focus();
    onPage(nextPageId);
  }
  const navigation = useRef({ index, pages: proposal.pages, saving, onPage: navigatePage });
  navigation.current = { index, pages: proposal.pages, saving, onPage: navigatePage };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    root.current?.querySelector<HTMLButtonElement>('button')?.focus(); document.body.style.overflow = 'hidden';
    function keys(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); return; }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (!(event.target instanceof Element) || !root.current) return;
        // A pager button can lose focus when it becomes disabled on the first or last page.
        if (!root.current.contains(event.target) && event.target !== document.body) return;
        if (event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="textbox"], [role="slider"]')) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const current = navigation.current;
        const next = current.pages[current.index + (event.key === 'ArrowLeft' ? -1 : 1)];
        if (!current.saving && next) current.onPage(next.id);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)') ?? [])], first = controls[0], last = controls.at(-1);
      if (!root.current?.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', keys, true);
    return () => { document.removeEventListener('keydown', keys, true); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <Dialog className={styles.proposalPreviewDialog} ariaLabel={t('blockout.proposalPreview', { proposal: proposal.label })} onClose={onClose} closeOnBackdrop={!saving}>
    <div ref={root} className={styles.proposalPreviewInner}>
      <header className={styles.proposalPreviewHeader}><div><h2>{proposal.label}</h2><p>{t('blockout.proposalPreviewHint')}</p></div><Button variant="ghost" disabled={saving} aria-label={t('common.close')} onClick={onClose}><Icon name="close" size={18} /></Button></header>
      <div className={styles.proposalPreviewViewport}>
        <Button variant="secondary" className={`${styles.proposalPreviewArrow} ${styles.proposalPreviewPrevious}`} disabled={saving || index === 0} aria-label={t('blockout.previousPage')} aria-keyshortcuts="ArrowLeft" title={`${t('blockout.previousPage')} (←)`} onClick={() => navigatePage(proposal.pages[index - 1]!.id)}><Icon name="chevron-left" size={28} /></Button>
        <div className={styles.proposalPreviewBody}>
          <div className={`${styles.overviewPaper} ${styles.proposalPreviewPaper}`} role="img" aria-label={`${index + 1}. ${page.label || t('blockout.page')}`} style={{ aspectRatio: `${page.widthMm} / ${page.heightMm}`, width: `min(100%, calc((100dvh - 280px) * ${page.widthMm / page.heightMm}))`, containerType: 'inline-size' }}>
            <BlockoutPagePresentation presentation={presentation} index={index} role={page.role} widthMm={page.widthMm} heightMm={page.heightMm} totalPages={proposal.pages.length} />
            {page.blocks.map((block) => <span key={block.id} className={styles.overviewBlock} data-design-role={structuralBlockRole(block)} style={{ left: `${block.box.x}%`, top: `${block.box.y}%`, width: `${block.box.width}%`, height: `${block.box.height}%`, transform: `rotate(${block.box.rotation}deg)` }}><BlockoutMaterialPreview block={block} page={page} /></span>)}
          </div>
        </div>
        <Button variant="secondary" className={`${styles.proposalPreviewArrow} ${styles.proposalPreviewNext}`} disabled={saving || index === proposal.pages.length - 1} aria-label={t('blockout.nextPage')} aria-keyshortcuts="ArrowRight" title={`${t('blockout.nextPage')} (→)`} onClick={() => navigatePage(proposal.pages[index + 1]!.id)}><Icon name="chevron-right" size={28} /></Button>
      </div>
      <footer className={styles.proposalPreviewFooter}>
        <div className={styles.proposalPreviewNavigation}>
          <Select aria-label={t('blockout.previewPageSelector')} value={page.id} disabled={saving} onChange={(event) => onPage(event.target.value)}>{proposal.pages.map((item, pageIndex) => <option key={item.id} value={item.id}>{pageIndex + 1} / {proposal.pages.length} · {item.label || t('blockout.page')}</option>)}</Select>
        </div>
        <div className={styles.proposalPreviewActions}>
          <Button variant="secondary" disabled={busy || saving || !onChoose} onClick={() => onChoose?.()}>{t('blockout.chooseStructure')}</Button>
          <Button variant="primary" disabled={busy || saving || !onChoose} onClick={() => onChoose?.(page.id)}>{t('blockout.chooseAndEditPage')}</Button>
        </div>
        <div className={styles.proposalPreviewStatus} role={error ? 'alert' : 'status'}>{pending && !error && <progress aria-label={t('blockout.completingProposals')} />}{error || t(pending ? 'blockout.completingProposals' : saving ? 'blockout.savingSelection' : 'blockout.selectionOnlyHint')}</div>
      </footer>
    </div>
  </Dialog>;
}

/** The document is the comparison unit; every proposal keeps its own complete page sequence. */
export function BlockoutDocumentOverview({ document, previewDocument = document, budgetDocument = document, pageNumberOffset = 0, busy = false, choicesPending = false, presentation = 'comparison', onOpenPage, onSelectProposal, onMoveBlock, onCountPage, onReorderPages, inventory, assessment, projectId, workspaceContext }: {
  document: BlockoutDocument; busy?: boolean; choicesPending?: boolean; presentation?: 'comparison' | 'selected' | 'proposals';
  budgetDocument?: BlockoutDocument; previewDocument?: BlockoutDocument; pageNumberOffset?: number;
  inventory?: BlockoutMaterialInventory | null; assessment?: BlockoutFitAssessment | null; projectId?: string; workspaceContext?: WorkspaceCollabContext | null;
  onOpenPage: (variantId: string, pageId: string, blockId?: string) => void;
  onSelectProposal?: (variantId: string, editPageId?: string) => void | Promise<void>;
  onMoveBlock?: (source: OverviewBlockSelection, targetPageId: string) => boolean;
  onCountPage?: (variantId: string, pageId: string, counted: boolean) => void;
  onReorderPages?: (variantId: string, pageIds: string[]) => void;
}) {
  const t = useT(), [selected, setSelected] = useState<OverviewBlockSelection | null>(null), [destination, setDestination] = useState(''), [announcement, setAnnouncement] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ variantId: string; pageId: string } | null>(null);
  const [savingSelection, setSavingSelection] = useState(false), [selectionError, setSelectionError] = useState('');
  const selecting = useRef(false);
  const previewVariant = previewDocument.variants.find((variant) => variant.id === preview?.variantId);
  const selectedVariant = document.variants.find((item) => item.id === selected?.variantId);
  const sourcePage = selectedVariant?.pages.find((item) => item.id === selected?.pageId);
  const selectedBlock = sourcePage?.blocks.find((item) => item.id === selected?.blockId);
  async function chooseProposal(variantId: string, editPageId?: string) {
    if (!onSelectProposal || busy || choicesPending || selecting.current) return;
    selecting.current = true; setSavingSelection(true); setSelectionError('');
    try {
      await (editPageId ? onSelectProposal(variantId, editPageId) : onSelectProposal(variantId));
      setPreview(null); setAnnouncement(t('blockout.selectionSaved'));
    } catch { setSelectionError(t('blockout.selectionSaveFailed')); }
    finally { selecting.current = false; setSavingSelection(false); }
  }
  function closePreview() { if (!selecting.current) setPreview(null); }
  function select(value: OverviewBlockSelection) { setSelected(value); setDestination(''); }
  function move(value: OverviewBlockSelection, targetPageId: string) {
    if (busy || !onMoveBlock) return;
    const variant = document.variants.find((item) => item.id === value.variantId);
    const sourcePage = variant?.pages.find((item) => item.id === value.pageId);
    const block = sourcePage?.blocks.find((item) => item.id === value.blockId);
    const target = variant?.pages.find((item) => item.id === targetPageId);
    if (!block || !target || !onMoveBlock(value, targetPageId)) { setAnnouncement(t('blockout.moveFailed')); return; }
    const scaled = sourcePage ? projectBlockoutBoxToPage(block.box, sourcePage, target).scaled : false;
    setAnnouncement(`${t('blockout.moved', { block: block.label || t('blockout.block'), page: target.label || t('blockout.page') })}${scaled ? ` ${t('blockout.moveScaled')}` : ''}`); setSelected(null); setDestination(''); setDropTarget(null);
  }
  function drop(event: DragEvent, variantId: string, pageId: string) {
    event.preventDefault(); setDropTarget(null);
    try {
      const value = JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as OverviewBlockSelection;
      // Reallocation stays inside a proposal; alternatives remain independent.
      if (value.variantId === variantId && value.pageId !== pageId) move(value, pageId);
    } catch { setAnnouncement(t('blockout.moveFailed')); }
  }
  if (presentation === 'proposals') return <div className={styles.documentOverview} data-presentation="proposals" aria-label={t('blockout.overview')}>
    {!preview && (selectionError || savingSelection || announcement) && <p className={styles.overviewAnnouncement} role={selectionError ? 'alert' : 'status'}>{selectionError || (savingSelection ? t('blockout.savingSelection') : announcement)}</p>}
    <div className={styles.overviewProposals}>{document.variants.map((variant, variantIndex) => {
      const proposal = proposalName(variant.label, variantIndex, t('blockout.proposal'));
      return <section className={styles.overviewProposal} key={variant.id} aria-label={proposal}>
        <header><div><h3>{proposal}</h3><BlockoutBudgetCount document={budgetDocument} variantId={variant.id} /></div></header>
        {document.planningStage === 'composition' ? <BlockoutFitSummary assessment={assessment} variantId={variant.id} /> : <p className={styles.overviewStructureHint}>{t('blockout.structureHint')}</p>}
        <Button variant="secondary" disabled={busy || choicesPending || savingSelection || !onSelectProposal} onClick={() => void chooseProposal(variant.id)}>{t('documentWorkspace.chooseNamed', { name: proposal })}<Icon name="arrow-right" size={15} /></Button>
        <div className={styles.overviewPages}>{variant.pages.map((page, index) => <article key={page.id} className={styles.overviewPage} data-testid={`overview-page-${variant.id}-${page.id}`}>
          <button type="button" className={styles.overviewPreviewButton} disabled={busy || savingSelection} aria-label={t('blockout.previewPage', { page: page.label || t('blockout.page'), proposal })} onClick={() => { setSelectionError(''); setPreview({ variantId: variant.id, pageId: page.id }); }}>
            <span className={styles.overviewPageHeading}><strong title={page.label}>{index + pageNumberOffset + 1}. {page.label || t('blockout.page')}</strong><span>{page.widthMm} × {page.heightMm} mm</span></span>
            <span className={styles.overviewPaper} style={{ aspectRatio: `${page.widthMm} / ${page.heightMm}`, containerType: 'inline-size' }}>
            <BlockoutPagePresentation presentation={document.presentation} index={index + pageNumberOffset} role={page.role} widthMm={page.widthMm} heightMm={page.heightMm} totalPages={variant.pages.length} />
            {page.blocks.map((block) => <span key={block.id} className={styles.overviewBlock} data-design-role={structuralBlockRole(block)} style={{ left: `${block.box.x}%`, top: `${block.box.y}%`, width: `${block.box.width}%`, height: `${block.box.height}%`, transform: `rotate(${block.box.rotation}deg)` }}>
              <BlockoutMaterialPreview block={block} page={page} compact />
            </span>)}
            </span>
            <span className={styles.overviewPreviewHint} aria-hidden="true"><Icon name="maximize" size={14} />{t('common.openPreview')}</span>
          </button>
        </article>)}</div>
      </section>;
    })}</div>
    {preview && previewVariant && <ProposalPreview presentation={previewDocument.presentation} proposal={{ ...previewVariant, label: proposalName(previewVariant.label, previewDocument.variants.indexOf(previewVariant), t('blockout.proposal')) }} pageId={preview.pageId} busy={busy || choicesPending} pending={choicesPending} saving={savingSelection} error={selectionError} onPage={(pageId) => setPreview({ variantId: preview.variantId, pageId })} onClose={closePreview} onChoose={onSelectProposal ? (editPageId) => { void chooseProposal(preview.variantId, editPageId); } : undefined} />}
  </div>;
  return <div className={styles.documentOverview} data-presentation={presentation} aria-label={t('blockout.overview')}>
    {(presentation !== 'selected' || onMoveBlock) && <p className={styles.overviewIntro}>{onMoveBlock ? t('blockout.overviewHint') : t('blockout.fileHint')}</p>}
    {selected && selectedBlock && onMoveBlock && <div className={styles.moveBar}>
      <strong>{t('blockout.moveSelected', { block: selectedBlock.label || t('blockout.block') })}</strong>
      <label>{t('blockout.moveDestination')}<Select aria-label={t('blockout.moveDestination')} value={destination} disabled={busy} onChange={(event) => setDestination(event.target.value)}><option value="">—</option>{selectedVariant?.pages.filter((page) => page.id !== selected.pageId && page.blocks.length < 200).map((page, index) => <option key={page.id} value={page.id}>{page.label || `${t('blockout.page')} ${index + 1}`}</option>)}</Select></label>
      <Button variant="secondary" disabled={busy || !destination} onClick={() => move(selected, destination)}>{t('blockout.moveToPage')}</Button>
      <p>{t('blockout.moveHint')}</p>
    </div>}
    <div className={styles.overviewAnnouncement} aria-live="polite">{announcement}</div>
    <div className={styles.overviewProposals}>{document.variants.map((variant, variantIndex) => {
      const proposal = variant.label ? proposalName(variant.label, variantIndex, t('blockout.proposal')) : variantIndex === 0 ? t('blockout.yourBrief') : `${t('blockout.proposal')} ${variantIndex + 1}`;
      return <section className={styles.overviewProposal} key={variant.id} aria-label={proposal} data-current={document.activeVariantId === variant.id || undefined}>
        <header><div><h3>{proposal}</h3><BlockoutBudgetCount document={budgetDocument} variantId={variant.id} /></div>
          {onSelectProposal && <Button variant={document.activeVariantId === variant.id ? 'secondary' : 'ghost'} disabled={busy || choicesPending} aria-pressed={document.activeVariantId === variant.id} onClick={() => onSelectProposal(variant.id)}>{t(document.activeVariantId === variant.id ? 'blockout.currentProposal' : 'blockout.selectProposal')}</Button>}
        </header>
        {document.planningStage === 'composition' ? <BlockoutFitSummary assessment={assessment} variantId={variant.id} /> : <p className={styles.overviewStructureHint}>{t('blockout.structureHint')}</p>}
        <div className={styles.overviewPages}>{variant.pages.map((page, index) => {
          const pageName = page.label || `${t('blockout.page')} ${index + 1}`, highlighted = dropTarget === `${variant.id}:${page.id}`;
          const openLabel = t('blockout.openPage', { page: pageName, proposal });
          return <article key={page.id} className={styles.overviewPage} data-drop={highlighted || undefined} data-testid={`overview-page-${variant.id}-${page.id}`}
            onDragOver={(event) => { if (busy || !onMoveBlock || !event.dataTransfer.types.includes(DRAG_TYPE) || selected?.variantId !== variant.id || selected.pageId === page.id || page.blocks.length >= 200) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(`${variant.id}:${page.id}`); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
            onDrop={(event) => drop(event, variant.id, page.id)}>
            <div className={styles.overviewPageHeading}><strong>{index + pageNumberOffset + 1}. {pageName}</strong><span>{page.widthMm} × {page.heightMm} mm</span></div>
            {onReorderPages && <div className={styles.overviewPageOrder}>{([-1, 1] as const).map((direction) => <Button key={direction} variant="ghost" disabled={busy || index + direction < 0 || index + direction >= variant.pages.length} aria-label={t(direction < 0 ? 'blockout.pageEarlier' : 'blockout.pageLater', { page: pageName })} onClick={() => {
              const ids = variant.pages.map((item) => item.id); [ids[index], ids[index + direction]] = [ids[index + direction]!, ids[index]!]; onReorderPages(variant.id, ids);
            }}><Icon name={direction < 0 ? 'arrow-left' : 'arrow-right'} size={13} /></Button>)}</div>}
            <div className={styles.overviewPaper} style={{ aspectRatio: `${page.widthMm} / ${page.heightMm}`, containerType: 'inline-size' }}>
              <BlockoutPagePresentation presentation={document.presentation} index={index + pageNumberOffset} role={page.role} widthMm={page.widthMm} heightMm={page.heightMm} totalPages={variant.pages.length} />
              <button type="button" className={styles.overviewPageHit} aria-label={openLabel} disabled={busy} onClick={() => onOpenPage(variant.id, page.id)} />
              {page.blocks.map((block) => <button type="button" key={block.id} disabled={busy} draggable={Boolean(onMoveBlock) && !busy}
                className={styles.overviewBlock} data-design-role={structuralBlockRole(block)} data-selected={selected?.variantId === variant.id && selected.pageId === page.id && selected.blockId === block.id || undefined} data-unsafe={blockoutOutsideSafeArea(block.box, page) || undefined}
                aria-label={t('blockout.selectForMove', { block: block.label || t('blockout.block'), page: pageName, proposal })}
                style={{ left: `${block.box.x}%`, top: `${block.box.y}%`, width: `${block.box.width}%`, height: `${block.box.height}%`, transform: `rotate(${block.box.rotation}deg)` }}
                title={block.expectation || block.label} onClick={() => onMoveBlock ? select({ variantId: variant.id, pageId: page.id, blockId: block.id }) : onOpenPage(variant.id, page.id, block.id)}
                onDoubleClick={() => onOpenPage(variant.id, page.id, block.id)}
                onDragStart={(event) => { const value = { variantId: variant.id, pageId: page.id, blockId: block.id }; select(value); event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(value)); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDropTarget(null)}>
                <BlockoutMaterialPreview block={block} page={page} compact />
              </button>)}
              {!page.blocks.length && <span className={styles.overviewEmpty}>{t('blockout.noBlocks')}</span>}
            </div>
            <Button variant="ghost" disabled={busy || choicesPending} aria-label={`${t(presentation === 'selected' ? 'blockout.pageEditor' : 'blockout.editProposal')}: ${proposal} · ${pageName}`} onClick={() => onOpenPage(variant.id, page.id)}>{t('blockout.pageEditor')}</Button>
            <p className={styles.overviewPurpose}><strong>{t('blockout.pagePurpose')}</strong> {page.expectation || t('blockout.noPurpose')}</p>
            {onCountPage ? <label className={styles.overviewCounting} title={t('blockout.exclusionHint')}><input type="checkbox" disabled={busy} checked={page.countsTowardLimit !== false} onChange={(event) => onCountPage(variant.id, page.id, event.target.checked)} />{t('blockout.countsTowardLimit')}</label> : page.countsTowardLimit === false && <p>{t('blockout.excludedPage')}</p>}
          </article>;
        })}</div>
      </section>;
    })}</div>
  </div>;
}
