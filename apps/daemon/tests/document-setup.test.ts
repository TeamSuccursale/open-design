import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { assertCanonicalXmlText, BlockoutDocumentSchema, DOCUMENT_SETUP_CONFIRMATION_FORM, type DocumentContextSource, type DocumentSetupIntent, type ProjectMetadata } from '@open-design/contracts';
import { confirmDocumentSetup as confirmDocumentSetupRaw, confirmedBlockoutDispatch, documentSetupRunGate, extractLayoutConstraints, loadDocumentSetupContext,
  prepareDocumentSetupContextFiles, readDocumentSetup, renderFrozenDocumentSetupContext,
  saveDocumentSetupIntent, scanDocumentSetupContext, type DocumentContextText } from '../src/services/document-setup.js';
import { readBlockoutWorkspace, saveBlockoutWorkspace } from '../src/services/blockout-workspaces.js';

const testEditorialSettings = [{ documentId: 'document-1', presentation: { version: 1 as const, status: 'confirmed' as const, name: 'Test document', header: false, footer: false, cover: false, pageNumbers: false, numberOnCover: null, coverCountsTowardPageLimit: null, coverCountsInNumbering: null, numberingStart: 1 } }];
const confirmDocumentSetup = (...args: Parameters<typeof confirmDocumentSetupRaw>) => confirmDocumentSetupRaw(args[0], { editorialSettings: testEditorialSettings, ...(args[1] as object) }, args[2], args[3]);

const directories: string[] = [];
async function folder() { const dir = await mkdtemp(path.join(tmpdir(), 'melillo-setup-')); directories.push(dir); return dir; }
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
const intent: DocumentSetupIntent = { kind: 'tender-offer', subtype: 'Offerta tecnica servizi di ingegneria', purpose: 'Presentare le esperienze', contextRoots: [], imageIntakeConsent: false, imageIntakeDecision: 'declined' };
const source = (id: string, excerpt: string): DocumentContextSource => ({ id, path: 'disciplinare.pdf', root: 'context', title: 'Disciplinare', page: 37, excerpt, readable: true, role: 'rules' });
const noDocuments = async (): Promise<DocumentContextText> => ({ pages: [], warnings: [], pagesRead: 0, pagesTotal: 0 });

describe('guided document setup', () => {
  it('routes pending header/footer preparation to its actual workspace in live and frozen context', async () => {
    const root = await folder();
    await saveDocumentSetupIntent(root, {
      ...intent,
      editorialSettings: [{
        documentId: 'document-1',
        pageTarget: 3,
        presentation: {
          ...testEditorialSettings[0]!.presentation,
          name: 'Relazione di prova',
          header: true,
          footer: true,
          pageNumbers: true,
        },
      }],
    });
    const live = await loadDocumentSetupContext(root);
    const [relative] = await prepareDocumentSetupContextFiles(root);
    const frozen = renderFrozenDocumentSetupContext([{
      mediaType: 'text/plain',
      content: await readFile(path.join(root, relative!)),
    }]);
    for (const context of [live, frozen]) {
      expect(context).toContain('HEADER/FOOTER DURING PREPARATION');
      expect(context).toContain('compose the actual graphic proposal for every such document');
      expect(context).toContain('The host opens the dedicated editor on the proposal when the turn ends');
      expect(context).toContain('Do not tell the engineer to open the editor to supply inputs, to switch to Design mode');
      expect(context).toContain('Do not generate blockouts, layouts or page graphics yet');
      expect(context).toContain('explicit graphic-preview approval and application');
    }
  });

  it('carries the name chosen at creation into preparation without reusing it for sibling outputs or replacing saved names', async () => {
    const root = await folder();
    await saveDocumentSetupIntent(root, { ...intent, documentName: 'Relazione descrittiva B' });
    const initial = await loadDocumentSetupContext(root);
    expect(initial).toContain('First document name already supplied at creation');
    expect(initial).toContain('"Relazione descrittiva B"');
    expect(initial).toContain('do not ask for it again');
    expect(initial).toContain('Additional outputs need their own names');
    expect((await loadDocumentSetupContext(root, undefined, undefined, 'document-1'))).toContain('Named output: Relazione descrittiva B');
    expect((await loadDocumentSetupContext(root, undefined, undefined, 'fascicolo-grafico'))).toContain('Named output: fascicolo-grafico');
    await saveDocumentSetupIntent(root, { editorialSettings: [
      { documentId: 'document-1', presentation: { ...testEditorialSettings[0]!.presentation, name: 'Relazione aggiornata' } },
      { documentId: 'fascicolo-grafico', presentation: { ...testEditorialSettings[0]!.presentation, name: 'Tavole A3' } },
    ] });
    expect(await loadDocumentSetupContext(root)).not.toContain('First document name already supplied at creation');
    expect((await loadDocumentSetupContext(root, undefined, undefined, 'document-1'))).toContain('Named output: Relazione aggiornata');
    expect((await loadDocumentSetupContext(root, undefined, undefined, 'fascicolo-grafico'))).toContain('Named output: Tavole A3');
  });

  it('requires explicit named editorial choices for a new confirmation without invalidating an old stored confirmation', async () => {
    const root = await folder();
    await saveDocumentSetupIntent(root, intent); await scanDocumentSetupContext(root, undefined, noDocuments);
    const input = { purpose: 'Relazione B', constraints: [], blockoutApproach: 'manual' };
    await expect(confirmDocumentSetupRaw(root, input)).rejects.toThrow('named documents');
    await expect(confirmDocumentSetupRaw(root, { ...input, editorialSettings: [{ documentId: 'report', presentation: { name: 'Relazione B' } }] })).rejects.toThrow('editorial choices');
    const current = await readDocumentSetup(root);
    await writeFile(path.join(root, '.melillodesign/document-setup.json'), JSON.stringify({ ...current, status: 'confirmed', confirmed: { ...input, confirmedAt: '2026-10-24T00:00:00Z' } }));
    expect((await readDocumentSetup(root))?.status).toBe('confirmed');
    expect((await readDocumentSetup(root))?.confirmed?.editorialSettings).toBeUndefined();
  });

  it('seeds separately named 8 A4 and 4 A3 outputs, with independent cover allowance and hidden numbering', async () => {
    const root = await folder();
    await saveDocumentSetupIntent(root, intent); await scanDocumentSetupContext(root, undefined, noDocuments);
    const constraints = (limit: number, paper: string, orientation: string) => [
      { id: 'limit', kind: 'page-limit', value: `Massimo ${limit} pagine`, status: 'confirmed', sourceIds: [] },
      { id: 'paper', kind: 'paper', value: paper, status: 'confirmed', sourceIds: [] },
      { id: 'orientation', kind: 'orientation', value: orientation, status: 'confirmed', sourceIds: [] },
    ];
    const editorialSettings = [
      { documentId: 'relazione-b', pageTarget: 8, constraints: constraints(8, 'A4', 'verticale'), presentation: { ...testEditorialSettings[0]!.presentation, name: 'Relazione descrittiva B', header: true, footer: true, cover: true, pageNumbers: true, numberOnCover: false, coverCountsTowardPageLimit: false, coverCountsInNumbering: true } },
      { documentId: 'fascicolo-b', pageTarget: 4, constraints: constraints(4, 'A3', 'orizzontale'), presentation: { ...testEditorialSettings[0]!.presentation, name: 'Fascicolo grafico B' } },
    ];
    const confirmed = await confirmDocumentSetupRaw(root, { purpose: 'Due elaborati B', constraints: [], blockoutApproach: 'manual', editorialSettings });
    const read = async (id: string) => BlockoutDocumentSchema.parse(JSON.parse(await readFile(path.join(root, `blockouts/${id}/.workspace.json`), 'utf8')));
    const report = await read('relazione-b'), graphics = await read('fascicolo-b');
    expect(report.variants[0]?.pages).toHaveLength(9);
    expect(report.variants[0]?.pages[0]).toMatchObject({ widthMm: 210, heightMm: 297, role: 'cover', countsTowardLimit: false });
    expect(report.pageBudget).toMatchObject({ limit: 8, target: 8 });
    expect(report.presentation).toMatchObject({ name: 'Relazione descrittiva B', numberOnCover: false, coverCountsInNumbering: true, coverCountsTowardPageLimit: false });
    expect(graphics.variants[0]?.pages).toHaveLength(4);
    expect(graphics.variants[0]?.pages[0]).toMatchObject({ widthMm: 420, heightMm: 297 });
    expect(graphics.pageBudget).toMatchObject({ limit: 4, target: 4 });
    expect(graphics.presentation?.cover).toBe(false);
    expect(confirmed.confirmed?.editorialSettings).toHaveLength(2);
    expect((await loadDocumentSetupContext(root))).toContain('coverCountsInNumbering');
    expect((await readFile(path.join(root, 'blockouts/.documents.json'), 'utf8'))).not.toContain('document-1');
    await saveDocumentSetupIntent(root, { editorialSettings: confirmed.intent.editorialSettings!.map((setting) => setting.documentId === 'relazione-b' ? { ...setting, presentation: { ...setting.presentation, header: false } } : setting) });
    expect((await readDocumentSetup(root))?.confirmed).toBeUndefined();
  });

  it('confirms distinct sourced page allowances per output instead of deriving one conflicting collection budget', async () => {
    const root = await folder(); await saveDocumentSetupIntent(root, intent);
    await writeFile(path.join(root, 'testo.txt'), 'Preparare otto pagine A4 verticali.');
    await writeFile(path.join(root, 'appunti.txt'), 'Quattro tavole A3 orizzontali.');
    const scan = await scanDocumentSetupContext(root);
    const reportSource = scan.scan.sources.find((entry) => entry.path === 'testo.txt')!.id;
    const graphicSource = scan.scan.sources.find((entry) => entry.path === 'appunti.txt')!.id;
    const pageRule = (id: string, value: string, sourceId: string) => ({ id, kind: 'page-limit' as const, value, status: 'confirmed' as const, sourceIds: [sourceId] });
    const reportRule = pageRule('report-limit', 'Relazione: esattamente 8 pagine (testo.txt, pagina logica 1).', reportSource);
    const graphicRule = pageRule('drawings-limit', 'Elaborato grafico: esattamente 4 tavole (appunti.txt, pagina logica 1).', graphicSource);
    const editorialSettings = [
      { documentId: 'report', presentation: { ...testEditorialSettings[0]!.presentation, name: 'Relazione', cover: true, numberOnCover: false, coverCountsTowardPageLimit: true, coverCountsInNumbering: false }, pageTarget: 8, constraints: [reportRule] },
      { documentId: 'drawings', presentation: { ...testEditorialSettings[0]!.presentation, name: 'Tavole' }, pageTarget: 4, constraints: [graphicRule,
        { id: 'paper', kind: 'paper' as const, value: 'A3', status: 'confirmed' as const, sourceIds: [graphicSource] },
        { id: 'orientation', kind: 'orientation' as const, value: 'orizzontale', status: 'confirmed' as const, sourceIds: [graphicSource] }] },
    ];
    const request = { purpose: 'Separate outputs', constraints: [reportRule, graphicRule], pageTarget: 8, blockoutApproach: 'agent', editorialSettings };
    await confirmDocumentSetupRaw(root, request);
    const report = BlockoutDocumentSchema.parse(JSON.parse(await readFile(path.join(root, 'blockouts/report/.workspace.json'), 'utf8')));
    const drawings = BlockoutDocumentSchema.parse(JSON.parse(await readFile(path.join(root, 'blockouts/drawings/.workspace.json'), 'utf8')));
    expect(report.pageBudget).toMatchObject({ mode: 'exact', limit: 8, target: 8, source: expect.stringContaining(reportSource) });
    expect(report.variants[0]!.pages).toHaveLength(8);
    expect(drawings.pageBudget).toMatchObject({ mode: 'exact', limit: 4, target: 4, source: expect.stringContaining(graphicSource) });
    expect(drawings.variants[0]!.pages).toHaveLength(4); expect(drawings.variants[0]!.pages[0]).toMatchObject({ widthMm: 420, heightMm: 297 });
    const invalid = { ...request, editorialSettings: editorialSettings.map((entry) => entry.documentId === 'drawings' ? { ...entry, pageTarget: 3 } : entry) };
    await expect(confirmDocumentSetupRaw(root, invalid)).rejects.toThrow('must match');
    const conflicting = { ...request, editorialSettings: editorialSettings.map((entry) => entry.documentId === 'drawings' ? { ...entry, constraints: [...entry.constraints, pageRule('other-limit', 'Esattamente 6 tavole', graphicSource)] } : entry) };
    await expect(confirmDocumentSetupRaw(root, conflicting)).rejects.toThrow('Resolve the source page allowance');
    const scoped = await loadDocumentSetupContext(root, undefined, undefined, 'drawings');
    expect(scoped).toContain('DOCUMENT-CONVERSATION SCOPE'); expect(scoped).toContain('Named output: Tavole');
    expect(scoped).toContain('esattamente 4 tavole'); expect(scoped).not.toContain('esattamente 8 pagine');
    expect(scoped).not.toContain('MULTI-DOCUMENT');
    const frozenFiles = await prepareDocumentSetupContextFiles(root, undefined, undefined, 'drawings');
    expect(frozenFiles).toHaveLength(1);
    expect(renderFrozenDocumentSetupContext([{ mediaType: 'text/plain', content: await readFile(path.join(root, frozenFiles[0]!)) }])).toContain('Named output: Tavole');
    report.approval = { variantId: report.activeVariantId, acceptedAt: '2026-10-24T06:00:00Z' };
    await saveBlockoutWorkspace(root, 'report', { document: report, baseRaw: (await readBlockoutWorkspace(root, 'report')).raw, startingPoint: true });
    expect(await documentSetupRunGate(root, undefined, undefined, 'design')).toBeNull();
    expect(await documentSetupRunGate(root, undefined, undefined, 'design', 'drawings')).toContain('Accetta esplicitamente');
  });

  it('leaves historical projects unchanged and gates explicit document starts until confirmation', async () => {
    const root = await folder();
    expect(await readDocumentSetup(root)).toBeNull();
    expect(await documentSetupRunGate(root)).toBeNull();
    const metadata: ProjectMetadata = { kind: 'other', documentSetupIntent: intent };
    expect((await readDocumentSetup(root, intent))?.workingDirectory).toBe(root);
    expect(await documentSetupRunGate(root, metadata)).toContain('Conferma');
    await saveDocumentSetupIntent(root, intent);
    expect(await documentSetupRunGate(root)).toContain('Conferma');
    await expect(confirmDocumentSetup(root, { purpose: 'Corrected purpose', constraints: [], blockoutApproach: 'manual' })).rejects.toThrow('quick context');
    const scan = await scanDocumentSetupContext(root, metadata, noDocuments);
    expect(scan.scan.warnings.join(' ')).toContain('Non sono stati trovati');
    expect(scan.scan.coverage).toContain('15 secondi');
    await confirmDocumentSetup(root, { purpose: 'Corrected purpose', constraints: [], blockoutApproach: 'manual' });
    expect(await documentSetupRunGate(root, metadata)).toBeNull();
    expect((await readDocumentSetup(root))?.confirmed?.purpose).toBe('Corrected purpose');
  });

  it('only scans explicitly authorized additional folders, preserving source files', async () => {
    const root = await folder(), extra = await folder();
    await writeFile(path.join(extra, 'disciplinare.txt'), 'Formato A3 orizzontale, massimo 8 pagine.');
    await expect(saveDocumentSetupIntent(root, { ...intent, contextRoots: [extra] })).rejects.toThrow('Register each extra folder');
    const metadata: ProjectMetadata = { kind: 'other', linkedDirs: [extra] };
    await saveDocumentSetupIntent(root, { ...intent, contextRoots: [extra] }, metadata);
    const scan = await scanDocumentSetupContext(root, metadata);
    expect(scan.scan.sources.some((item) => item.root === extra && item.path === 'disciplinare.txt')).toBe(true);
    expect(scan.scan.constraints.map((item) => item.kind)).toContain('paper');
    expect(await readFile(path.join(extra, 'disciplinare.txt'), 'utf8')).toBe('Formato A3 orizzontale, massimo 8 pagine.');
    await expect(scanDocumentSetupContext(root, { kind: 'other' })).rejects.toThrow('Register each extra folder');
  });

  it('isolates confirmation and intake consent for two projects using the same working folder', async () => {
    const root = await folder();
    const first = { ...intent, imageIntakeConsent: true, imageIntakeDecision: 'accepted' as const };
    const firstMetadata: ProjectMetadata = { kind: 'other', documentSetupIntent: first };
    await saveDocumentSetupIntent(root, first, firstMetadata, 'first-project');
    await scanDocumentSetupContext(root, firstMetadata, noDocuments, 'first-project');
    await confirmDocumentSetup(root, { purpose: 'First project confirmed', constraints: [], blockoutApproach: 'manual' }, firstMetadata, 'first-project');
    const second = { ...intent, kind: 'report' as const, subtype: 'Relazione strutturale', purpose: 'Second project purpose', imageIntakeConsent: false };
    const secondMetadata: ProjectMetadata = { kind: 'other', documentSetupIntent: second };
    const fresh = await readDocumentSetup(root, second, 'second-project');
    expect(fresh).toMatchObject({ projectId: 'second-project', status: 'draft', intent: { kind: 'report', imageIntakeConsent: false } });
    expect(fresh?.confirmed).toBeUndefined();
    expect(await documentSetupRunGate(root, secondMetadata, 'second-project')).toContain('Conferma');
    expect(await loadDocumentSetupContext(root, 'second-project')).toBe('');
    await saveDocumentSetupIntent(root, second, secondMetadata, 'second-project');
    expect((await readDocumentSetup(root, first, 'first-project'))?.confirmed?.purpose).toBe('First project confirmed');
    expect(await documentSetupRunGate(root, firstMetadata, 'first-project')).toBeNull();
    expect((await readDocumentSetup(root, second, 'second-project'))?.intent.imageIntakeConsent).toBe(false);
  });

  it('prioritizes rules and templates, keeps prior reports as references and reports unreadable text', async () => {
    const root = await folder();
    await writeFile(path.join(root, 'notes.txt'), 'notes');
    await writeFile(path.join(root, 'relazione-strutturale.pdf'), 'fixture');
    await writeFile(path.join(root, 'disciplinare.pdf'), 'fixture');
    await writeFile(path.join(root, 'modello.docx'), 'fixture');
    await saveDocumentSetupIntent(root, intent);
    const scan = await scanDocumentSetupContext(root, undefined, async (files) => {
      expect(path.basename(files[0]!)).toBe('disciplinare.pdf');
      expect(path.basename(files[1]!)).toBe('modello.docx');
      return { pages: [
        { file: files.find((file) => file.endsWith('disciplinare.pdf'))!, page: 37, excerpt: 'Massimo 8 pagine. Formato A3 orizzontale.', readable: true },
        { file: files.find((file) => file.endsWith('relazione-strutturale.pdf'))!, page: 1, excerpt: 'Arial 12', readable: true },
        { file: files.find((file) => file.endsWith('modello.docx'))!, page: 1, excerpt: 'Scansione senza testo', readable: false },
      ], warnings: ['Copertura parziale'], pagesRead: 40, pagesTotal: 70 };
    });
    expect(scan.scan.sources[0]).toMatchObject({ page: 37, role: 'rules', readable: true });
    expect(scan.scan.sources[1]?.role).toBe('reference');
    expect(scan.scan.constraints.every((item) => item.status === 'suggested')).toBe(true);
    expect(scan.scan.warnings.join(' ')).toContain('non hanno testo leggibile');
    expect(scan.scan.coverage).toContain('40 pagine lette su 70');
  });

  it('extracts graphical rules with provenance without treating unrelated numbers as a page limit', () => {
    const sources = [source('rule', 'Relazione: massimo 8 pagine, formato A3 orizzontale.\nCarattere Arial 11, margini 2 cm.'),
      source('technical', 'Campagna del 2025: 120 prove; 48 punti di indagine.')];
    const constraints = extractLayoutConstraints(sources);
    expect(constraints.filter((item) => item.kind === 'page-limit')).toHaveLength(1);
    expect(new Set(constraints.map((item) => item.kind))).toEqual(new Set(['page-limit', 'paper', 'orientation', 'typography', 'margins']));
    expect(constraints.every((item) => item.sourceIds.includes('rule'))).toBe(true);
    const conflicting = extractLayoutConstraints([source('first', 'Massimo 8 pagine in formato A4.'), source('second', 'Massimo 12 pagine in formato A3.')]);
    expect(conflicting.filter((item) => ['paper', 'page-limit'].includes(item.kind)).every((item) => item.status === 'conflict')).toBe(true);
  });

  it.skipIf(!existsSync(path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')))('reads a real searchable PDF rule on page 37 and reports a raster-only page', async () => {
    const root = await folder();
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let index = 0; index < 40; index += 1) {
      const page = pdf.addPage();
      if (index === 7) continue;
      page.drawText(index === 36 ? 'La relazione deve avere massimo 8 pagine. Formato A3 orizzontale.' : 'Contesto tecnico del progetto.', { x: 30, y: 700, font, size: 11 });
    }
    await writeFile(path.join(root, 'disciplinare.pdf'), await pdf.save());
    await saveDocumentSetupIntent(root, intent);
    const scan = await scanDocumentSetupContext(root);
    const rule = scan.scan.sources.find((item) => item.page === 37);
    expect(rule?.excerpt, JSON.stringify(scan.scan)).toContain('massimo 8 pagine');
    expect(scan.scan.constraints.find((item) => item.kind === 'page-limit')?.sourceIds).toContain(rule?.id);
    expect(scan.scan.sources.find((item) => item.page === 8)?.readable).toBe(false);
    expect(scan.scan.coverage).toContain('40 pagine lette su 40');
  });

  it.skipIf(!existsSync(path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')))('reads accented Italian and font Unicode ligatures through the real Windows PDF reader', async () => {
    const root = await folder();
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText('Qualità, città e xducia nell’oyerta tecnica. Formato A4, massimo 8 pagine.', { x: 30, y: 700, font, size: 11 });
    // Real tender PDFs can map a glyph to a ligature or an unusual Unicode
    // character through ToUnicode. Neither ﬁ nor ƫ can be written as cp1252.
    const mappings = Array.from({ length: 256 }, (_, code) => {
      const unicode = code === 0x78 ? 0xFB01 : code === 0x79 ? 0x01AB : code === 0x92 ? 0x2019 : code;
      return `<${code.toString(16).padStart(2, '0')}> <${unicode.toString(16).padStart(4, '0')}>`;
    });
    const mapping = ['/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /TenderUnicode def', '/CMapType 2 def', '1 begincodespacerange', '<00> <FF>', 'endcodespacerange',
      ...Array.from({ length: 3 }, (_, index) => { const group = mappings.slice(index * 100, (index + 1) * 100); return `${group.length} beginbfchar\n${group.join('\n')}\nendbfchar`; }),
      'endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end'].join('\n');
    await font.embed();
    const dictionary = pdf.context.lookup(font.ref, PDFDict);
    dictionary.set(PDFName.of('ToUnicode'), pdf.context.register(pdf.context.flateStream(mapping)));
    await writeFile(path.join(root, 'Disciplinare qualità.pdf'), await pdf.save());
    await saveDocumentSetupIntent(root, intent);
    const scan = await scanDocumentSetupContext(root);
    const evidence = scan.scan.sources.find((item) => item.readable);
    expect(evidence?.excerpt, JSON.stringify(scan.scan.warnings)).toContain('Qualità, città');
    // PDFium normalizes the ﬁ ligature to two readable letters.
    expect(evidence?.excerpt).toContain('fiducia');
    expect(evidence?.excerpt).toContain('oƫerta');
    expect(scan.scan.constraints.find((item) => item.kind === 'page-limit')?.sourceIds).toContain(evidence?.id);
    expect(scan.scan.warnings.join(' ')).not.toMatch(/UnicodeEncodeError|Traceback|charmap/);
  });

  it('persists corrected constraints, seeds confirmed A3 landscape/margins, and freezes private context', async () => {
    const root = await folder();
    await writeFile(path.join(root, 'disciplinare.txt'), 'Massimo 10 pagine, formato A3 orizzontale. Margini 2 cm. Modello allegato obbligatorio.');
    await saveDocumentSetupIntent(root, intent);
    const scan = await scanDocumentSetupContext(root);
    const constraints = scan.scan.constraints.map((entry) => entry.kind === 'page-limit' ? { ...entry, value: 'Massimo 8 pagine', status: 'suggested' as const } : entry);
    const setup = await confirmDocumentSetup(root, { purpose: 'Solo presentazione grafica delle esperienze', constraints, blockoutApproach: 'agent' });
    expect(setup.confirmed?.constraints.every((entry) => entry.status === 'confirmed')).toBe(true);
    const document = BlockoutDocumentSchema.parse(JSON.parse(await readFile(path.join(root, 'blockout/layout.json'), 'utf8')));
    expect(document.variants[0]?.pages[0]).toMatchObject({ widthMm: 420, heightMm: 297, safeMarginMm: 20 });
    expect(document.variants[0]?.pages[0]?.expectation).toContain('Massimo 8 pagine');
    const context = await loadDocumentSetupContext(root);
    expect(context).toContain('Solo presentazione grafica');
    expect(context).toContain('Massimo 8 pagine');
    expect(context).toContain('separate explicit structure-acceptance question');
    expect(context).toContain('Do not open, load, invoke, apply or delegate ANY gare-* skill');
    expect(context).toContain('impaginazione-elaborati-strutturali');
    expect(context).toContain('linguaggio-umano remains allowed');
    const [relative] = await prepareDocumentSetupContextFiles(root);
    expect(relative).toMatch(/^\.melillodesign\/context\/[a-f0-9]+\.txt$/);
    const frozen = await readFile(path.join(root, relative!));
    expect(renderFrozenDocumentSetupContext([{ mediaType: 'text/plain', content: frozen }])).toContain('confirmed-document-setup');
    expect(renderFrozenDocumentSetupContext([{ mediaType: 'text/plain', content: frozen }])).toContain('gare-regia-sessione');
    expect(renderFrozenDocumentSetupContext([{ mediaType: 'application/json', content: frozen }])).toBe('');
    const pageFile = JSON.parse(await readFile(path.join(root, 'blockouts/document-1/page-1.blockout.json'), 'utf8'));
    expect(pageFile.type).toBe('blockout-page');
    await writeFile(path.join(root, 'blockout/layout.json'), 'do not overwrite existing edits');
    await confirmDocumentSetup(root, { purpose: 'Reconfirmed', constraints, blockoutApproach: 'manual' });
    expect(await readFile(path.join(root, 'blockout/layout.json'), 'utf8')).toBe('do not overwrite existing edits');
  });

  it('rejects unresolved conflict and foreign source references', async () => {
    const root = await folder();
    await saveDocumentSetupIntent(root, intent);
    await scanDocumentSetupContext(root, undefined, noDocuments);
    const constraint = { id: 'paper', kind: 'paper', value: 'A3 or A4', status: 'conflict', sourceIds: [] };
    await expect(confirmDocumentSetup(root, { purpose: 'Report', constraints: [constraint], blockoutApproach: 'manual' })).rejects.toThrow('conflicting');
    await expect(confirmDocumentSetup(root, { purpose: 'Report', constraints: [{ ...constraint, status: 'confirmed', sourceIds: ['invented'] }], blockoutApproach: 'manual' })).rejects.toThrow('unknown source');
    expect(await loadDocumentSetupContext(root)).toContain('PREPARATION-ONLY CHAT');
  });

  it('seeds the explicit three-page A3 landscape target while retaining a four-page source ceiling and legacy default', async () => {
    for (const pageTarget of [undefined, 3]) {
      const root = await folder();
      await writeFile(path.join(root, 'disciplinare.txt'), 'Massimo 4 pagine. Formato A3 orizzontale.');
      await saveDocumentSetupIntent(root, intent);
      const scan = await scanDocumentSetupContext(root);
      const setup = await confirmDocumentSetup(root, { purpose: 'Elaborato grafico', constraints: scan.scan.constraints, blockoutApproach: 'manual', ...(pageTarget === undefined ? {} : { pageTarget }) });
      expect(setup.confirmed?.pageTarget).toBe(pageTarget);
      const document = BlockoutDocumentSchema.parse(JSON.parse(await readFile(path.join(root, 'blockout/layout.json'), 'utf8')));
      expect(document.pageBudget).toMatchObject({ mode: 'maximum', limit: 4, target: pageTarget ?? 4, source: expect.stringContaining('disciplinare.txt') });
      expect(document.variants[0]!.pages).toHaveLength(pageTarget ?? 4);
      expect(document.variants[0]!.pages.every((page) => page.widthMm === 420 && page.heightMm === 297)).toBe(true);
      if (pageTarget !== undefined) {
        const context = await loadDocumentSetupContext(root);
        expect(context).toContain('Explicit engineer page target: 3');
        expect(context).toContain('never overwrite that choice with the maximum');
      }
    }
  });

  it('rejects over-cap and exact-mismatch targets before seeding or saving confirmation, including existing workspaces', async () => {
    for (const [rule, target] of [['Massimo 4 pagine', 5], ['Esattamente 4 pagine', 3]] as const) {
      const root = await folder();
      await saveDocumentSetupIntent(root, intent);
      await scanDocumentSetupContext(root, undefined, noDocuments);
      const constraints = [{ id: 'page-rule', kind: 'page-limit', value: rule, status: 'confirmed', sourceIds: [] }];
      await expect(confirmDocumentSetup(root, { purpose: 'Document', constraints, blockoutApproach: 'manual', pageTarget: target })).rejects.toThrow(/cannot exceed|must match/);
      expect((await readDocumentSetup(root))?.status).toBe('review');
      expect(existsSync(path.join(root, 'blockout/layout.json'))).toBe(false);
      await mkdir(path.join(root, 'blockout')); await writeFile(path.join(root, 'blockout/layout.json'), 'Preserve existing geometry');
      await expect(confirmDocumentSetup(root, { purpose: 'Document', constraints, blockoutApproach: 'manual', pageTarget: target })).rejects.toThrow(/cannot exceed|must match/);
      expect(await readFile(path.join(root, 'blockout/layout.json'), 'utf8')).toBe('Preserve existing geometry');
      expect((await readDocumentSetup(root))?.status).toBe('review');
    }
    const root = await folder();
    await saveDocumentSetupIntent(root, { ...intent, kind: 'free' }); await scanDocumentSetupContext(root, undefined, noDocuments);
    await confirmDocumentSetup(root, { purpose: 'Free document', constraints: [], blockoutApproach: 'manual', pageTarget: 3 });
    const free = BlockoutDocumentSchema.parse(JSON.parse(await readFile(path.join(root, 'blockout/layout.json'), 'utf8')));
    expect(free.pageBudget).toEqual({ mode: 'flexible', target: 3 });
    expect(free.variants[0]!.pages).toHaveLength(3);
  });

  it('keeps preset-specific intake answers in the private confirmed context as supplied data', async () => {
    const root = await folder();
    await saveDocumentSetupIntent(root, { ...intent, intakeAnswers: {
      documentPreset: 'tender-experiences', materialState: 'organize', notes: 'Testi del tecnico pronti; immagini da collegare alle esperienze.',
    } });
    await scanDocumentSetupContext(root, undefined, noDocuments);
    await confirmDocumentSetup(root, { purpose: 'Presentazione grafica delle esperienze', constraints: [], blockoutApproach: 'manual' });
    const saved = await readDocumentSetup(root);
    expect(saved?.intent.intakeAnswers?.materialState).toBe('organize');
    const context = await loadDocumentSetupContext(root);
    expect(context).toContain('Selected document preset: tender-experiences');
    expect(context).toContain('User material state: organize');
    expect(context).toContain('Testi del tecnico pronti; immagini da collegare alle esperienze.');
    expect(context).toContain('not instructions to draft engineering content or tender arguments');
  });

  it('persists explicit image decisions and material state without discarding text review or confirmation', async () => {
    const root = await folder();
    await saveDocumentSetupIntent(root, intent);
    await scanDocumentSetupContext(root, undefined, noDocuments);
    const confirmed = await confirmDocumentSetup(root, { purpose: 'Graphic report', constraints: [], blockoutApproach: 'manual' });
    const changed = await saveDocumentSetupIntent(root, { imageIntakeConsent: true, imageIntakeDecision: 'accepted',
      intakeAnswers: { documentPreset: 'report', materialState: 'organize', notes: 'Figure da associare.' } });
    expect(changed.status).toBe('confirmed');
    expect(changed.scan).toEqual(confirmed.scan);
    expect(changed.confirmed).toEqual(confirmed.confirmed);
    const declined = await saveDocumentSetupIntent(root, { imageIntakeConsent: false, imageIntakeDecision: 'declined' });
    expect(declined.intent.imageIntakeConsent).toBe(false);
    expect(declined.intent.imageIntakeDecision).toBe('declined');
    expect(declined.scan).toEqual(confirmed.scan);
    expect((await readDocumentSetup(root))?.confirmed).toEqual(confirmed.confirmed);
  });

  it('allows preparation chat before confirmation while blocking Blockout/Design and unanswered image decisions', async () => {
    const root = await folder();
    const pending = { ...intent, imageIntakeDecision: undefined };
    await saveDocumentSetupIntent(root, pending);
    expect(await documentSetupRunGate(root, undefined, undefined, 'chat')).toBeNull();
    expect(await documentSetupRunGate(root, undefined, undefined, 'blockout')).toContain('Scegli');
    expect(await documentSetupRunGate(root, undefined, undefined, 'design')).not.toBeNull();
    const context = await loadDocumentSetupContext(root);
    expect(context).toContain('PREPARATION-ONLY CHAT');
    expect(context).toContain('not yet asked');
    expect(context).toContain('Do not generate blockouts, layouts or page graphics yet');
    await scanDocumentSetupContext(root, undefined, noDocuments);
    await expect(confirmDocumentSetup(root, { purpose: 'Document', constraints: [], blockoutApproach: 'agent' })).rejects.toThrow('whether to start image extraction');
    await saveDocumentSetupIntent(root, { imageIntakeConsent: false, imageIntakeDecision: 'declined' });
    expect(await documentSetupRunGate(root, undefined, undefined, 'blockout')).toContain('Conferma');
    await confirmDocumentSetup(root, { purpose: 'Document', constraints: [], blockoutApproach: 'manual' });
    expect(await documentSetupRunGate(root, undefined, undefined, 'blockout')).toBeNull();
    expect(await documentSetupRunGate(root, undefined, undefined, 'design')).toContain('Accetta');
    const layout = JSON.parse(await readFile(path.join(root, 'blockout/layout.json'), 'utf8'));
    layout.approval = { variantId: layout.activeVariantId, acceptedAt: new Date().toISOString() };
    await writeFile(path.join(root, 'blockout/layout.json'), JSON.stringify(layout));
    expect(await documentSetupRunGate(root, undefined, undefined, 'design')).toBeNull();
  });

  it('keeps characters XML 1.0 forbids out of the saved source text, so OD Next can carry it', async () => {
    // A tender PDF read on 27 Oct 2026 gave "DELL'OF￾FERTA"; OD Next refused the frozen context on every run.
    const root = await folder(); await writeFile(path.join(root, 'disciplinare.pdf'), 'pdf');
    const dirty = 'Schede grafiche - Formato A3 B CARATTERISTICHE METODOLOGICHE DELL’OF￾FERTA\f massimo 4 pagine';
    const reader = async (files: string[]): Promise<DocumentContextText> => ({ pages: [{ file: files[0]!, page: 37, excerpt: dirty, readable: true }], warnings: [], pagesRead: 1, pagesTotal: 1,
      documents: [{ file: files[0]!, text: dirty, pagesRead: 1, pagesTotal: 1, complete: true, truncated: false }] });
    await saveDocumentSetupIntent(root, intent);
    const scan = await scanDocumentSetupContext(root, null, reader);
    expect(scan.scan.sources[0]!.excerpt).toContain('DELL’OFFERTA');
    const saved = await readFile(path.join(root, scan.scan.textDocuments![0]!.textPath), 'utf8');
    expect(saved).toContain('DELL’OFFERTA');
    expect(saved).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/);
  });
  it('keeps already saved setups with a stray PDF character usable by OD Next', () => {
    const frozen = Buffer.from('<document-setup-reference>\nDELL’OF￾FERTA\f\n</document-setup-reference>');
    const rendered = renderFrozenDocumentSetupContext([{ mediaType: 'text/plain', content: frozen }]);
    expect(rendered).toContain('DELL’OFFERTA');
    expect(() => assertCanonicalXmlText(rendered, 'stable_request_context')).not.toThrow();
  });
  it('saves complete searchable TXT/DOCX text beyond short findings and freezes it privately without image intake', async () => {
    const root = await folder();
    const original = `Formato A4, massimo 8 pagine.\n${'Testo tecnico da conservare. '.repeat(80)}\nUna conclusione lontana dagli estratti di formattazione.`;
    await writeFile(path.join(root, 'relazione.txt'), original);
    const archive = new JSZip();
    archive.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Contenuto già scritto dall’ingegnere.</w:t></w:r></w:p><w:p><w:r><w:t>Formato A4, massimo 8 pagine.</w:t></w:r></w:p></w:body></w:document>');
    await writeFile(path.join(root, 'modello.docx'), await archive.generateAsync({ type: 'nodebuffer' }));
    await saveDocumentSetupIntent(root, intent);
    const scan = await scanDocumentSetupContext(root);
    expect(scan.scan.textDocuments).toHaveLength(2);
    const txt = scan.scan.textDocuments!.find((entry) => entry.sourcePath === 'relazione.txt')!;
    expect(txt).toMatchObject({ complete: true, truncated: false });
    expect(await readFile(path.join(root, txt.textPath), 'utf8')).toContain('Una conclusione lontana');
    const docx = scan.scan.textDocuments!.find((entry) => entry.sourcePath === 'modello.docx')!;
    expect(await readFile(path.join(root, docx.textPath), 'utf8')).toContain('Contenuto già scritto');
    expect(await prepareDocumentSetupContextFiles(root)).toContain(txt.textPath);
    expect(scan.intent.imageIntakeConsent).toBe(false);
    expect(scan.scan.coverage).toContain('Nessun OCR o estrazione immagini');
    expect(await readFile(path.join(root, 'relazione.txt'), 'utf8')).toBe(original);
  });

  it('keeps durable preparation and Blockout dispatch markers through answer edits and confirmation', async () => {
    const root = await folder();
    const marker = { requestId: 'prepare-same', dispatched: false, blockoutRequestId: 'blockout-same', blockoutDispatched: false };
    await saveDocumentSetupIntent(root, { ...intent, preparationConversation: marker });
    await scanDocumentSetupContext(root, undefined, noDocuments);
    const dispatched = await saveDocumentSetupIntent(root, { preparationConversation: { ...marker, dispatched: true } });
    expect(dispatched.scan.status).toBe('complete');
    await saveDocumentSetupIntent(root, { purpose: 'Purpose resolved in conversation', intakeAnswers: { documentPreset: 'tender', materialState: 'ready', notes: 'Testi pronti.' } });
    expect((await readDocumentSetup(root))?.intent.preparationConversation).toMatchObject({ requestId: 'prepare-same', dispatched: true, blockoutRequestId: 'blockout-same' });
    const context = await loadDocumentSetupContext(root);
    expect(context).toContain('"layout":"grouped"');
    expect(context).toContain('ONE STARTING FORM');
    expect(context).toContain('cite file/page evidence');
    expect(context).not.toContain('Ask ONE specific question per turn');
    expect(context).toContain('Do not present a static setup form');
    expect(context).toContain('name EACH selected document');
    expect(context).toContain('header yes/no, footer yes/no, cover yes/no and page numbering yes/no');
    expect(context).toContain('whether it counts toward its source page limit');
    expect(context).toContain('whether the cover advances the numbering sequence even when its number is hidden');
    expect(context).toContain('Pagine da impaginare');
    expect(context).toContain('a ceiling, not an exact requirement');
    expect(context).toContain('engineer may choose fewer');
    expect(context).toContain('Skip is not consent');
    expect(context).toContain('Keep unanswered editorial booleans null and presentation.status:"draft"');
    const [preparationFile] = await prepareDocumentSetupContextFiles(root);
    const frozenPreparation = renderFrozenDocumentSetupContext([{ mediaType: 'text/plain', content: await readFile(path.join(root, preparationFile!)) }]);
    expect(frozenPreparation).toContain('Pagine da impaginare');
    expect(frozenPreparation).toContain('Skip is not consent');
    expect(frozenPreparation).toContain('header yes/no, footer yes/no, cover yes/no and page numbering yes/no');
    expect(context).toContain('Then STOP this preparation turn');
    expect(context).toContain('& $env:OD_NODE_BIN $env:OD_BIN document-setup show');
    expect(context).toContain('Never edit preparationConversation dispatch markers');
    await confirmDocumentSetup(root, { purpose: 'Confirmed conversation brief', constraints: [], blockoutApproach: 'agent' });
    const confirmed = await saveDocumentSetupIntent(root, { preparationConversation: { ...marker, dispatched: true, blockoutDispatched: true } });
    expect(confirmed.status).toBe('confirmed');
    await saveDocumentSetupIntent(root, { imageIntakeConsent: true, imageIntakeDecision: 'accepted' });
    const stale = await saveDocumentSetupIntent(root, { preparationConversation: marker });
    expect(stale.intent.preparationConversation).toEqual({ ...marker, dispatched: true, blockoutDispatched: true });
    expect(stale.confirmed?.purpose).toBe('Confirmed conversation brief');
  });

  it('keeps complementary written and graphical requirements scoped and visible through the confirmed handoff', async () => {
    const root = await folder();
    const inventory = 'Elaborato descrittivo: massimo 8 pagine A4, Arial 11, interlinea 1,5. Elaborato grafico: massimo 4 pagine A3. Entrambi obbligatori; lavoriamo ora sul descrittivo, grafico rinviato.';
    await writeFile(path.join(root, 'disciplinare.pdf'), 'fixture');
    await saveDocumentSetupIntent(root, { ...intent, purpose: 'Elaborato descrittivo; elaborato grafico rinviato',
      intakeAnswers: { documentPreset: 'tender-offer', materialState: 'ready', notes: inventory } });
    const scan = await scanDocumentSetupContext(root, undefined, async (files) => ({
      pages: [{ file: files[0]!, page: 37, readable: true, excerpt: 'Elaborato descrittivo: massimo 8 pagine A4, Arial 11, interlinea 1,5.\nElaborato grafico: massimo 4 pagine A3.' }],
      warnings: [], pagesRead: 40, pagesTotal: 40,
    }));
    const pending = await loadDocumentSetupContext(root);
    expect(pending).toContain('inventory EVERY distinct required deliverable');
    expect(pending).toContain('complementary required outputs, not alternative formats');
    expect(pending).toContain('Bind every constraint to its named deliverable');
    expect(pending).toContain('must not be added into one uniform-format page count');
    expect(pending).toContain('seeds each selected named document independently');
    expect(pending).toContain('separate document briefs, output folders and Blockout editor documents');
    const descriptive = scan.scan.constraints.filter((entry) => entry.value.startsWith('Elaborato descrittivo:')).map((entry) => ({ ...entry, status: 'suggested' as const }));
    await confirmDocumentSetup(root, { purpose: 'Elaborato descrittivo A4; grafico A3 rinviato', constraints: descriptive, blockoutApproach: 'agent' });
    const confirmed = await loadDocumentSetupContext(root);
    expect(confirmed).toContain(inventory);
    expect(confirmed).toContain('Elaborato grafico: massimo 4 pagine A3');
    expect(confirmed).toContain('page 37');
    expect(confirmed).toContain('Never transfer a report’s font, line spacing, page cap or paper to graphical sheets');
    expect(confirmed).toContain('Do not generate outputs the engineer explicitly deferred');
    const document = BlockoutDocumentSchema.parse(JSON.parse(await readFile(path.join(root, 'blockout/layout.json'), 'utf8')));
    expect(document.variants[0]!.pages).toHaveLength(8);
    expect(document.variants[0]!.pages.every((page) => page.widthMm === 210 && page.heightMm === 297)).toBe(true);
    const [contextFile] = await prepareDocumentSetupContextFiles(root);
    const frozen = renderFrozenDocumentSetupContext([{ mediaType: 'text/plain', content: await readFile(path.join(root, contextFile!)) }]);
    expect(frozen).toContain('Elaborato grafico: massimo 4 pagine A3');
    expect(frozen).toContain('not alternative formats');
  });

  it('hands off all selected settings-confirmed outputs in the same run without treating the single seed as the scope limit', async () => {
    const root = await folder();
    const choices = 'Entrambi selezionati e confermati: relazione, 8 pagine A4 verticale; fascicolo grafico, 4 pagine A3 orizzontale. Tre proposte per ciascun elaborato. Nessun elaborato rinviato.';
    await saveDocumentSetupIntent(root, { ...intent, purpose: 'Relazione e fascicolo grafico',
      intakeAnswers: { documentPreset: 'tender-offer', materialState: 'ready', notes: choices } });
    await scanDocumentSetupContext(root, undefined, noDocuments);
    const constraints = [{ id: 'written-pages', kind: 'page-limit', value: 'Relazione: massimo 8 pagine A4 verticale', status: 'confirmed', sourceIds: [] }];
    await confirmDocumentSetup(root, { purpose: 'Relazione e fascicolo grafico confermati', constraints, blockoutApproach: 'agent', pageTarget: 8 });
    const context = await loadDocumentSetupContext(root);
    expect(context).toContain(choices);
    expect(context).toContain('empty initialization pages do not complete the structural proposals');
    expect(context).toContain('generate EVERY selected output whose settings the engineer has confirmed');
    expect(context).toContain('A second selected/confirmed output is remaining work in this same run, not a deferred brief');
    expect(context).toContain('Complete all selected, settings-confirmed outputs in this Blockout run');
    expect(context).toContain('blockout list/show/save --document <id>');
    expect(context).toContain('save registers the document in the shared catalog');
    expect(context).toContain('Do not stop after the first output with a promise');
    expect(context).toContain('Only the engineer’s explicit choice to postpone or exclude an output makes it deferred');
    expect(context).toContain('If a selected output still has unresolved settings, ask a focused grouped clarification');
    expect(context).not.toContain('Keep the other selected document recorded as pending');
    const [relative] = await prepareDocumentSetupContextFiles(root);
    const frozen = renderFrozenDocumentSetupContext([{ mediaType: 'text/plain', content: await readFile(path.join(root, relative!)) }]);
    expect(frozen).toContain(choices);
    expect(frozen).toContain('Complete all selected, settings-confirmed outputs in this Blockout run');
  });

  it('confirms exactly the saved two-document brief for the host when the engineer accepts it, without an agent turn copying it', async () => {
    const root = await folder();
    const presentation = (name: string) => ({ ...testEditorialSettings[0]!.presentation, name, footer: true, pageNumbers: true });
    const constraint = (id: string, kind: 'paper' | 'orientation', value: string) => ({ id, kind, value, status: 'confirmed' as const, sourceIds: [] });
    const report = [constraint('report-paper', 'paper', 'Relazione B: A4'), constraint('report-orientation', 'orientation', 'Relazione B: verticale')];
    const booklet = [constraint('booklet-paper', 'paper', 'Fascicolo grafico B: A3'), constraint('booklet-orientation', 'orientation', 'Fascicolo grafico B: orizzontale')];
    await saveDocumentSetupIntent(root, { ...intent, purpose: 'Due elaborati B con formati separati', editorialSettings: [
      { documentId: 'document-1', presentation: presentation('Relazione B'), constraints: report, pageTarget: 8 },
      { documentId: 'document-2', presentation: presentation('Fascicolo grafico B'), constraints: booklet, pageTarget: 4 },
    ] });
    await scanDocumentSetupContext(root, undefined, noDocuments);
    const confirmed = await confirmDocumentSetupRaw(root, { source: 'saved-brief', blockoutApproach: 'agent' });
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.confirmed).toMatchObject({ purpose: 'Due elaborati B con formati separati', blockoutApproach: 'agent', pageTarget: 8, constraints: report });
    expect(confirmed.confirmed?.editorialSettings?.map((setting) => [setting.documentId, setting.pageTarget, setting.constraints?.map((entry) => entry.id)]))
      .toEqual([['document-1', 8, ['report-paper', 'report-orientation']], ['document-2', 4, ['booklet-paper', 'booklet-orientation']]]);
    const pages = async (documentId: string) => (await readBlockoutWorkspace(root, documentId)).document!.variants[0]!.pages.map((page) => `${page.widthMm}x${page.heightMm}`);
    expect(await pages('document-1')).toEqual(Array(8).fill('210x297'));
    expect(await pages('document-2')).toEqual(Array(4).fill('420x297'));
  });

  it('refuses a saved-brief confirmation the agent never fully saved, leaving the answer for the agent to resolve', async () => {
    const root = await folder();
    await saveDocumentSetupIntent(root, { ...intent, purpose: 'Relazione B', editorialSettings: testEditorialSettings });
    await scanDocumentSetupContext(root, undefined, noDocuments);
    await expect(confirmDocumentSetupRaw(root, { source: 'saved-brief', blockoutApproach: 'agent' })).rejects.toThrow('constraints');
    await saveDocumentSetupIntent(root, { purpose: '', editorialSettings: [{ ...testEditorialSettings[0]!, constraints: [] }] });
    await expect(confirmDocumentSetupRaw(root, { source: 'saved-brief', blockoutApproach: 'agent' })).rejects.toThrow('purpose');
    expect((await readDocumentSetup(root))?.status).toBe('review');
    expect((await readBlockoutWorkspace(root, 'document-1')).document).toBeNull();
  });

  it('asks for the final confirmation through the host-owned form, saved first, in live and frozen preparation context', async () => {
    const root = await folder();
    await saveDocumentSetupIntent(root, intent);
    await scanDocumentSetupContext(root, undefined, noDocuments);
    const live = await loadDocumentSetupContext(root);
    const [file] = await prepareDocumentSetupContextFiles(root);
    const frozen = renderFrozenDocumentSetupContext([{ mediaType: 'text/plain', content: await readFile(path.join(root, file!)) }]);
    for (const context of [live, frozen]) {
      expect(context).toContain(`<question-form id="${DOCUMENT_SETUP_CONFIRMATION_FORM.id}"`);
      expect(context).toContain(`"id":"${DOCUMENT_SETUP_CONFIRMATION_FORM.confirmQuestionId}"`);
      expect(context).toContain(`"id":"${DOCUMENT_SETUP_CONFIRMATION_FORM.approachQuestionId}"`);
      expect(context).toContain('the host records the confirmation and starts the next step');
      expect(context).toContain('Before emitting it, save');
    }
  });

  it('recognizes only the host’s own dispatch of a confirmed agent Blockout as the confirmed-brief request', async () => {
    const root = await folder();
    await saveDocumentSetupIntent(root, { ...intent, preparationConversation: { requestId: 'prepare', dispatched: true, blockoutRequestId: 'blockout-once' } });
    await scanDocumentSetupContext(root, undefined, noDocuments);
    const request = { clientRequestId: 'blockout-once', sessionMode: 'blockout' };
    expect(await confirmedBlockoutDispatch(root, request)).toBe(false);
    await confirmDocumentSetup(root, { purpose: 'Relazione', constraints: [], blockoutApproach: 'agent' });
    expect(await confirmedBlockoutDispatch(root, request)).toBe(true);
    expect(await confirmedBlockoutDispatch(root, { ...request, clientRequestId: 'typed-by-the-engineer' })).toBe(false);
    expect(await confirmedBlockoutDispatch(root, { ...request, sessionMode: 'chat' })).toBe(false);
    const manual = await folder();
    await saveDocumentSetupIntent(manual, { ...intent, preparationConversation: { requestId: 'prepare', dispatched: true, blockoutRequestId: 'blockout-once' } });
    await scanDocumentSetupContext(manual, undefined, noDocuments);
    await confirmDocumentSetup(manual, { purpose: 'Relazione', constraints: [], blockoutApproach: 'manual' });
    expect(await confirmedBlockoutDispatch(manual, request)).toBe(false);
  });

  it('rejects a setup directory symlink escaping its project', async () => {
    const root = await folder(), external = await folder();
    await symlink(external, path.join(root, '.melillodesign'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(saveDocumentSetupIntent(root, intent)).rejects.toThrow('inside the project');
    await mkdir(path.join(external, 'untouched'));
    expect(await readDocumentSetup(external)).toBeNull();
  });
});
