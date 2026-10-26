import { createHash } from 'node:crypto';
import { BlockoutDocumentSchema, createBlockoutDocument, type BlockoutDocument, type BlockoutFitAssessment, type BlockoutMaterialInventory } from '@open-design/contracts';

export const materialRevision = 'a'.repeat(64);
const sourceText = 'The survey records cracking near the west wall. Preserve these findings in full.';
export function materialDocument(): BlockoutDocument {
  const document = createBlockoutDocument(); document.planningStage = 'composition'; document.title = 'Structural survey'; document.materialRevision = materialRevision; document.materialIds = ['source-text', 'source-image'];
  document.variants[0]!.label = 'Proposal A';
  document.variants[0]!.pages[0]!.blocks = [
    { id: 'body', label: 'Inspection findings', kind: 'text', box: { x: 10, y: 10, width: 80, height: 40, rotation: 0 }, lockRatio: false, images: [], references: [], expectation: '', feedback: '', flexibility: 'guided', contentIds: ['source-text'], typography: { fontFamily: 'Arial', fontSizePt: 11, lineHeight: 1.2 } },
    { id: 'photo', label: 'Survey image', kind: 'image', box: { x: 10, y: 55, width: 80, height: 35, rotation: 0 }, lockRatio: true, images: [], references: [], expectation: '', feedback: '', flexibility: 'guided', contentIds: ['source-image'] },
  ];
  return BlockoutDocumentSchema.parse(document);
}
export function materialInventory(status: BlockoutMaterialInventory['status'] = 'ready'): BlockoutMaterialInventory {
  return { version: 1, projectId: 'project', revision: materialRevision, status,
    sources: { processed: status === 'ready' ? 1 : 0, total: 1, entries: [{ id: 'source', path: 'survey.pdf', hash: materialRevision, role: 'content', status: status === 'ready' ? 'ready' : 'preparing', pagesProcessed: status === 'ready' ? 2 : 1, pagesTotal: 2, gaps: [] }] },
    items: [{ id: 'source-text', label: 'Inspection findings', kind: 'text', sourcePath: 'survey.pdf', sourcePage: 1, sourceHash: materialRevision, sourceRole: 'content', text: sourceText, offsetStart: 0, offsetEnd: sourceText.length },
      { id: 'source-image', label: 'West wall photograph', kind: 'image', sourcePath: 'survey.pdf', sourcePage: 2, sourceHash: materialRevision, sourceRole: 'content', imagePath: 'intake/west-wall.png', width: 1200, height: 800 }],
    gaps: [], createdAt: '2026-10-23T12:00:00Z', updatedAt: '2026-10-23T12:00:00Z' };
}
export function materialAssessment(document = materialDocument(), status: BlockoutFitAssessment['status'] = 'ready'): BlockoutFitAssessment {
  return { version: 1, documentId: document.documentId, documentRevision: createHash('sha256').update(JSON.stringify(BlockoutDocumentSchema.parse(document))).digest('hex'), status,
    assessedAt: '2026-10-23T12:00:00Z', materialRevision, inventoryRevision: materialRevision, selectedContentIds: ['source-text', 'source-image'],
    variants: document.variants.map((variant) => ({ variantId: variant.id, status, pages: variant.pages.map((page, index) => ({ pageId: page.id, pageNumber: index + 1, status,
      safeAreaMm2: 52000, usedAreaMm2: 31200, density: .6, overlapAreaMm2: 0, overflowAreaMm2: 0, blocks: [], issues: [] })),
      boundContentIds: ['source-text', 'source-image'], missingContentIds: [], duplicatedContentIds: [], unexpectedContentIds: [], issues: [] })),
    excludedVariantIds: [], alternatives: { status, distinctCount: 1, minimum: 1, pairs: [], issues: [] }, issues: [], limitations: [], policy: { sparseDensity: .2, adjacentDensityDifference: .35, minimumImageDpi: 150 } };
}
