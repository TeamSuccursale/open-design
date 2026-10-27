/**
 * The tender's rules checked against a designed document, before it is exported.
 *
 * The setup saves each document's rules as the sentences the engineer confirmed («massimo 8 pagine A4…», «Arial,
 * corpo 11»), each with the source pages it came from. The daemon measures the document in the same browser that
 * prints it, and the check compares the two: page count against the cap, paper and orientation, the smallest type
 * and the margins. Every row cites its rule; a row whose rule says nothing measurable stays `unchecked` and shows
 * what was measured. The check only warns: export never waits for it.
 */
import { z } from 'zod';
import { blockoutSafeArea } from './blockout-geometry.js';
import { blockoutWorkspacePath } from './blockout-files.js';
import type { BlockoutPage } from './blockout.js';
import { documentPresentationPageState, type DocumentPresentation } from './document-presentation.js';
import type { DocumentContextSource, DocumentLayoutConstraint } from './document-setup.js';

const text = z.string().max(240);
const page = z.number().int().positive();
const mm = z.number().finite();
const SIDES = ['left', 'right', 'top', 'bottom'] as const;
export type DocumentPageSide = typeof SIDES[number];

const FontMeasureSchema = z.object({ pt: z.number().finite().nonnegative(), family: text, chars: z.number().int().nonnegative(), text, blockId: text.optional(), recurring: z.boolean() });
const MarginMeasureSchema = z.object({ mm, kind: z.enum(['text', 'image', 'box', 'header-footer']), blockId: text.optional(), text });
/** What the measuring script reports for each page: its paper, the type sizes on it and the content nearest each edge. */
export const DocumentLayoutMeasurementSchema = z.object({
  documentId: z.string().max(240).nullable(), unreadStylesheets: z.number().int().nonnegative(),
  pages: z.array(z.object({
    index: page, widthMm: z.number().positive(), heightMm: z.number().positive(), blockoutPageId: text.optional(),
    fonts: z.array(FontMeasureSchema).max(500),
    margins: z.object({ left: MarginMeasureSchema.optional(), right: MarginMeasureSchema.optional(), top: MarginMeasureSchema.optional(), bottom: MarginMeasureSchema.optional() }),
  })).max(2000),
});
export type DocumentLayoutMeasurement = z.infer<typeof DocumentLayoutMeasurementSchema>;

const status = z.enum(['ok', 'warning', 'unchecked']);
export type DocumentRuleStatus = z.infer<typeof status>;
/** A tender rule as the engineer confirmed it, with its source files and pages; or the Blockout's own safe margin. */
const RuleSchema = z.object({
  origin: z.enum(['tender', 'blockout']), text: z.string().max(2000), status: z.enum(['suggested', 'confirmed', 'conflict']).optional(),
  sources: z.array(z.object({ path: z.string().max(2000), page: page.optional() })).max(30),
}).nullable();
const where = { page, blockId: text.optional(), label: text.optional(), text: text.optional() };
const FontSampleSchema = z.object({ ...where, pt: z.number().finite().nonnegative(), family: text, chars: z.number().int().nonnegative(), recurring: z.boolean() });
const MarginSampleSchema = z.object({ ...where, side: z.enum(SIDES), mm, expectedMm: mm.optional(), kind: MarginMeasureSchema.shape.kind });
const MarginsSchema = z.object({ left: mm.optional(), right: mm.optional(), top: mm.optional(), bottom: mm.optional() });
const size = { widthMm: z.number().positive(), heightMm: z.number().positive() };
const orientation = z.enum(['portrait', 'landscape']);
export const DocumentRuleCheckRowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pages'), status, rule: RuleSchema, expected: z.object({ maxPages: page }).nullable(),
    measured: z.object({ total: z.number().int().nonnegative(), counted: z.number().int().nonnegative(), covers: z.number().int().nonnegative(), undecidedCovers: z.number().int().nonnegative() }) }),
  z.object({ kind: z.literal('paper'), status, rule: RuleSchema, expected: z.object({ name: text.optional(), ...size }).nullable(),
    measured: z.object({ sizes: z.array(z.object({ ...size, pages: z.array(page) })) }), findings: z.array(z.object({ page, ...size })) }),
  z.object({ kind: z.literal('orientation'), status, rule: RuleSchema, expected: orientation.nullable(),
    measured: z.object({ portrait: z.array(page), landscape: z.array(page) }), findings: z.array(z.object({ page, orientation })) }),
  z.object({ kind: z.literal('font'), status, rule: RuleSchema, expected: z.object({ minPt: z.number().positive().optional(), family: text.optional() }).nullable(),
    measured: z.object({ smallest: FontSampleSchema.nullable(), families: z.array(z.object({ family: text, chars: z.number().int().nonnegative() })) }),
    findings: z.array(FontSampleSchema.extend({ issue: z.enum(['size', 'family']) })) }),
  z.object({ kind: z.literal('margins'), status, rule: RuleSchema, expected: MarginsSchema.nullable(),
    measured: z.object({ smallest: MarginSampleSchema.nullable() }), findings: z.array(MarginSampleSchema) }),
]);
export type DocumentRuleCheckRow = z.infer<typeof DocumentRuleCheckRowSchema>;
export const DocumentRuleCheckSchema = z.object({
  version: z.literal(1), fileName: z.string().max(2000), documentId: z.string().max(240).nullable(), status, pages: z.number().int().nonnegative(),
  unreadStylesheets: z.number().int().nonnegative(), rows: z.array(DocumentRuleCheckRowSchema).length(5),
});
export type DocumentRuleCheck = z.infer<typeof DocumentRuleCheckSchema>;
export const DocumentRuleCheckRequestSchema = z.object({ fileName: z.string().min(1).max(2000), versionId: z.string().min(1).max(200).optional() });
export type DocumentRuleCheckRequest = z.infer<typeof DocumentRuleCheckRequestSchema>;
/** `check` is null for a file whose pages declare no paper size: there is nothing to measure against. */
export interface DocumentRuleCheckResponse { check: DocumentRuleCheck | null }

export interface ParsedDocumentRule {
  maxPages?: number; paper?: { name?: string; widthMm: number; heightMm: number }; orientation?: 'portrait' | 'landscape';
  minPt?: number; family?: string; margins?: Partial<Record<DocumentPageSide, number>>;
}
const A_SERIES: Record<string, [number, number]> = { A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297], A5: [148, 210] };
const FAMILIES = ['Arial Narrow', 'Arial', 'Helvetica', 'Times New Roman', 'Calibri', 'Cambria', 'Garamond', 'Georgia', 'Verdana', 'Tahoma',
  'Century Gothic', 'Book Antiqua', 'Palatino Linotype', 'Segoe UI', 'Roboto', 'Open Sans', 'Liberation Sans', 'Bahnschrift'];
const LENGTH = String.raw`(\d{1,3}(?:[.,]\d+)?)\s*(mm|cm)\b`;
const MARGIN_SIDES: [RegExp, DocumentPageSide[]][] = [
  [new RegExp(String.raw`\b(?:superior[ei]|in alto|alt[oi]|top|testa)\D{0,20}?` + LENGTH, 'i'), ['top']],
  [new RegExp(String.raw`\b(?:inferior[ei]|in basso|bass[oi]|bottom|piede)\D{0,20}?` + LENGTH, 'i'), ['bottom']],
  [new RegExp(String.raw`\b(?:sinistr[oai]|left|intern[oi])\D{0,20}?` + LENGTH, 'i'), ['left']],
  [new RegExp(String.raw`\b(?:destr[oai]|right|estern[oi])\D{0,20}?` + LENGTH, 'i'), ['right']],
  [new RegExp(String.raw`\b(?:laterali|lati|sides)\b\D{0,20}?` + LENGTH, 'i'), ['left', 'right']],
];
const decimal = (value: string) => Number(value.replace(',', '.'));
const millimetres = (value: string, unit: string) => Math.round(decimal(value) * (unit.toLowerCase() === 'cm' ? 10 : 1) * 10) / 10;

/** Reads the one measurable value a rule sentence states; a sentence that is ambiguous or vague yields nothing. */
export function parseDocumentRule(kind: DocumentLayoutConstraint['kind'], value: string): ParsedDocumentRule {
  if (kind === 'page-limit') {
    const match = /(?:massim[oaie]|max\.?|maximum|at most|no more than|non (?:oltre|più di|superiore a)|fino a|entro)\D{0,30}?(\d{1,4})(?![\d.,]\d)/i.exec(value)
      ?? /\b(\d{1,4})\s*(?:pagine|facciate|cartelle|fogli|pages|sheets)\b/i.exec(value);
    const pages = match ? Number(match[1]) : 0;
    return pages > 0 ? { maxPages: pages } : {};
  }
  if (kind === 'paper') {
    const names = [...new Set([...value.matchAll(/\bA\s?([0-5])\b/g)].map((match) => `A${match[1]}`))];
    if (names.length === 1) { const [widthMm, heightMm] = A_SERIES[names[0]!]!; return { paper: { name: names[0]!, widthMm, heightMm } }; }
    const dims = /(\d{2,4}(?:[.,]\d+)?)\s*[x×]\s*(\d{2,4}(?:[.,]\d+)?)\s*mm/i.exec(value);
    if (!names.length && dims) { const [widthMm, heightMm] = [decimal(dims[1]!), decimal(dims[2]!)].sort((a, b) => a - b) as [number, number]; return { paper: { widthMm, heightMm } }; }
    return {};
  }
  if (kind === 'orientation') {
    const portrait = /\b(?:verticale|verticali|portrait|ritratto)\b/i.test(value), landscape = /\b(?:orizzontale|orizzontali|landscape|paesaggio)\b/i.test(value);
    return portrait === landscape ? {} : { orientation: portrait ? 'portrait' : 'landscape' };
  }
  if (kind === 'typography') {
    const family = FAMILIES.find((name) => new RegExp(String.raw`\b${name.replace(/ /g, String.raw`\s+`)}\b`, 'i').test(value));
    const match = /(?:corpo|dimensione(?:\s+minima)?(?:\s+del(?:\s+(?:carattere|font|testo))?)?|font[- ]size|type size)\D{0,20}?(\d{1,2}(?:[.,]\d)?)(?!\d)/i.exec(value)
      ?? /(\d{1,2}(?:[.,]\d)?)\s*(?:pt|punti|points?)\b/i.exec(value)
      ?? (family ? new RegExp(String.raw`\b${family.replace(/ /g, String.raw`\s+`)}\s+(\d{1,2})\b`, 'i').exec(value) : null);
    const pt = match ? decimal(match[1]!) : NaN;
    return { ...(pt >= 5 && pt <= 30 ? { minPt: pt } : {}), ...(family ? { family } : {}) };
  }
  if (kind === 'margins') {
    const margins: Partial<Record<DocumentPageSide, number>> = {};
    for (const [pattern, sides] of MARGIN_SIDES) {
      const match = pattern.exec(value);
      if (match) for (const side of sides) margins[side] ??= millimetres(match[1]!, match[2]!);
    }
    if (!Object.keys(margins).length) {
      const uniform = new RegExp(LENGTH, 'i').exec(value);
      if (uniform) for (const side of SIDES) margins[side] = millimetres(uniform[1]!, uniform[2]!);
    }
    return Object.keys(margins).length ? { margins: Object.fromEntries(SIDES.filter((side) => margins[side] !== undefined).map((side) => [side, margins[side]])) } : {};
  }
  return {};
}

export interface DocumentRuleCheckInput {
  fileName: string; measurement: DocumentLayoutMeasurement; constraints: readonly DocumentLayoutConstraint[];
  sources: readonly Pick<DocumentContextSource, 'id' | 'path' | 'page'>[];
  presentation?: DocumentPresentation; blockoutPages?: readonly BlockoutPage[];
}
const PAPER_TOLERANCE_MM = 1, MARGIN_TOLERANCE_MM = 0.5, FONT_TOLERANCE_PT = 0.25, MAX_FINDINGS = 20;

/** Compares a measured document with its rules. Each row cites the rule it used; no row ever blocks export. */
export function assessDocumentRules(input: DocumentRuleCheckInput): DocumentRuleCheck {
  const { measurement, constraints } = input, pages = measurement.pages;
  const blockout = new Map((input.blockoutPages ?? []).map((entry) => [entry.id, entry]));
  const blockoutPage = (entry: DocumentLayoutMeasurement['pages'][number]) => entry.blockoutPageId ? blockout.get(entry.blockoutPageId) : undefined;
  const label = (entry: DocumentLayoutMeasurement['pages'][number], blockId?: string) => blockId ? blockoutPage(entry)?.blocks.find((item) => item.id === blockId)?.label : undefined;
  const cite = (constraint: DocumentLayoutConstraint): NonNullable<z.infer<typeof RuleSchema>> => {
    const cited = new Map<string, { path: string; page?: number }>();
    for (const id of constraint.sourceIds) {
      const source = input.sources.find((item) => item.id === id);
      if (source) cited.set(`${source.path}#${source.page ?? ''}`, { path: source.path, ...(source.page ? { page: source.page } : {}) });
    }
    return { origin: 'tender', text: constraint.value, status: constraint.status, sources: [...cited.values()] };
  };
  // The first rule of a kind that states a measurable value wins; otherwise the first one is shown unread.
  const pick = <K extends keyof ParsedDocumentRule>(kind: DocumentLayoutConstraint['kind'], key: K) => {
    const candidates = constraints.filter((constraint) => constraint.kind === kind);
    for (const constraint of candidates) { const parsed = parseDocumentRule(kind, constraint.value)[key]; if (parsed !== undefined) return { rule: cite(constraint), value: parsed as NonNullable<ParsedDocumentRule[K]> }; }
    return { rule: candidates[0] ? cite(candidates[0]) : null, value: undefined };
  };
  const judged = (expected: unknown, findings: unknown[]): DocumentRuleStatus => expected === undefined ? 'unchecked' : findings.length ? 'warning' : 'ok';

  let covers = 0, undecidedCovers = 0;
  pages.forEach((entry, index) => {
    const planned = blockoutPage(entry), state = documentPresentationPageState(input.presentation, { index, ...(planned?.role ? { role: planned.role } : {}) });
    if (planned?.countsTowardLimit === false || state.countsTowardPageLimit === false) covers++;
    else if (state.countsTowardPageLimit === null) undecidedCovers++;
  });
  const limit = pick('page-limit', 'maxPages'), counted = pages.length - covers;
  const pagesRow: DocumentRuleCheckRow = { kind: 'pages', status: limit.value === undefined ? 'unchecked' : counted > limit.value ? 'warning' : 'ok', rule: limit.rule,
    expected: limit.value === undefined ? null : { maxPages: limit.value }, measured: { total: pages.length, counted, covers, undecidedCovers } };

  const paper = pick('paper', 'paper'), sizes: { widthMm: number; heightMm: number; pages: number[] }[] = [];
  for (const entry of pages) {
    const known = sizes.find((item) => Math.abs(item.widthMm - entry.widthMm) < 0.01 && Math.abs(item.heightMm - entry.heightMm) < 0.01);
    if (known) known.pages.push(entry.index); else sizes.push({ widthMm: entry.widthMm, heightMm: entry.heightMm, pages: [entry.index] });
  }
  const paperFindings = paper.value ? pages.filter((entry) => {
    const [short, long] = [entry.widthMm, entry.heightMm].sort((a, b) => a - b) as [number, number];
    return Math.abs(short - paper.value!.widthMm) > PAPER_TOLERANCE_MM || Math.abs(long - paper.value!.heightMm) > PAPER_TOLERANCE_MM;
  }).map((entry) => ({ page: entry.index, widthMm: entry.widthMm, heightMm: entry.heightMm })) : [];
  const paperRow: DocumentRuleCheckRow = { kind: 'paper', status: judged(paper.value, paperFindings), rule: paper.rule, expected: paper.value ?? null, measured: { sizes }, findings: paperFindings.slice(0, MAX_FINDINGS) };

  const turned = (entry: DocumentLayoutMeasurement['pages'][number]) => entry.widthMm > entry.heightMm + 0.5 ? 'landscape' as const : entry.heightMm > entry.widthMm + 0.5 ? 'portrait' as const : null;
  const facing = pick('orientation', 'orientation');
  const orientationFindings = facing.value ? pages.flatMap((entry) => { const actual = turned(entry); return actual && actual !== facing.value ? [{ page: entry.index, orientation: actual }] : []; }) : [];
  const orientationRow: DocumentRuleCheckRow = { kind: 'orientation', status: judged(facing.value, orientationFindings), rule: facing.rule, expected: facing.value ?? null,
    measured: { portrait: pages.filter((entry) => turned(entry) === 'portrait').map((entry) => entry.index), landscape: pages.filter((entry) => turned(entry) === 'landscape').map((entry) => entry.index) },
    findings: orientationFindings.slice(0, MAX_FINDINGS) };

  const typography = constraints.filter((constraint) => constraint.kind === 'typography').map((constraint) => ({ constraint, parsed: parseDocumentRule('typography', constraint.value) }));
  const type = typography.find((entry) => entry.parsed.minPt !== undefined || entry.parsed.family !== undefined) ?? typography[0];
  const samples = pages.flatMap((entry) => entry.fonts.map((font) => ({ page: entry.index, pt: font.pt, family: font.family, chars: font.chars, recurring: font.recurring,
    ...(font.text ? { text: font.text } : {}), ...(font.blockId ? { blockId: font.blockId } : {}), ...(label(entry, font.blockId) ? { label: label(entry, font.blockId)! } : {}) })));
  const families = new Map<string, number>();
  for (const sample of samples) families.set(sample.family, (families.get(sample.family) ?? 0) + sample.chars);
  const minPt = type?.parsed.minPt, family = type?.parsed.family;
  const fontFindings = samples.flatMap((sample) => [
    ...(minPt !== undefined && sample.pt < minPt - FONT_TOLERANCE_PT ? [{ ...sample, issue: 'size' as const }] : []),
    ...(family !== undefined && sample.family.toLowerCase() !== family.toLowerCase() ? [{ ...sample, issue: 'family' as const }] : []),
  ]);
  const smallestFont = samples.reduce<typeof samples[number] | null>((least, sample) => !least || sample.pt < least.pt ? sample : least, null);
  const fontExpected = minPt !== undefined || family !== undefined ? { ...(minPt !== undefined ? { minPt } : {}), ...(family !== undefined ? { family } : {}) } : undefined;
  const fontRow: DocumentRuleCheckRow = { kind: 'font', status: judged(fontExpected, fontFindings), rule: type ? cite(type.constraint) : null, expected: fontExpected ?? null,
    measured: { smallest: smallestFont, families: [...families].map(([name, chars]) => ({ family: name, chars })).sort((a, b) => b.chars - a.chars) },
    findings: fontFindings.slice(0, MAX_FINDINGS) };

  // A tender margin wins; without one, the Blockout's safe area (edge margin plus the header/footer reserve) is the rule.
  const tender = pick('margins', 'margins');
  const planned = (entry: DocumentLayoutMeasurement['pages'][number]): Partial<Record<DocumentPageSide, number>> | undefined => {
    if (tender.value) return tender.value;
    const target = blockoutPage(entry); if (!target) return undefined;
    const safe = blockoutSafeArea(target), round = (value: number) => Math.round(value * 10) / 10;
    return { left: round(safe.left * target.widthMm / 100), right: round((100 - safe.right) * target.widthMm / 100), top: round(safe.top * target.heightMm / 100), bottom: round((100 - safe.bottom) * target.heightMm / 100) };
  };
  const marginSamples = pages.flatMap((entry) => SIDES.flatMap((side) => {
    const measured = entry.margins[side]; if (!measured) return [];
    const expectedMm = planned(entry)?.[side], name = label(entry, measured.blockId);
    return [{ page: entry.index, side, mm: measured.mm, kind: measured.kind, ...(expectedMm !== undefined ? { expectedMm } : {}),
      ...(measured.blockId ? { blockId: measured.blockId } : {}), ...(name ? { label: name } : {}), ...(measured.text ? { text: measured.text } : {}) }];
  }));
  const marginFindings = marginSamples.filter((sample) => sample.expectedMm !== undefined && sample.mm < sample.expectedMm - MARGIN_TOLERANCE_MM);
  const firstPlanned = pages.map(planned).find(Boolean);
  const marginRule = tender.value || !firstPlanned ? tender.rule : { origin: 'blockout' as const, text: '', sources: [{ path: blockoutWorkspacePath(measurement.documentId ?? undefined) }] };
  const marginsRow: DocumentRuleCheckRow = { kind: 'margins', status: judged(firstPlanned, marginFindings), rule: marginRule, expected: firstPlanned ?? null,
    measured: { smallest: marginSamples.reduce<typeof marginSamples[number] | null>((least, sample) => !least || sample.mm < least.mm ? sample : least, null) },
    findings: marginFindings.slice(0, MAX_FINDINGS) };

  const rows = [pagesRow, paperRow, orientationRow, fontRow, marginsRow];
  return { version: 1, fileName: input.fileName, documentId: measurement.documentId, pages: pages.length, unreadStylesheets: measurement.unreadStylesheets, rows,
    status: rows.some((row) => row.status === 'warning') ? 'warning' : rows.some((row) => row.status === 'ok') ? 'ok' : 'unchecked' };
}

/**
 * Runs after the print preparation (`document-print.ts`) inside the same headless browser, once fonts are ready. It
 * switches the document's print rules on, so pages are measured at their printed size, then writes its result into a
 * `md-layout-measure` meta element for `--dump-dom` to carry out. Content below 35% opacity, faded content hidden from
 * assistive technology (a watermark marked `aria-hidden`) and boxes covering most of a page are treated as watermarks
 * and backgrounds; header and footer graphics count for the side margins only.
 */
export const DOCUMENT_LAYOUT_MEASURE_SCRIPT = String.raw`(function(){
var MM=25.4/96,HF='[data-header-footer-set]';
function printMedia(list){if(!list||!list.length)return;var items=[],changed=false;
for(var i=0;i<list.length;i++){var query=list.item(i),text=query.toLowerCase().replace(/^\s+|\s+$/g,'');
if(/^(only )?print\b/.test(text)){items.push(text.replace(/^(only )?print/,'all'));changed=true;}
else if(/^(only )?screen\b/.test(text)){items.push('not all');changed=true;}else items.push(query);}
if(changed)list.mediaText=items.join(', ');}
function walk(rules){for(var i=0;i<rules.length;i++){var rule=rules[i];if(rule.media)printMedia(rule.media);
if(rule.styleSheet){try{walk(rule.styleSheet.cssRules);}catch(e){}}else if(rule.cssRules)walk(rule.cssRules);}}
function asPrint(){var unread=0;[].slice.call(document.styleSheets).forEach(function(sheet){try{printMedia(sheet.media);walk(sheet.cssRules);}catch(e){unread++;}});return unread;}
function opacity(el,page){var value=1;for(var node=el;node&&node!==page.parentElement;node=node.parentElement){var style=getComputedStyle(node);
if(style.display==='none'||style.visibility==='hidden')return 0;value*=Number(style.opacity);}return value;}
function background(el,page){var o=opacity(el,page);if(o<=0.35)return true;if(o>=1)return false;
for(var node=el;node&&node!==page;node=node.parentElement)if(node.getAttribute&&node.getAttribute('aria-hidden')==='true')return true;return false;}
function snippet(value){return String(value||'').replace(/\s+/g,' ').replace(/^ | $/g,'').slice(0,80);}
function block(el){var node=el.closest&&el.closest('[data-blockout-id]');return node?node.getAttribute('data-blockout-id'):undefined;}
function clip(rect,el,page){var r={left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom};
for(var node=el.parentElement;node&&node!==page;node=node.parentElement){var style=getComputedStyle(node);
if(style.overflowX!=='visible'||style.overflowY!=='visible'){var c=node.getBoundingClientRect();
if(style.overflowX!=='visible'){r.left=Math.max(r.left,c.left);r.right=Math.min(r.right,c.right);}
if(style.overflowY!=='visible'){r.top=Math.max(r.top,c.top);r.bottom=Math.min(r.bottom,c.bottom);}}}
return r.right>r.left&&r.bottom>r.top?r:null;}
function painted(color){return !/^transparent$|rgba\([^)]*,\s*0\)$/.test(color);}
function boxed(style){return ['Top','Right','Bottom','Left'].some(function(side){return parseFloat(style['border'+side+'Width'])>0&&style['border'+side+'Style']!=='none'&&painted(style['border'+side+'Color']);})
||style.backgroundImage!=='none'||painted(style.backgroundColor);}
function measure(){
var unread=asPrint(),pages=[].slice.call(document.querySelectorAll('[data-md-print-size]'));
var out={documentId:pages.length?pages[0].getAttribute('data-melillodesign-document-page')||null:null,unreadStylesheets:unread,pages:[]};
pages.forEach(function(page,index){
var w=Number(page.getAttribute('data-width-mm')),h=Number(page.getAttribute('data-height-mm')),box=page.getBoundingClientRect(),mx=w/box.width,my=h/box.height,area=box.width*box.height;
var entry={index:index+1,widthMm:w,heightMm:h,fonts:[],margins:{}},fonts={};if(page.getAttribute('data-blockout-page-id'))entry.blockoutPageId=page.getAttribute('data-blockout-page-id');
function edge(side,value,item){var current=entry.margins[side];if(!current||value<current.mm){var m={mm:Math.round(value*10)/10,kind:item.kind,text:item.text};if(item.blockId)m.blockId=item.blockId;entry.margins[side]=m;}}
function content(rect,el,item){var r=clip(rect,el,page);if(!r)return;edge('left',(r.left-box.left)*mx,item);edge('right',(box.right-r.right)*mx,item);
if(item.kind!=='header-footer'){edge('top',(r.top-box.top)*my,item);edge('bottom',(box.bottom-r.bottom)*my,item);}}
var walker=document.createTreeWalker(page,NodeFilter.SHOW_TEXT,null,false),node;
while((node=walker.nextNode())){if(!/\S/.test(node.nodeValue))continue;var el=node.parentElement;if(!el||background(el,page))continue;
var range=document.createRange();range.selectNodeContents(node);var rects=range.getClientRects();if(!rects.length)continue;
var style=getComputedStyle(el),scale=1;if(el.namespaceURI==='http://www.w3.org/2000/svg'&&el.getScreenCTM){var m=el.getScreenCTM();if(m)scale=Math.sqrt(m.a*m.a+m.b*m.b);}
var pt=Math.round(parseFloat(style.fontSize)*scale*mx/MM*0.75*10)/10,family=style.fontFamily.split(',')[0].replace(/["']/g,'').replace(/^\s+|\s+$/g,'');
var recurring=!!(el.closest&&el.closest(HF)),text=snippet(node.nodeValue),id=block(el),key=pt+'|'+family+'|'+recurring;
if(!fonts[key]){fonts[key]={pt:pt,family:family,chars:0,text:text,recurring:recurring};if(id)fonts[key].blockId=id;}fonts[key].chars+=node.nodeValue.replace(/\s/g,'').length;
for(var i=0;i<rects.length;i++)if(rects[i].width>0&&rects[i].height>0)content(rects[i],el,{kind:recurring?'header-footer':'text',blockId:id,text:text});}
[].slice.call(page.querySelectorAll('*')).forEach(function(el){
var tag=el.tagName.toLowerCase(),media=/^(img|svg|canvas|video|iframe|object|embed|image)$/.test(tag),recurring=!!el.closest(HF);
if(recurring&&tag!=='image')return;if(tag==='svg'&&el.parentElement&&el.parentElement.closest('svg'))return;
var style=getComputedStyle(el);if(!media&&!boxed(style))return;
var rect=el.getBoundingClientRect();if(rect.width<=0||rect.height<=0||rect.width*rect.height>=0.8*area||background(el,page))return;
content(rect,el,{kind:recurring?'header-footer':media?'image':'box',blockId:block(el),text:snippet(el.innerText||el.textContent||el.getAttribute('alt'))});});
for(var key in fonts)entry.fonts.push(fonts[key]);entry.fonts.sort(function(a,b){return a.pt-b.pt;});out.pages.push(entry);});
return out;}
function report(value){var meta=document.createElement('meta');meta.setAttribute('name','md-layout-measure');meta.setAttribute('content',encodeURIComponent(JSON.stringify(value)));(document.head||document.documentElement).appendChild(meta);}
function start(){setTimeout(function(){var done=function(){try{report(measure());}catch(e){report({error:String(e&&e.message||e)});}};
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(done,done);else done();},0);}
if(document.readyState==='complete')start();else addEventListener('load',start);
})();`;
