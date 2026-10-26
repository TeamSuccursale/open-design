import { blockoutReferenceTiles, type BlockoutBlock, type BlockoutFitBlock, type BlockoutMaterialInventory, type BlockoutPage, type WorkspaceCollabContext } from '@open-design/contracts';
import { projectRawUrl } from '../../providers/registry';
import { useT } from '../../i18n';
import styles from './BlockoutMaterialPreview.module.css';

/** Old asset bindings remain metadata. A Blockout preview only shows the role of each empty area. */
export function structuralBlockRole(block: BlockoutBlock): NonNullable<BlockoutBlock['designRole']> {
  if (block.designRole) return block.designRole;
  if (block.materialRole === 'service') return 'navigation';
  if (block.kind === 'table') return 'table';
  if (block.kind === 'image' || block.kind === 'drawing') return 'figure';
  return 'body';
}

export function BlockoutMaterialPreview({ block, page, projectId, workspaceContext, compact = false, designUnderlay = false }: {
  block: BlockoutBlock; page: BlockoutPage; inventory?: BlockoutMaterialInventory | null; measurement?: BlockoutFitBlock;
  projectId?: string; workspaceContext?: WorkspaceCollabContext | null; paperWidth?: number; compact?: boolean;
  designUnderlay?: boolean;
}) {
  const t = useT(), role = structuralBlockRole(block), label = block.label.trim();
  const textRole = role === 'heading' || role === 'body' || role === 'caption' || role === 'navigation';
  const lineCount = role === 'body' ? 6 : role === 'heading' ? 2 : role === 'caption' ? 3 : 1;
  const tiles = block.referencePreview && projectId ? blockoutReferenceTiles(block.images, block.box.width / block.box.height * page.widthMm / page.heightMm) : [];
  return <span className={styles.content} data-role={role} data-underlay={designUnderlay || undefined} data-compact={compact || undefined} data-testid={`blockout-content-${block.id}`} aria-hidden="true">
    {tiles.length > 0 && <span className={styles.referenceImages} data-testid={`blockout-reference-preview-${block.id}`}>{tiles.map((tile, index) => <img key={block.images[index]!.assetId}
      src={projectRawUrl(projectId!, block.images[index]!.imagePath, workspaceContext)} alt="" draggable={false} loading="lazy" style={{ left: `${tile.x}%`, top: `${tile.y}%`, width: `${tile.width}%`, height: `${tile.height}%` }} />)}</span>}
    <span className={styles.label}><strong>{t(`blockout.designRole.${role}`)}</strong>{label && label !== t(`blockout.designRole.${role}`) && <span>{label}</span>}</span>
    {textRole && <span className={styles.textRhythm}>{Array.from({ length: lineCount }, (_, index) => <i key={index} />)}</span>}
    {role === 'figure' && <span className={styles.figure}><i /><i /></span>}
    {role === 'table' && <span className={styles.table}>{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</span>}
    {role === 'background' && <span className={styles.backgroundMark}><i /><i /><i /></span>}
  </span>;
}
