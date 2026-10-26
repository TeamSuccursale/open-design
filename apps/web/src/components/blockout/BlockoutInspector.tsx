import { useState, type ReactNode } from 'react';
import { Button, Input, Select, Textarea } from '@open-design/components';
import { blockoutBoxWithRatio, blockoutOutsideSafeArea, constrainBlockoutBox, type BlockoutBlock, type BlockoutBox, type BlockoutPage, type WorkspaceCollabContext } from '@open-design/contracts';
import { useT } from '../../i18n';
import { QuestionFormView } from '../QuestionForm';
import { BlockoutAssetPicker } from './BlockoutAssetPicker';
import { structuralBlockRole } from './BlockoutMaterialPreview';
import type { BlockoutQuestionRequest } from './events';
import styles from './BlockoutWorkspace.module.css';

export function BlockoutInspector({ page, block, projectId, workspaceContext, question, approval, busy, onPage, onBlock, onPageSelect, onAnswer, onOpenGallery }: {
  page: BlockoutPage; block?: BlockoutBlock; projectId: string; workspaceContext?: WorkspaceCollabContext | null;
  question: BlockoutQuestionRequest | null; busy: boolean;
  approval?: ReactNode;
  onOpenGallery?: () => void;
  onPage: (patch: Partial<BlockoutPage>) => void; onBlock: (patch: Partial<BlockoutBlock>) => void; onPageSelect: () => void;
  onAnswer: NonNullable<BlockoutQuestionRequest['props']['onSubmit']>;
}) {
  const t = useT(), [imageTab, setImageTab] = useState<'content' | 'feedback' | null>(null);
  const item = block ?? page;
  function patch(value: Partial<BlockoutPage & BlockoutBlock>) { if (block) onBlock(value); else onPage(value); }
  function boxValue(key: keyof BlockoutBox, value: number) {
    if (!block || !Number.isFinite(value)) return;
    let next = { ...block.box, [key]: value };
    if (block.lockRatio && (key === 'width' || key === 'height')) {
      const ratio = block.box.width / block.box.height;
      if (key === 'width') next.height = value / ratio; else next.width = value * ratio;
    }
    onBlock({ box: constrainBlockoutBox(next) });
  }
  return <aside className={styles.inspector} aria-label={t('blockout.inspector')}>
    {onOpenGallery && <Button variant="secondary" className={styles.inspectorGallery} onClick={onOpenGallery}>{t('blockout.galleryDrawer')}</Button>}
    <fieldset className={styles.inspectorFields} disabled={busy}>
    <div className={styles.inspectorTitle}><h3>{block ? t('blockout.blockDetails') : t('blockout.pageDetails')}</h3>
      {block && <Button variant="ghost" onClick={onPageSelect}>{t('blockout.page')}</Button>}</div>
    {approval}
    {block && blockoutOutsideSafeArea(block.box, page) && <p className={styles.marginNotice} role="status">{t('blockout.outsideSafe')}</p>}
    {question && <label className={styles.field}>{t('blockout.flexibility')}<Select aria-label={t('blockout.flexibility')} value={item.flexibility} onChange={(event) => patch({ flexibility: event.target.value as BlockoutPage['flexibility'] })}>
      <option value="fixed">{t('blockout.fixed')}</option><option value="guided">{t('blockout.guided')}</option><option value="free">{t('blockout.free')}</option>
    </Select><small>{t('blockout.flexibilityHint')}</small></label>}
    {question && <section className={styles.questionPanel} aria-label={t('blockout.agentQuestion')}>
      <span className={styles.questionLabel}>{t('blockout.agentQuestion')}</span>
      <QuestionFormView {...question.props} autoContinueAfterTimeout={false} submitDisabled={busy || question.props.submitDisabled} onSubmit={onAnswer} />
    </section>}
    <label className={styles.field}>{t('blockout.name')}<Input value={item.label} maxLength={240} onChange={(event) => patch({ label: event.target.value })} /></label>
    {block && <label className={styles.field}>{t('blockout.designRole')}<Select aria-label={t('blockout.designRole')} value={structuralBlockRole(block)} onChange={(event) => {
      const designRole = event.target.value as NonNullable<BlockoutBlock['designRole']>;
      const kind: BlockoutBlock['kind'] = designRole === 'table' ? 'table' : designRole === 'figure' ? block.kind === 'drawing' ? 'drawing' : 'image' : designRole === 'background' ? 'mixed' : 'text';
      onBlock({ designRole, kind });
    }}>{(['heading', 'body', 'caption', 'figure', 'table', 'background', 'navigation'] as const).map((role) => <option value={role} key={role}>{t(`blockout.designRole.${role}`)}</option>)}</Select></label>}
    <label className={styles.field}>{t('blockout.expectation')}<Textarea rows={4} placeholder={t(block ? 'blockout.blockPlaceholder' : 'blockout.pagePlaceholder')} value={item.expectation} maxLength={12_000} onChange={(event) => patch({ expectation: event.target.value })} /></label>
    {!question && <label className={styles.field}>{t('blockout.flexibility')}<Select aria-label={t('blockout.flexibility')} value={item.flexibility} onChange={(event) => patch({ flexibility: event.target.value as BlockoutPage['flexibility'] })}>
      <option value="fixed">{t('blockout.fixed')}</option><option value="guided">{t('blockout.guided')}</option><option value="free">{t('blockout.free')}</option>
    </Select><small>{t('blockout.flexibilityHint')}</small></label>}
    <label className={styles.field}>{t('blockout.feedback')}<Textarea rows={3} placeholder={t('blockout.feedbackPlaceholder')} value={item.feedback} maxLength={12_000} onChange={(event) => patch({ feedback: event.target.value })} /></label>
    {!block && <label className={styles.field}>{t('blockout.backgroundIntent')}<Textarea rows={3} value={page.backgroundIntent ?? ''} maxLength={12_000} onChange={(event) => onPage({ backgroundIntent: event.target.value })} /><small>{t('blockout.backgroundIntentHint')}</small></label>}
    <details className={styles.geometry}><summary>{t('blockout.optionalReferences')}</summary>
      <p className={styles.inspectorHint}>{t('blockout.optionalReferencesHint')}</p>
    <div className={styles.imageTabs}>
      {block && <Button variant={imageTab === 'content' ? 'secondary' : 'ghost'} aria-pressed={imageTab === 'content'} onClick={() => setImageTab(imageTab === 'content' ? null : 'content')}>{t('blockout.contentImages')} ({block.images.length})</Button>}
      <Button variant={imageTab === 'feedback' ? 'secondary' : 'ghost'} aria-pressed={imageTab === 'feedback'} onClick={() => setImageTab(imageTab === 'feedback' ? null : 'feedback')}>{t('blockout.referenceImages')} ({item.references.length})</Button>
    </div>
    {imageTab && <section className={styles.imagesSection}>
      <p>{t(imageTab === 'content' && block ? 'blockout.galleryReferenceHint' : 'blockout.referenceImagesHint')}</p>
      <BlockoutAssetPicker key={`${item.id}-${imageTab}`} projectId={projectId} workspaceContext={workspaceContext} value={imageTab === 'content' && block ? block.images : item.references}
        onChange={(images) => imageTab === 'content' && block ? onBlock({ images, referencePreview: true }) : patch({ references: images })} />
    </section>}
    </details>
    {!block && <div className={styles.paperControls}>
      <label className={styles.field}>{t('blockout.paper')}<Select aria-label={t('blockout.paper')} value={page.widthMm === 210 && page.heightMm === 297 ? 'a4p' : page.widthMm === 297 && page.heightMm === 210 ? 'a4l' : page.widthMm === 297 && page.heightMm === 420 ? 'a3p' : page.widthMm === 420 && page.heightMm === 297 ? 'a3l' : 'custom'} onChange={(event) => {
        const formats: Record<string, [number, number]> = { a4p: [210, 297], a4l: [297, 210], a3p: [297, 420], a3l: [420, 297] };
        const format = formats[event.target.value]; if (format) onPage({ widthMm: format[0], heightMm: format[1] });
      }}><option value="a4p">A4 · {t('blockout.portrait')}</option><option value="a4l">A4 · {t('blockout.landscape')}</option><option value="a3p">A3 · {t('blockout.portrait')}</option><option value="a3l">A3 · {t('blockout.landscape')}</option><option value="custom">{t('blockout.custom')}</option></Select></label>
      <div className={styles.numericGrid}>{(['widthMm', 'heightMm'] as const).map((key) => <label className={styles.field} key={key}>{t(key === 'widthMm' ? 'blockout.widthMm' : 'blockout.heightMm')}<Input type="number" min={50} max={2000} value={page[key]} onChange={(event) => { const value = Number(event.target.value); if (value >= 50 && value <= 2000) onPage({ [key]: value }); }} /></label>)}</div>
      <label className={styles.field}>{t('blockout.safeMargin')}<Input type="number" min={0} max={Math.min(200, page.widthMm * 0.45, page.heightMm * 0.45)} step={1} value={page.safeMarginMm ?? 10} onChange={(event) => {
        const value = Number(event.target.value); if (Number.isFinite(value)) onPage({ safeMarginMm: Math.max(0, Math.min(value, 200, page.widthMm * 0.45, page.heightMm * 0.45)) });
      }} /><small>{t('blockout.safeMarginHint')}</small></label>
    </div>}
    {block && <>
      <details className={styles.geometry}><summary>{t('blockout.transform')}</summary>
        <div className={styles.numericGrid}>{(['x', 'y', 'width', 'height', 'rotation'] as const).map((key) => <label className={styles.field} key={key}>{t(`blockout.${key}`)}<Input type="number" step={key === 'rotation' ? 1 : 0.5} value={block.box[key]} onChange={(event) => boxValue(key, Number(event.target.value))} /></label>)}</div>
        <label className={styles.check}><input type="checkbox" checked={block.lockRatio} onChange={(event) => onBlock({ lockRatio: event.target.checked })} />{t('blockout.lockRatio')}</label>
        <div className={styles.ratios}>{[1, 4 / 3, 3 / 2, 16 / 9].map((ratio, index) => <Button variant="secondary" key={ratio} onClick={() => onBlock({ box: blockoutBoxWithRatio(block.box, ratio, page.widthMm / page.heightMm) })}>{['1:1', '4:3', '3:2', '16:9'][index]}</Button>)}</div>
      </details>
    </>}
    </fieldset>
  </aside>;
}
