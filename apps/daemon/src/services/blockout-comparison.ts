import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BlockoutDocumentSchema, blockoutComparisonFilePath, blockoutReferenceTiles, documentPresentationPageState, renderAppliedHeaderFooterSvg, type BlockoutBlock, type BlockoutDocument, type BlockoutFitAssessment, type BlockoutMaterialInventory } from '@open-design/contracts';
import { containedIntakePath } from './project-intake-settings.js';
import { readBlockoutWorkspace } from './blockout-workspaces.js';
import { BLOCKOUT_COMPARISON_SCRIPT, BLOCKOUT_COMPARISON_STYLES } from './blockout-comparison-presentation.js';
import { withProjectHistoryMutation } from '../project-history-observer.js';
import { replaceFileAtomically } from '../storage/atomic-file.js';

const MARKER = 'data-melillodesign-blockout-comparison="1"';
const escape = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const number = (value: number) => Number(value.toFixed(4));
const statusLabel = { waiting: 'Preparazione in corso', blocked: 'Da correggere', warning: 'Controlla gli avvisi', ready: 'Controlli completati' };
const structureStatusLabel = { waiting: 'Verifica della struttura in corso', blocked: 'Geometria da correggere', warning: 'Controlla la struttura', ready: 'Geometria verificata' };
const roleLabels = { heading: 'Titolo', body: 'Testo', caption: 'Didascalia', figure: 'Figura', table: 'Tabella', background: 'Sfondo / filigrana', navigation: 'Navigazione' };
const flexibilityLabels = { fixed: 'Posizione vincolata', guided: 'Adattamenti guidati', free: 'Composizione libera' };

function assertDocumentRevision(document: BlockoutDocument, assessment: BlockoutFitAssessment): void {
  const revision = createHash('sha256').update(JSON.stringify(document)).digest('hex');
  if (assessment.documentId !== document.documentId || assessment.documentRevision !== revision) throw new Error('Comparison assessment does not match the document snapshot');
}

function proposalNavigation(document: BlockoutDocument, includeMaterials = false): string {
  return `<nav aria-label="Proposte">${document.variants.map((variant, index) => `<button type="button" data-scroll-target="proposal-${index}">${escape(variant.label || `Proposta ${index + 1}`)}</button>`).join('')}${includeMaterials ? '<button type="button" data-scroll-target="material-map">Materiali utilizzati</button>' : ''}</nav>`;
}

function previewDialog(): string {
  return '<dialog class="structurePreview" aria-labelledby="page-preview-title"><header><h2 id="page-preview-title" data-page-title></h2><button type="button" data-close-preview>Chiudi anteprima</button></header><div class="previewNavigation"><button type="button" data-preview-previous>Pagina precedente</button><p data-preview-position role="status" aria-live="polite"></p><button type="button" data-preview-next>Pagina successiva</button></div><div data-page-preview tabindex="0"></div><footer class="previewActions"><p data-preview-selection-status role="status" aria-live="polite"></p><div><button type="button" data-choose-preview>Scegli questa struttura</button><button type="button" data-choose-preview-edit>Modifica composizione di questa pagina</button></div></footer></dialog>';
}

function structuralBlockRole(block: BlockoutBlock): keyof typeof roleLabels {
  return block.designRole ?? (block.kind === 'text' ? 'body' : block.kind === 'table' ? 'table' : 'figure');
}

function structuralProposalLabel(label: string, index: number): string {
  return label.replace(/^[ABC]\s*[·.:\-–—]\s*/i, '').trim() || `Struttura ${index + 1}`;
}

/** Intent and geometry only. Asset bindings remain in the workspace for the later design stage. */
export function renderStructuralBlockoutComparison(document: BlockoutDocument, assessment: BlockoutFitAssessment): string {
  document = BlockoutDocumentSchema.parse(document);
  assertDocumentRevision(document, assessment);
  if (assessment.basis !== 'structure') throw new Error('Structural comparison requires a structural assessment');
  const sections = document.variants.map((variant, variantIndex) => {
    const proposalLabel = structuralProposalLabel(variant.label, variantIndex);
    const fit = assessment.variants.find((item) => item.variantId === variant.id);
    const pages = variant.pages.map((page, index) => {
      const pageFit = fit?.pages.find((item) => item.pageId === page.id);
      const applied = document.presentation?.headerFooter, pageState = documentPresentationPageState(document.presentation, { index, ...(page.role ? { role: page.role } : {}) });
      const recurring = applied ? renderAppliedHeaderFooterSvg(applied, { widthMm: page.widthMm, heightMm: page.heightMm, documentName: document.title, index, totalPages: variant.pages.length, isCover: pageState.isCover, visibleNumber: pageState.visibleNumber,
        assetUrl: (file) => path.posix.relative(path.posix.dirname(blockoutComparisonFilePath(document)), file) }) : '';
      const blocks = [...page.blocks].sort((left, right) => Number(structuralBlockRole(right) === 'background') - Number(structuralBlockRole(left) === 'background')).map((block, blockIndex) => {
        const role = structuralBlockRole(block), x = block.box.x * page.widthMm / 100, y = block.box.y * page.heightMm / 100;
        const width = block.box.width * page.widthMm / 100, height = block.box.height * page.heightMm / 100;
        const fontSize = Math.max(1.8, Math.min(4, width / 16, height / 3));
        const maxCharacters = Math.max(4, Math.floor((width - 3) / (fontSize * .55)));
        const label = roleLabels[role], shortLabel = label.length > maxCharacters ? `${label.slice(0, Math.max(1, maxCharacters - 1))}…` : label;
        const clipId = `block-clip-${variantIndex}-${index}-${blockIndex}`;
        const references = block.referencePreview ? blockoutReferenceTiles(block.images, width / height).map((tile, imageIndex) => {
          const image = block.images[imageIndex]!;
          const href = path.posix.relative(path.posix.dirname(blockoutComparisonFilePath(document)), image.imagePath).split('/').map(encodeURIComponent).join('/');
          return `<image data-blockout-reference="${escape(image.assetId)}" href="${escape(href)}" x="${number(x + tile.x * width / 100)}" y="${number(y + tile.y * height / 100)}" width="${number(tile.width * width / 100)}" height="${number(tile.height * height / 100)}" opacity=".25" preserveAspectRatio="xMidYMid meet"/>`;
        }).join('') : '';
        return `<g data-block-id="${escape(block.id)}" data-design-role="${role}" transform="rotate(${block.box.rotation} ${number(x + width / 2)} ${number(y + height / 2)})"><title>${escape([label, block.label, block.expectation].filter(Boolean).join(' · '))}</title><defs><clipPath id="${clipId}"><rect x="${number(x)}" y="${number(y)}" width="${number(width)}" height="${number(height)}"/></clipPath></defs><rect class="structuralBlock structuralBlock-${role}" x="${number(x)}" y="${number(y)}" width="${number(width)}" height="${number(height)}" rx=".7"/>${references}<text clip-path="url(#${clipId})" x="${number(x + width / 2)}" y="${number(y + height / 2)}" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-size="${number(fontSize)}" fill="#284c45">${escape(shortLabel)}</text></g>`;
      }).join('') + recurring;
      const warnings = [...(pageFit?.issues ?? []), ...(pageFit?.blocks.flatMap((block) => block.issues) ?? [])];
      const notes = page.blocks.map((block) => `<li><strong>${escape(roleLabels[structuralBlockRole(block)])}${block.label ? ` · ${escape(block.label)}` : ''}</strong>${block.expectation ? `<p>${escape(block.expectation)}</p>` : ''}${block.feedback ? `<p>Il tuo feedback: ${escape(block.feedback)}</p>` : ''}<small>${flexibilityLabels[block.flexibility]}</small></li>`).join('');
      return `<section class="page" data-page-preview-card data-page-id="${escape(page.id)}"><header><h3>${index + 1}. ${escape(page.label || `Pagina ${index + 1}`)}</h3><span>${page.widthMm} × ${page.heightMm} mm</span></header><button class="pageButton" type="button" data-preview-page data-page-id="${escape(page.id)}" aria-label="Guarda pagina ${index + 1}: ${escape(page.label)} · ${escape(proposalLabel)}"><svg viewBox="0 0 ${page.widthMm} ${page.heightMm}" role="img" aria-label="Struttura di ${escape(page.label || `pagina ${index + 1}`)}"><rect width="${page.widthMm}" height="${page.heightMm}" fill="white"/><rect x="${page.safeMarginMm}" y="${page.safeMarginMm}" width="${Math.max(0, page.widthMm - 2 * page.safeMarginMm)}" height="${Math.max(0, page.heightMm - 2 * page.safeMarginMm)}" fill="none" stroke="#97a49e" stroke-width=".25" stroke-dasharray="1.5 1.5"/>${blocks}</svg><span class="openHint">Guarda pagina ${index + 1}</span></button><template data-page-notes>${page.expectation ? `<p class="pageIntent">${escape(page.expectation)}</p>` : ''}${page.feedback ? `<p class="pageIntent">Il tuo feedback: ${escape(page.feedback)}</p>` : ''}<p class="metrics">${page.blocks.length} blocchi · ${structureStatusLabel[pageFit?.status ?? 'waiting']}</p>${warnings.length ? `<details><summary>${warnings.length} avvisi sulla geometria</summary><ul>${warnings.map((item) => `<li>${escape(item.message)}</li>`).join('')}</ul></details>` : ''}${notes ? `<details class="blockNotes"><summary>Intenzioni e feedback registrati</summary><ul>${notes}</ul></details>` : ''}</template></section>`;
    }).join('');
    return `<article class="structureProposal" id="proposal-${variantIndex}" data-variant-id="${escape(variant.id)}" aria-labelledby="proposal-title-${variantIndex}"><header><h2 id="proposal-title-${variantIndex}">${escape(proposalLabel)}</h2><p>Documento completo · ${variant.pages.length} pagine</p><button class="selectProposal" type="button" data-select-proposal data-document-id="${escape(document.documentId)}" data-variant-id="${escape(variant.id)}" data-proposal-label="${escape(proposalLabel)}" aria-pressed="false">Scegli questa struttura</button></header><div class="proposalPages">${pages}</div></article>`;
  }).join('');
  const warnings = [...assessment.issues, ...assessment.alternatives.issues];
  return `<!doctype html><html lang="it" ${MARKER}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="melillodesign-blockout-document" content="${escape(document.documentId)}"><meta name="blockout-document-revision" content="${assessment.documentRevision}"><meta name="blockout-planning-stage" content="structure"><title>${escape(document.title)} · Confronto Blockout</title><style>${BLOCKOUT_COMPARISON_STYLES}</style></head><body class="structuralComparison"><main><header class="heading"><div><h1>${escape(document.title || 'Struttura del documento')}</h1><p>Confronta gerarchia, ritmo e spazio previsto per ogni funzione. I riquadri sono blocchi da progettare: testi, immagini e filigrane verranno sviluppati nella fase grafica. Guarda le pagine in anteprima, poi scegli una struttura per il documento completo.</p></div><div class="status"><strong>${structureStatusLabel[assessment.status]}</strong><span>${document.variants.length} proposte · Blocchi funzionali</span></div></header>${warnings.length ? `<details class="structureWarnings"><summary>Controlla la struttura</summary><ul>${warnings.map((item) => `<li>${escape(item.message)}</li>`).join('')}</ul></details>` : ''}<p class="selectionStatus" data-proposal-selection-status role="status" aria-live="polite"></p><div class="proposals">${sections}</div><footer>Questa anteprima riguarda la struttura. La quantità di testo e la leggibilità delle immagini saranno verificate durante la composizione grafica. Dopo la scelta potrai modificare i blocchi. La scelta della struttura non avvia la grafica.</footer></main>${previewDialog()}<script>${BLOCKOUT_COMPARISON_SCRIPT}</script></body></html>`;
}
export function blockoutComparisonPath(document: BlockoutDocument): string {
  return blockoutComparisonFilePath(document);
}

/** Deterministic snapshot: the comparison cannot invent text volume or table rows. */
export function renderMeasuredBlockoutComparison(document: BlockoutDocument, inventory: BlockoutMaterialInventory, assessment: BlockoutFitAssessment): string {
  document = BlockoutDocumentSchema.parse(document);
  const revision = createHash('sha256').update(JSON.stringify(document)).digest('hex');
  if (assessment.documentId !== document.documentId || assessment.documentRevision !== revision || assessment.inventoryRevision !== inventory.revision) throw new Error('Comparison measurements do not match the document/material snapshot');
  const relative = blockoutComparisonPath(document), directory = path.posix.dirname(relative);
  const materials = new Map(inventory.items.map((item) => [item.id, item]));
  const variants = document.variants.filter((variant) => assessment.variants.some((item) => item.variantId === variant.id));
  const sections = variants.map((variant, variantIndex) => {
    const fit = assessment.variants.find((item) => item.variantId === variant.id)!;
    const pages = variant.pages.map((page, index) => {
      const pageFit = fit.pages.find((item) => item.pageId === page.id);
      const blocks = page.blocks.map((block) => {
        const measured = pageFit?.blocks.find((item) => item.blockId === block.id);
        const box = measured?.boxMm ?? { x: block.box.x * page.widthMm / 100, y: block.box.y * page.heightMm / 100, width: block.box.width * page.widthMm / 100, height: block.box.height * page.heightMm / 100 };
        const padding = block.typography?.paddingMm ?? 0;
        const rotate = `rotate(${block.box.rotation} ${number(box.x + box.width / 2)} ${number(box.y + box.height / 2)})`;
        const rectangle = `<rect x="${number(box.x)}" y="${number(box.y)}" width="${number(box.width)}" height="${number(box.height)}" fill="#f4f4f4" stroke="#aaa" stroke-width="0.2"/>`;
        const visual = (block.contentIds ?? []).map((id) => materials.get(id)).find((item) => item && item.kind !== 'text');
        let content = '';
        if (measured?.text) {
          const text = measured.text, fontMm = text.fontSizePt * 25.4 / 72;
          const lines = text.lines.map((line, lineIndex) => `<text x="${number(box.x + padding)}" y="${number(box.y + padding + lineIndex * text.lineHeightMm)}" dominant-baseline="text-before-edge" font-family="${escape(text.fontFamily)}" font-size="${number(fontMm)}" fill="#222" xml:space="preserve">${escape(line.text)}</text>`).join('');
          content = `<g data-measured-lines="${text.lines.length}">${lines}</g>`;
        } else if (visual && visual.kind !== 'text' && measured?.image) {
          const image = measured.image;
          const source = path.posix.relative(directory, visual.imagePath.replaceAll('\\', '/'));
          content = `<image href="${escape(source)}" x="${number(box.x + padding)}" y="${number(box.y + padding)}" width="${number(Math.max(0, box.width - padding * 2))}" height="${number(Math.max(0, box.height - padding * 2))}" preserveAspectRatio="xMidYMid ${image.fit === 'cover' ? 'slice' : 'meet'}"><title>${escape(visual.label)}</title></image>`;
        } else content = `<text x="${number(box.x + padding + 1)}" y="${number(box.y + padding + 4)}" font-family="Arial,sans-serif" font-size="3" fill="#333">${escape(block.label)} · misura non disponibile</text>`;
        return `<g data-block-id="${escape(block.id)}" transform="${rotate}"><title>${escape(block.label)}</title>${rectangle}${content}</g>`;
      }).join('');
      const warnings = [...(pageFit?.issues ?? []), ...(pageFit?.blocks.flatMap((block) => block.issues) ?? [])];
      return `<section class="page" data-page-id="${escape(page.id)}"><header><h3>${index + 1}. ${escape(page.label)}</h3><span>${page.widthMm} × ${page.heightMm} mm</span></header><button class="pageButton" type="button" data-open-page data-document-id="${escape(document.documentId)}" data-variant-id="${escape(variant.id)}" data-page-id="${escape(page.id)}" aria-label="Apri pagina ${index + 1}: ${escape(page.label)} · ${escape(variant.label)}"><svg viewBox="0 0 ${page.widthMm} ${page.heightMm}" role="img" aria-label="${escape(page.label)}"><rect width="${page.widthMm}" height="${page.heightMm}" fill="white"/><rect x="${page.safeMarginMm}" y="${page.safeMarginMm}" width="${Math.max(0, page.widthMm - 2 * page.safeMarginMm)}" height="${Math.max(0, page.heightMm - 2 * page.safeMarginMm)}" fill="none" stroke="#aaa" stroke-width="0.2" stroke-dasharray="1.5 1.5"/>${blocks}</svg><span class="openHint">Apri e modifica i blocchi</span></button><p class="metrics">Spazio occupato: ${pageFit ? `${(pageFit.density * 100).toFixed(1)}%` : 'non misurato'} · ${statusLabel[pageFit?.status ?? 'waiting']}</p>${warnings.length ? `<details><summary>${warnings.length} avvisi per questa pagina</summary><ul>${warnings.map((item) => `<li>${escape(item.message)}</li>`).join('')}</ul></details>` : ''}</section>`;
    }).join('');
    return `<article id="proposal-${variantIndex}" data-variant-id="${escape(variant.id)}" tabindex="-1"><header><h2>${escape(variant.label)}</h2><p>${variant.pages.length} pagine · ${statusLabel[fit.status]}</p></header>${pages}</article>`;
  }).join('');
  const sources = (document.materialIds ?? []).map((id) => materials.get(id)).filter((item) => !!item);
  const allocation = sources.map((item) => `<tr><th scope="row">${escape(item.label)}</th><td>${escape(item.sourcePath)} · p. ${item.sourcePage}</td><td>${item.kind === 'text' ? `${item.text.length} caratteri` : `${item.width} × ${item.height} px`}</td>${variants.map((variant) => `<td>${variant.pages.flatMap((page, index) => page.blocks.some((block) => block.contentIds?.includes(item.id)) ? [String(index + 1)] : []).join(', ') || 'Mancante'}</td>`).join('')}</tr>`).join('');
  const warnings = [...assessment.issues, ...assessment.alternatives.issues];
  return `<!doctype html><html lang="it" ${MARKER}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="melillodesign-blockout-document" content="${escape(document.documentId)}"><meta name="blockout-document-revision" content="${assessment.documentRevision}"><meta name="blockout-material-revision" content="${inventory.revision}"><title>${escape(document.title)} · Confronto Blockout</title><style>
${BLOCKOUT_COMPARISON_STYLES}</style></head><body><main><header class="heading"><div><h1>${escape(document.title)}</h1><p>Confronta il ritmo delle pagine e la disposizione dei tuoi materiali. Apri una pagina per modificarne i blocchi, senza uscire dalla conversazione.</p></div><div class="status"><strong>${statusLabel[assessment.status]}</strong><span>${sources.length} materiali · ${variants.length} proposte</span></div></header>${warnings.length ? `<details open><summary>Elementi da controllare</summary><ul>${warnings.map((item) => `<li>${escape(item.message)}</li>`).join('')}</ul></details>` : ''}${proposalNavigation({ ...document, variants }, true)}<div class="proposals">${sections || '<p>Inventario o misure non ancora disponibili. Attendi il completamento della preparazione.</p>'}</div><details class="map" id="material-map"><summary>Lo stesso materiale in ogni proposta</summary><div class="tableScroll"><table><thead><tr><th>Materiale</th><th>Fonte</th><th>Quantità</th>${variants.map((variant) => `<th>${escape(variant.label)}</th>`).join('')}</tr></thead><tbody>${allocation}</tbody></table></div></details><footer>La struttura resta modificabile. La grafica inizia dopo la tua approvazione. Misure aggiornate al ${escape(assessment.assessedAt)}. Le figure mantengono le proporzioni originali; controlla anche la leggibilità delle quote e delle legende.</footer></main><dialog aria-labelledby="page-preview-title"><header><h2 id="page-preview-title" data-page-title></h2><button type="button">Chiudi anteprima</button></header><div data-page-preview></div></dialog><script>${BLOCKOUT_COMPARISON_SCRIPT}</script></body></html>`;
}

/** Both stages share the same history, size bounds and saved-revision publication. */
async function publishBlockoutComparison(root: string, document: BlockoutDocument, raw: string, html: string): Promise<string | null> {
  const relative = blockoutComparisonPath(document);
  if (Buffer.byteLength(html) > 4_000_000) throw new Error('Blockout comparison exceeds its size limit');
  const saved = await readBlockoutWorkspace(root, document.documentId);
  if (saved.raw !== raw || JSON.stringify(saved.document) !== JSON.stringify(BlockoutDocumentSchema.parse(document))) return null;
  await containedIntakePath(root, path.posix.dirname(relative), true);
  const target = await containedIntakePath(root, relative);
  try {
    if ((await stat(target)).size > 4_000_000) throw new Error('Previous comparison exceeds its backup limit');
    const old = await readFile(target, 'utf8');
    if (old !== html) {
      await containedIntakePath(root, 'blockout/.context/comparison-history', true);
      const backup = await containedIntakePath(root, `blockout/.context/comparison-history/${createHash('sha256').update(old).digest('hex')}.html`);
      try { await writeFile(backup, old, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = await containedIntakePath(root, `${relative}.${randomUUID()}.tmp`);
  return withProjectHistoryMutation({ root, paths: [relative] }, async () => {
    try {
      await writeFile(temporary, html, { flag: 'wx' });
      const current = await readBlockoutWorkspace(root, document.documentId);
      if (current.raw !== raw) return null;
      await replaceFileAtomically(temporary, target); return relative;
    } finally { await unlink(temporary).catch(() => undefined); }
  });
}

export async function saveMeasuredBlockoutComparison(root: string, document: BlockoutDocument, raw: string, inventory: BlockoutMaterialInventory, assessment: BlockoutFitAssessment): Promise<string | null> {
  return publishBlockoutComparison(root, document, raw, renderMeasuredBlockoutComparison(document, inventory, assessment));
}

export async function saveStructuralBlockoutComparison(root: string, document: BlockoutDocument, raw: string, assessment: BlockoutFitAssessment): Promise<string | null> {
  return publishBlockoutComparison(root, document, raw, renderStructuralBlockoutComparison(document, assessment));
}
