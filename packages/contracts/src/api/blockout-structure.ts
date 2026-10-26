import { BlockoutDocumentSchema, type BlockoutBlock, type BlockoutDocument } from './blockout.js';
import { getBlockoutPageBudgetStatus } from './blockout-document.js';
import { blockoutSafeArea } from './blockout-geometry.js';
import { blockoutFitStatus, clipPhysicalPolygon, compareBlockoutAlternatives, physicalBlockoutBox, physicalPolygonArea, physicalPolygonUnionArea, physicalRectPolygon,
  type BlockoutFitAssessment, type BlockoutFitIssue, type BlockoutFitPage } from './blockout-fit.js';

const issue = (code: string, severity: BlockoutFitIssue['severity'], message: string): BlockoutFitIssue => ({ code, severity, message, contentIds: [] });
const role = (block: BlockoutBlock) => block.designRole ?? (block.kind === 'text' ? 'body' : block.kind === 'table' ? 'table' : 'figure');

/** Structural validation inspects only planned boxes and page rules. It never reads or sizes assets. */
export function assessBlockoutStructure(input: BlockoutDocument, options: { documentRevision: string; assessedAt?: string; minimumAlternatives?: number }): BlockoutFitAssessment {
  const document = BlockoutDocumentSchema.parse(input);
  const variants = document.variants.filter((variant) => variant.id !== 'brief' || document.variants.length === 1 || variant.pages.some((page) => page.blocks.length));
  const minimum = options.minimumAlternatives ?? 1;
  const result: BlockoutFitAssessment = {
    version: 1, basis: 'structure', documentId: document.documentId, documentRevision: options.documentRevision,
    assessedAt: options.assessedAt ?? '', status: 'ready', materialRevision: null, inventoryRevision: null, selectedContentIds: [],
    variants: [], excludedVariantIds: document.variants.filter((variant) => !variants.includes(variant)).map((variant) => variant.id),
    alternatives: { status: 'ready', distinctCount: variants.length, minimum, pairs: [], issues: [] }, issues: [],
    limitations: ['Structural checks cover page rules and planned geometry only. Text capacity, source-image fit and final graphic quality have not been measured.'],
    policy: { sparseDensity: 0, adjacentDensityDifference: 1, minimumImageDpi: 0 },
  };
  for (const variant of variants) {
    const issues: BlockoutFitIssue[] = [];
    const budget = getBlockoutPageBudgetStatus(document, variant.id);
    if (budget.over) issues.push(issue('page-budget-exceeded', 'blocked', 'La struttura supera il limite di pagine confermato.'));
    if (budget.unfilled) issues.push(issue('page-target-unallocated', 'warning', 'La struttura non copre ancora tutte le pagine scelte.'));
    const pages: BlockoutFitPage[] = variant.pages.map((page, pageIndex) => {
      const margin = Math.min(page.safeMarginMm, page.widthMm / 2, page.heightMm / 2);
      const bounds = blockoutSafeArea(page);
      const safe = { x: margin, y: bounds.top * page.heightMm / 100, width: page.widthMm - margin * 2, height: (bounds.bottom - bounds.top) * page.heightMm / 100 };
      const area = safe.width * safe.height;
      const pageIssues = !page.blocks.length ? [issue('structure-empty', 'waiting', 'Aggiungi i blocchi che descrivono la funzione di questa pagina.')] : [];
      const polygons = page.blocks.filter((block) => role(block) !== 'background').map((block) => clipPhysicalPolygon(physicalRectPolygon(physicalBlockoutBox(page, block.box), block.box.rotation), safe));
      const blocks = page.blocks.map((block) => {
        const box = physicalBlockoutBox(page, block.box), polygon = physicalRectPolygon(box, block.box.rotation);
        const inside = physicalPolygonArea(clipPhysicalPolygon(polygon, safe)), outside = Math.max(0, physicalPolygonArea(polygon) - inside);
        const blockIssues = outside > 0.5 ? [issue('structure-outside-safe-area', 'warning', role(block) === 'background' ? 'Lo sfondo supera il margine di sicurezza: verifica che il trattamento sia intenzionale.' : 'Il blocco supera il margine di sicurezza.')] : [];
        return { blockId: block.id, contentIds: [], status: blockoutFitStatus(blockIssues), boxMm: box, usableWidthMm: box.width, usableHeightMm: box.height,
          usedAreaMm2: inside, overflowWidthMm: 0, overflowHeightMm: 0, issues: blockIssues };
      });
      const used = physicalPolygonUnionArea(polygons);
      return { pageId: page.id, pageNumber: pageIndex + 1, status: blockoutFitStatus(pageIssues, blocks.map((block) => block.status)),
        safeAreaMm2: area, usedAreaMm2: used, density: area ? used / area : 0, overlapAreaMm2: 0, overflowAreaMm2: 0, blocks, issues: pageIssues };
    });
    result.variants.push({ variantId: variant.id, status: blockoutFitStatus(issues, pages.map((page) => page.status)), pages, issues,
      boundContentIds: [], missingContentIds: [], duplicatedContentIds: [], unexpectedContentIds: [] });
  }
  // Compare functional slots rather than requiring a source-material inventory.
  const virtual: BlockoutDocument = { ...document, variants: variants.map((variant) => {
    const counts = new Map<string, number>();
    return { ...variant, pages: variant.pages.map((page) => ({ ...page, blocks: page.blocks.map((block) => {
      const key = role(block), index = (counts.get(key) ?? 0) + 1; counts.set(key, index);
      return { ...block, contentIds: [`${key}-${index}`], typography: { fontFamily: 'schematic', fontSizePt: Math.sqrt(block.box.width * block.box.height), lineHeight: 1 } };
    }) })) };
  }) };
  result.alternatives.pairs = compareBlockoutAlternatives(virtual, variants.map((variant) => variant.id)).map((pair) => pair.sameContent ? pair
    : { ...pair, sameContent: true, meaningful: true, differences: [...pair.differences, 'functional-grouping'] });
  if (variants.length < minimum) result.alternatives.issues.push(issue('structural-alternatives-missing', 'waiting', `Sono richieste ${minimum} proposte strutturali; ne sono disponibili ${variants.length}.`));
  if (result.alternatives.pairs.some((pair) => !pair.meaningful)) result.alternatives.issues.push(issue('structural-alternatives-similar', 'warning', 'Alcune alternative hanno la stessa struttura: varia gerarchia, raggruppamento o sequenza delle pagine.'));
  result.alternatives.status = blockoutFitStatus(result.alternatives.issues);
  result.status = blockoutFitStatus(result.issues, [...result.variants.map((variant) => variant.status), result.alternatives.status]);
  return result;
}
