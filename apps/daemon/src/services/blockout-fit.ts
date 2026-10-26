import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  BlockoutDocumentSchema, blockoutFitStatus, blockoutMaterialText, clipPhysicalPolygon, compareBlockoutAlternatives, getBlockoutPageBudgetStatus,
  physicalBlockoutBox, physicalPolygonUnionArea, physicalRectPolygon, blockoutSafeArea,
  type BlockoutBlock, type BlockoutDocument, type BlockoutFitAssessment, type BlockoutFitBlock, type BlockoutFitIssue,
  type BlockoutFitPage, type BlockoutFitVariant, type BlockoutMaterialInventory, type BlockoutMaterialItem,
  type BlockoutPhysicalPoint, type BlockoutPhysicalRect, type BlockoutTextMeasurement, type BlockoutImageMeasurement,
} from '@open-design/contracts';
import { measureBlockoutMaterials, type BlockoutTextMeasureRequest, type BlockoutTextMeasurer, type BlockoutImageMeasurer } from './blockout-fit-measurement.js';

export interface BlockoutFitOptions {
  projectRoot: string; minimumAlternatives?: number; measureText?: BlockoutTextMeasurer; measureImage?: BlockoutImageMeasurer; now?: () => Date;
}
const policy = { sparseDensity: 0.20, adjacentDensityDifference: 0.35, minimumImageDpi: 150 };
const issue = (code: string, severity: BlockoutFitIssue['severity'], message: string, contentIds: string[] = []): BlockoutFitIssue => ({ code, severity, message, contentIds });
const unique = (values: readonly string[]) => [...new Set(values)];
const textKey = (request: BlockoutTextMeasureRequest) => JSON.stringify(request);
const bodyPage = (page: BlockoutDocument['variants'][number]['pages'][number]) => page.role === 'body' || (!page.role && page.countsTowardLimit !== false);
const safeNumber = (value: number) => Number.isFinite(value) && value >= 0;
const polygonArea = (polygons: BlockoutPhysicalPoint[][]) => physicalPolygonUnionArea(polygons);

async function containedImage(root: string, relative: string): Promise<string> {
  if (!relative || path.isAbsolute(relative) || relative.replaceAll('\\', '/').split('/').includes('..')) throw new Error('Image must be a contained project-relative file');
  const base = await realpath(root), file = await realpath(path.resolve(base, relative));
  const difference = path.relative(base, file);
  if (!difference || difference.startsWith('..') || path.isAbsolute(difference)) throw new Error('Image resolves outside this project');
  return file;
}

/** Fresh physical assessment of the saved document and a specific material snapshot.
 * This never rewrites content, fonts, target page counts or proposal geometry. */
export async function assessBlockoutFit(input: BlockoutDocument, inventory: BlockoutMaterialInventory | null, options: BlockoutFitOptions): Promise<BlockoutFitAssessment> {
  const document = BlockoutDocumentSchema.parse(input), minimum = options.minimumAlternatives ?? 3;
  const issues: BlockoutFitIssue[] = [], excludedVariantIds: string[] = [];
  const assessment: BlockoutFitAssessment = {
    version: 1, documentId: document.documentId, documentRevision: createHash('sha256').update(JSON.stringify(document)).digest('hex'),
    status: 'waiting', assessedAt: (options.now?.() ?? new Date()).toISOString(), materialRevision: document.materialRevision ?? null,
    inventoryRevision: inventory?.revision ?? null, selectedContentIds: unique(document.materialIds ?? []), variants: [], excludedVariantIds,
    alternatives: { status: 'waiting', distinctCount: 0, minimum, pairs: [], issues: [] }, issues, limitations: [], policy,
  };
  if (!inventory || ['preparing', 'waiting'].includes(inventory.status)) {
    issues.push(issue('inventory-waiting', 'waiting', 'Material inventory is not yet ready. No fit result is claimed.')); return assessment;
  }
  if (inventory.status !== 'ready' || inventory.gaps.length || inventory.sources.entries.some((source) => source.status !== 'ready')) issues.push(issue('inventory-incomplete', 'blocked', 'Resolve the inventory gaps before claiming that the supplied material fits.'));
  if (!document.materialRevision || document.materialRevision !== inventory.revision) issues.push(issue('material-revision-stale', 'blocked', 'Bind the document to the current inventory revision before assessing its proposals.'));
  if (!document.materialIds?.length) issues.push(issue('material-selection-missing', 'blocked', 'Select the actual source items for this document; placeholder labels are not content.'));
  if (document.materialIds && unique(document.materialIds).length !== document.materialIds.length) issues.push(issue('material-selection-duplicate', 'blocked', 'The selected material list contains duplicate identities.'));
  const items = new Map(inventory.items.map((item) => [item.id, item]));
  if (items.size !== inventory.items.length) issues.push(issue('inventory-duplicate-id', 'blocked', 'The inventory contains duplicate item identities.'));
  const selectedIds = assessment.selectedContentIds, selectedSet = new Set(selectedIds);
  const missingSelected = selectedIds.filter((id) => !items.has(id));
  if (missingSelected.length) issues.push(issue('selected-material-missing', 'blocked', 'Selected material no longer exists in this inventory.', missingSelected));
  for (const id of selectedIds) {
    const item = items.get(id); if (!item) continue;
    const source = inventory.sources.entries.find((entry) => entry.path === item.sourcePath);
    if (!source || !source.hash || source.hash !== item.sourceHash) issues.push(issue('source-binding-stale', 'blocked', 'A material item does not match its recorded source revision.', [id]));
    if (item.kind === 'text' && (!item.text.trim() || item.offsetEnd - item.offsetStart !== item.text.length)) issues.push(issue('source-text-invalid', 'blocked', 'Exact source text and its UTF-16 offset range must agree.', [id]));
  }

  const variants = document.variants.filter((variant) => {
    const blankBrief = variant.id === 'brief' && variant.pages.every((page) => !page.blocks.length);
    if (blankBrief) excludedVariantIds.push(variant.id); return !blankBrief;
  });
  if (!variants.length) issues.push(issue('proposals-missing', 'waiting', 'No material-bound proposals are available; the blank legacy brief is not a proposal.'));

  interface Prepared { text?: BlockoutTextMeasureRequest; visual?: Exclude<BlockoutMaterialItem, { kind: 'text' }>; padding: number; issues: BlockoutFitIssue[] }
  const prepared = new Map<BlockoutBlock, Prepared>(), requests = new Map<string, BlockoutTextMeasureRequest>();
  for (const variant of variants) for (const page of variant.pages) for (const block of page.blocks) {
    const state: Prepared = { padding: block.typography?.paddingMm ?? 0, issues: [] }; prepared.set(block, state);
    const bound = (block.contentIds ?? []).map((id) => items.get(id));
    const unknown = (block.contentIds ?? []).filter((id) => !items.has(id));
    if (unknown.length) state.issues.push(issue('binding-missing', 'blocked', 'A block refers to missing material.', unknown));
    const content = bound.filter((item): item is BlockoutMaterialItem => !!item);
    let text = '';
    if (block.materialRole === 'service') {
      if (content.length || !block.label.trim() || block.label.length > 120 || /[\r\n]/.test(block.label) || block.kind !== 'text') state.issues.push(issue('service-content-invalid', 'blocked', 'Service blocks may contain only a short structural label or folio; substantive content requires source bindings.'));
      else text = block.label;
    } else if (!content.length) state.issues.push(issue('block-material-missing', 'blocked', 'Bind actual source material to this block; an expectation or label cannot be measured as content.'));
    else if (content.every((item) => item.kind === 'text')) text = blockoutMaterialText(content);
    else if (content.length === 1 && content[0]!.kind !== 'text') state.visual = content[0] as Exclude<BlockoutMaterialItem, { kind: 'text' }>;
    else state.issues.push(issue('internal-placement-unknown', 'blocked', 'Separate visual items and mixed text/image material into measurable blocks; their internal placement is unspecified.', content.map((item) => item.id)));
    if (text) {
      if (!block.typography) state.issues.push(issue('typography-missing', 'blocked', 'Specify the preserved font, point size and line-height ratio before measuring text.'));
      else {
        const widthMm = physicalBlockoutBox(page, block.box).width - 2 * state.padding;
        state.text = { text, fontFamily: block.typography.fontFamily, fontSizePt: block.typography.fontSizePt, lineHeight: block.typography.lineHeight, widthMm };
        requests.set(textKey(state.text), state.text);
      }
    }
  }
  const textRequests = [...requests.values()], textResults = new Map<string, BlockoutTextMeasurement>();
  if (options.measureText) await Promise.all(textRequests.map(async (request) => {
    try { textResults.set(textKey(request), await options.measureText!(request)); } catch { /* handled as unavailable below */ }
  }));
  else if (textRequests.length) {
    const result = await measureBlockoutMaterials(textRequests);
    textRequests.forEach((request, index) => { if (result.texts[index]) textResults.set(textKey(request), result.texts[index]!); });
  }
  const imageResults = new Map<string, BlockoutImageMeasurement>(), visualItems = unique([...prepared.values()].flatMap((state) => state.visual ? [state.visual.imagePath] : []));
  const imagePaths = await Promise.all(visualItems.map(async (imagePath) => { try { return await containedImage(options.projectRoot, imagePath); } catch { return null; } }));
  const validImages = imagePaths.flatMap((imagePath, index) => imagePath ? [{ absolute: imagePath, relative: visualItems[index]! }] : []);
  if (options.measureImage) await Promise.all(validImages.map(async ({ absolute, relative }) => { try { imageResults.set(relative, await options.measureImage!(absolute)); } catch { /* unavailable */ } }));
  else if (validImages.length) {
    const result = await measureBlockoutMaterials([], validImages.map((item) => item.absolute));
    validImages.forEach((item, index) => { if (result.images[index]) imageResults.set(item.relative, result.images[index]!); });
  }

  for (const variant of variants) {
    const counts = new Map<string, number>();
    for (const page of variant.pages) for (const block of page.blocks) for (const id of block.contentIds ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    const result: BlockoutFitVariant = { variantId: variant.id, status: 'ready', pages: [], boundContentIds: [...counts.keys()], missingContentIds: selectedIds.filter((id) => !counts.has(id)), duplicatedContentIds: [...counts].filter(([, count]) => count > 1).map(([id]) => id), unexpectedContentIds: [...counts.keys()].filter((id) => !selectedSet.has(id)), issues: [] };
    if (result.missingContentIds.length) result.issues.push(issue('allocation-incomplete', 'blocked', 'This alternative omits selected material.', result.missingContentIds));
    if (result.duplicatedContentIds.length) result.issues.push(issue('allocation-duplicate', 'blocked', 'This alternative repeats material rather than allocating each selected item once.', result.duplicatedContentIds));
    if (result.unexpectedContentIds.length) result.issues.push(issue('allocation-unexpected', 'blocked', 'This alternative includes items outside this document’s selected material.', result.unexpectedContentIds));
    const budget = getBlockoutPageBudgetStatus(document, variant.id);
    if (budget.over || budget.unfilled) result.issues.push(issue('page-target-mismatch', 'blocked', `Keep the chosen page target and source cap: ${budget.counted} counted, target ${budget.target ?? 'unset'}, cap ${budget.limit ?? 'unset'}.`));
    if (!document.pageBudget?.target) result.issues.push(issue('page-target-missing', 'blocked', 'Confirm the number of pages to use instead of silently changing the document length.'));
    for (const [index, page] of variant.pages.entries()) {
      const margin = page.safeMarginMm ?? 10, bounds = blockoutSafeArea(page), safe: BlockoutPhysicalRect = { x: margin, y: bounds.top * page.heightMm / 100, width: Math.max(0, page.widthMm - 2 * margin), height: Math.max(0, (bounds.bottom - bounds.top) * page.heightMm / 100) };
      const pageResult: BlockoutFitPage = { pageId: page.id, pageNumber: index + 1, status: 'ready', safeAreaMm2: safe.width * safe.height, usedAreaMm2: 0, density: 0, overlapAreaMm2: 0, overflowAreaMm2: 0, blocks: [], issues: [] };
      const contentPolygons: BlockoutPhysicalPoint[][] = [];
      for (const block of page.blocks) {
        const state = prepared.get(block)!, box = physicalBlockoutBox(page, block.box), padding = state.padding;
        const fit: BlockoutFitBlock = { blockId: block.id, contentIds: [...(block.contentIds ?? [])], status: 'ready', boxMm: box, usableWidthMm: Math.max(0, box.width - 2 * padding), usableHeightMm: Math.max(0, box.height - 2 * padding), usedAreaMm2: 0, overflowWidthMm: 0, overflowHeightMm: 0, issues: [...state.issues] };
        if (fit.usableWidthMm <= 0 || fit.usableHeightMm <= 0) fit.issues.push(issue('usable-area-empty', 'blocked', 'Padding leaves no usable physical area for the material.'));
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }, polygons: BlockoutPhysicalPoint[][] = [];
        const addRect = (rect: BlockoutPhysicalRect) => { if (rect.width > 0 && rect.height > 0) polygons.push(physicalRectPolygon(rect, block.box.rotation, center)); };
        const boxPolygon = physicalRectPolygon(box, block.box.rotation);
        if (polygonArea([boxPolygon]) - polygonArea([clipPhysicalPolygon(boxPolygon, safe)]) > 0.5) fit.issues.push(issue('outside-safe-area', 'blocked', 'The block crosses the physical safe borders.'));
        if (state.text) {
          const measured = textResults.get(textKey(state.text));
          if (!measured || measured.status !== 'measured' || !safeNumber(measured.heightMm) || !safeNumber(measured.maxWidthMm) || measured.lineHeightMm <= 0 || !Number.isFinite(measured.lineHeightMm) || !measured.lines.length || measured.fontFamily !== state.text.fontFamily || measured.fontSizePt !== state.text.fontSizePt || measured.lineHeight !== state.text.lineHeight || measured.lines.some((line) => !safeNumber(line.widthMm) || !safeNumber(line.inkHeightMm))) fit.issues.push(issue('text-measurement-unavailable', 'blocked', measured?.limitations.join('; ') || 'Actual preserved-font measurement is unavailable or inconsistent.'));
          else {
            fit.text = measured; fit.overflowWidthMm = Math.max(0, measured.maxWidthMm - fit.usableWidthMm); fit.overflowHeightMm = Math.max(0, measured.heightMm - fit.usableHeightMm);
            measured.lines.forEach((line, lineIndex) => addRect({ x: box.x + padding, y: box.y + padding + lineIndex * measured.lineHeightMm, width: line.widthMm, height: measured.lineHeightMm }));
            if (fit.overflowWidthMm > 0.05 || fit.overflowHeightMm > 0.05) fit.issues.push(issue('text-overflow', 'blocked', `Measured source text exceeds the preserved-size block by ${fit.overflowWidthMm.toFixed(2)} mm horizontally and ${fit.overflowHeightMm.toFixed(2)} mm vertically.`, fit.contentIds));
            if (measured.lines.some((line) => line.inkHeightMm > measured.lineHeightMm + 0.05)) fit.issues.push(issue('line-height-overlap', 'blocked', 'The preserved line height is smaller than measured glyph extents.'));
          }
        } else if (state.visual) {
          const measured = imageResults.get(state.visual.imagePath);
          if (!measured || measured.status !== 'measured' || measured.width <= 0 || measured.height <= 0) fit.issues.push(issue('image-measurement-unavailable', 'blocked', measured?.limitations.join('; ') || 'The actual contained image could not be read.', [state.visual.id]));
          else {
            if (measured.width !== state.visual.width || measured.height !== state.visual.height) fit.issues.push(issue('image-dimensions-stale', 'blocked', 'Actual raster dimensions differ from the bound inventory snapshot.', [state.visual.id]));
            const imageFit = block.imageFit ?? 'contain', scale = imageFit === 'cover' ? Math.max(fit.usableWidthMm / measured.width, fit.usableHeightMm / measured.height) : Math.min(fit.usableWidthMm / measured.width, fit.usableHeightMm / measured.height);
            const width = measured.width * scale, height = measured.height * scale, effectiveDpi = scale > 0 ? 25.4 / scale : 0;
            const croppedFraction = imageFit === 'cover' && width * height > 0 ? Math.max(0, 1 - fit.usableWidthMm * fit.usableHeightMm / (width * height)) : 0;
            fit.image = { widthPx: measured.width, heightPx: measured.height, placedWidthMm: width, placedHeightMm: height, effectiveDpi, croppedFraction, fit: imageFit };
            addRect({ x: box.x + padding + (imageFit === 'contain' ? (fit.usableWidthMm - width) / 2 : 0), y: box.y + padding + (imageFit === 'contain' ? (fit.usableHeightMm - height) / 2 : 0), width: imageFit === 'cover' ? fit.usableWidthMm : width, height: imageFit === 'cover' ? fit.usableHeightMm : height });
            if (effectiveDpi < policy.minimumImageDpi) fit.issues.push(issue('image-resolution-low', 'warning', `Effective source resolution is ${Math.round(effectiveDpi)} dpi at this physical placement.`, [state.visual.id]));
            if (croppedFraction > 0.01) fit.issues.push(issue('image-cropped', 'warning', `${Math.round(croppedFraction * 100)}% of the source raster is outside the crop; inspect the actual content before accepting.`, [state.visual.id]));
          }
        }
        fit.usedAreaMm2 = polygonArea(polygons.map((polygon) => clipPhysicalPolygon(polygon, safe)));
        fit.status = blockoutFitStatus(fit.issues); pageResult.blocks.push(fit); contentPolygons.push(...polygons);
      }
      if (contentPolygons.length > 2000) pageResult.issues.push(issue('geometry-measurement-limit', 'blocked', 'The page exceeds the bounded physical geometry analysis; no density pass is claimed.'));
      else {
        const clipped = contentPolygons.map((polygon) => clipPhysicalPolygon(polygon, safe));
        pageResult.usedAreaMm2 = polygonArea(clipped); pageResult.density = pageResult.safeAreaMm2 > 0 ? pageResult.usedAreaMm2 / pageResult.safeAreaMm2 : 0;
        pageResult.overlapAreaMm2 = physicalPolygonUnionArea(clipped, 2); pageResult.overflowAreaMm2 = Math.max(0, polygonArea(contentPolygons) - pageResult.usedAreaMm2);
        if (pageResult.overlapAreaMm2 > 0.5) pageResult.issues.push(issue('content-overlap', 'blocked', `Measured material overlaps across ${pageResult.overlapAreaMm2.toFixed(1)} mm².`));
        if (pageResult.overflowAreaMm2 > 0.5) pageResult.issues.push(issue('content-outside-safe-area', 'blocked', `Measured material extends ${pageResult.overflowAreaMm2.toFixed(1)} mm² beyond the safe area.`));
        if (bodyPage(page) && pageResult.density < policy.sparseDensity) pageResult.issues.push(issue('body-page-sparse', 'warning', `Actual material occupies ${(100 * pageResult.density).toFixed(1)}% of the body page’s safe area; review the allocation without adding filler or enlarging type.`));
      }
      if (!page.blocks.length || (bodyPage(page) && !page.blocks.some((block) => block.materialRole !== 'service' && block.contentIds?.some((id) => items.has(id))))) pageResult.issues.push(issue('page-material-missing', 'blocked', 'This page contains no measurable bound material.'));
      pageResult.status = blockoutFitStatus(pageResult.issues, pageResult.blocks.map((block) => block.status)); result.pages.push(pageResult);
    }
    for (let index = 1; index < result.pages.length; index++) {
      const previous = result.pages[index - 1]!, current = result.pages[index]!;
      if (bodyPage(variant.pages[index - 1]!) && bodyPage(variant.pages[index]!) && Math.abs(previous.density - current.density) > policy.adjacentDensityDifference) {
        current.issues.push(issue('adjacent-density-imbalance', 'warning', `Adjacent body pages differ by ${(100 * Math.abs(previous.density - current.density)).toFixed(1)} percentage points in measured density.`)); current.status = blockoutFitStatus(current.issues, current.blocks.map((block) => block.status));
      }
    }
    result.status = blockoutFitStatus(result.issues, result.pages.map((page) => page.status)); assessment.variants.push(result);
  }
  const pairs = compareBlockoutAlternatives(document, variants.map((variant) => variant.id)), alternativeIssues = assessment.alternatives.issues;
  const representatives: string[] = [];
  for (const variant of variants) if (!representatives.some((id) => pairs.some((pair) => [pair.leftVariantId, pair.rightVariantId].includes(id) && [pair.leftVariantId, pair.rightVariantId].includes(variant.id) && !pair.meaningful))) representatives.push(variant.id);
  assessment.alternatives.pairs = pairs; assessment.alternatives.distinctCount = representatives.length;
  if (variants.length < minimum) alternativeIssues.push(issue('alternatives-missing', variants.length ? 'blocked' : 'waiting', `Expected ${minimum} material-bound alternatives; found ${variants.length}.`));
  if (pairs.some((pair) => !pair.sameContent)) alternativeIssues.push(issue('alternatives-content-mismatch', 'blocked', 'Alternatives must contain the same selected material before their layouts can be compared.'));
  if (pairs.some((pair) => !pair.meaningful)) alternativeIssues.push(issue('alternatives-not-distinct', 'blocked', 'Some alternatives differ only in names, cosmetic changes or minor shifts; change grouping, reading order or hierarchy.'));
  assessment.alternatives.status = blockoutFitStatus(alternativeIssues);
  assessment.status = blockoutFitStatus(issues, [...assessment.variants.map((variant) => variant.status), assessment.alternatives.status]);
  assessment.limitations = unique(assessment.variants.flatMap((variant) => variant.pages.flatMap((page) => page.blocks.flatMap((block) => block.text?.limitations ?? block.issues.filter((entry) => /unavailable|unknown/.test(entry.code)).map((entry) => entry.message)))));
  return assessment;
}
