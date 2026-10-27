import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AskProjectCustodianSchema, CustodianAnswerSchema, type CustodianAnswer, type CustodianDomain,
  type CustodianSource, type ProjectCustodianLedger, type ProjectMetadata, type IntakeAsset, type ProjectIntakeCatalog, type CustodianAssetDescriptor,
  type DocumentResearchSource } from '@open-design/contracts';
import { readDocumentResearchEvidence } from './document-research.js';
import { readDocumentSetup } from './document-setup.js';
import { containedIntakePath, insideDirectory, readIntakeConfig, resolveIntakeSource } from './project-intake-settings.js';
import { withIntakeVectors } from './project-intake-vectors.js';
import { CODEX_CUSTODIAN_READER, custodianReaders, type CustodianReader } from './custodian-readers.js';
import { validateLinkedDirs } from '../linked-dirs.js';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export interface CustodianQueryEvent {
  type: 'custodian-query-started' | 'custodian-query-completed' | 'custodian-query-failed';
  projectId?: string; domain: CustodianDomain; question: string; receiptId: string; snapshotRevision: string; error?: string;
}
interface OfferedEvidence { sourceId: string; title: string; pages: number[]; assetId?: string; text: string;
  basis?: 'native-page' | 'saved-finding'; textTruncated?: boolean;
  metadataTruncated?: boolean; tableDataComplete?: boolean; certainty?: 'observed' | 'inferred' | 'conflict' }
export interface CustodianWorkerRequest {
  domain: CustodianDomain; question: string; ledger: ProjectCustodianLedger;
  evidence: OfferedEvidence[]; images: string[]; imageAssetIds: string[]; runDir: string;
}
export type CustodianWorkerRunner = (request: CustodianWorkerRequest) => Promise<unknown>;
export interface CustodianNativePages { sourceSha256: string; pagesTotal: number; pages: Array<{ page: number; text: string; truncated: boolean }>; complete: boolean }
const NATIVE_TEXT = String.raw`
import sys,json,re,zipfile,html
f=sys.argv[1];sha=sys.argv[2];pages=[];total=1
if f.lower().endswith('.pdf'):
 import pypdfium2 as p
 d=p.PdfDocument(f);total=len(d);budget=2000000
 for i in range(min(total,600)):
  pg=d[i];tp=pg.get_textpage();text=tp.get_text_range();tp.close();pg.close()
  take=min(30000,budget);part=text[:take];budget-=len(part)
  pages.append({'page':i+1,'text':part,'truncated':len(text)>len(part)})
 d.close()
else:
 if f.lower().endswith('.docx'):
  with zipfile.ZipFile(f) as z:
   info=z.getinfo('word/document.xml')
   if info.file_size>2000000:raise ValueError('DOCX XML exceeds limit')
   text=html.unescape(re.sub('<[^>]+>',' ',re.sub(r'</w:p\s*>','\n',z.read(info).decode('utf-8','replace'))))
 else:text=open(f,encoding='utf-8',errors='replace').read(2000001)
 pages=[{'page':1,'text':text[:2000000],'truncated':len(text)>2000000}]
print(json.dumps({'sourceSha256':sha,'pagesTotal':total,'pages':pages,'complete':len(pages)==total and not any(p['truncated'] for p in pages)},ensure_ascii=False))
`;

/** A reader's answer is usable only when every citation and asset points at evidence it was offered. */
function answerWithinEvidence(raw: unknown, evidence: OfferedEvidence[]) {
  const parsed = CustodianAnswerSchema.parse(raw);
  for (const citation of parsed.citations) {
    const matches = evidence.filter((entry) => entry.sourceId === citation.sourceId && (citation.assetId === undefined || entry.assetId === citation.assetId));
    if (!matches.length || (citation.page !== undefined && !matches.some((entry) => entry.pages.includes(citation.page!)))) throw new Error('Custodian cited evidence outside the supplied snapshot');
    citation.title = matches[0]!.title;
  }
  for (const assetId of parsed.assetIds) if (!evidence.some((entry) => entry.assetId === assetId)) throw new Error('Custodian returned an asset outside the supplied snapshot');
  return parsed;
}

export class ProjectCustodianService {
  private running = 0;
  /** `runner` replaces every reader with one; `readers` replaces the Claude-then-Codex choice made per question. */
  constructor(private readonly options: { dataDir: string; runner?: CustodianWorkerRunner; readers?: () => Promise<CustodianReader[]>;
    nativeReader?: (source: DocumentResearchSource) => Promise<CustodianNativePages>;
    recordEvent?: (event: CustodianQueryEvent) => Promise<void> }) {
    if (!path.isAbsolute(options.dataDir)) throw new Error('Custodians require the resolved daemon data root');
  }
  private async catalog(root: string): Promise<ProjectIntakeCatalog> {
    try {
      const file = await containedIntakePath(root, 'intake-assets/catalog.json');
      if ((await stat(file)).size > 12_000_000) throw new Error('Image catalog exceeds limit');
      const value = JSON.parse(await readFile(file, 'utf8')) as ProjectIntakeCatalog;
      if (value.version !== 1 || !Array.isArray(value.documents) || !Array.isArray(value.assets)) throw new Error('Invalid image catalog');
      return await withIntakeVectors(root, value);
    } catch (error) { if (missing(error)) return { version: 1, documents: [], assets: [] }; throw error; }
  }
  private async nativePages(source: DocumentResearchSource): Promise<CustodianNativePages> {
    if (this.options.nativeReader) return this.options.nativeReader(source);
    const directory = path.join(this.options.dataDir, 'project-custodians', 'source-pages', source.sha256);
    const cache = path.join(directory, 'pages.json');
    try {
      if ((await stat(cache)).size > 16_000_000) throw new Error('Native text cache exceeds limit');
      const value = JSON.parse(await readFile(cache, 'utf8')) as CustodianNativePages;
      if (value.sourceSha256 !== source.sha256 || !Array.isArray(value.pages)
        || value.pages.some((page) => !Number.isInteger(page.page) || typeof page.text !== 'string' || typeof page.truncated !== 'boolean')) throw new Error('Invalid native text cache');
      return value;
    } catch (error) { if (!missing(error)) throw error; }
    const base = await realpath(source.root), file = await realpath(path.resolve(base, source.path));
    if (!insideDirectory(base, file)) throw new Error('Source escaped its authorized root');
    const bytes = await readFile(file);
    if (digest(bytes) !== source.sha256) throw new Error('Source changed before native text retrieval');
    await mkdir(directory, { recursive: true });
    const snapshot = path.join(directory, `${randomUUID()}${path.extname(source.path)}`);
    await writeFile(snapshot, bytes, { flag: 'wx' });
    try {
      const bundled = path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
      const python = process.env.MELILLO_PYTHON || (existsSync(bundled) ? bundled : 'python');
      const value = await new Promise<CustodianNativePages>((resolve, reject) => execFile(python, ['-X', 'utf8', '-c', NATIVE_TEXT, snapshot, source.sha256],
        { windowsHide: true, timeout: 30_000, maxBuffer: 16_000_000 }, (error, stdout) => {
          if (error) { reject(error); return; }
          try { resolve(JSON.parse(stdout)); } catch (parseError) { reject(parseError); }
        }));
      const temporary = path.join(directory, `${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(value), { flag: 'wx' }); await rename(temporary, cache);
      return value;
    } finally { await rm(snapshot, { force: true }); }
  }
  private async snapshotData(root: string, metadata?: ProjectMetadata | null, projectId?: string) {
    root = await realpath(root);
    const [run, catalog, setup] = await Promise.all([readDocumentResearchEvidence(this.options.dataDir, root, projectId),
      this.catalog(root), readDocumentSetup(root, metadata?.documentSetupIntent, projectId)]);
    const intakeConfig = await readIntakeConfig(root);
    const authorized = validateLinkedDirs([...(metadata?.linkedDirs ?? []), ...intakeConfig.sourceDirs.map((entry) => path.resolve(root, entry))]);
    const allowed = [root, ...('error' in authorized ? [] : authorized.dirs)];
    const sources: CustodianSource[] = [], sourceIds = new Map<string, string>(), gaps: string[] = [];
    for (const source of run?.sources ?? []) {
      let status: CustodianSource['status'] = 'current';
      try {
        const base = await realpath(source.root), file = await realpath(path.resolve(base, source.path));
        if (!allowed.some((entry) => insideDirectory(entry, base)) || !insideDirectory(base, file) || (await stat(file)).size > 100_000_000) status = 'unavailable';
        else if (digest(await readFile(file)) !== source.sha256) status = 'changed';
      } catch { status = 'unavailable'; }
      const document = catalog.documents.find((entry) => entry.id === source.sha256.slice(0, 24));
      if (document) sourceIds.set(document.id, source.id);
      const coverage = run?.coverage.sources.find((entry) => entry.sourceId === source.id);
      sources.push({ sourceId: source.id, title: source.title, path: source.path, sha256: source.sha256, pagesTotal: source.pagesTotal,
        textAnalyzedPages: coverage?.analyzedPages ?? [], visualIndexedPages: document?.indexedPages ?? [],
        assetIds: catalog.assets.filter((asset) => asset.documentId === document?.id).map((asset) => asset.id), status });
      if (status !== 'current') gaps.push(`${source.title}: source ${status}; saved evidence may be stale.`);
    }
    for (const document of catalog.documents) if (!sourceIds.has(document.id)) {
      const sourceId = `visual-${document.id}`; sourceIds.set(document.id, sourceId);
      let status: CustodianSource['status'] = 'unverified', sha256: string | undefined;
      try {
        const file = await resolveIntakeSource(root, document.sourcePath, intakeConfig);
        if ((await stat(file)).size <= 100_000_000) {
          sha256 = digest(await readFile(file));
          status = sha256.startsWith(document.id) ? 'current' : 'changed';
        } else status = 'unavailable';
      } catch { status = 'unavailable'; }
      sources.push({ sourceId, title: document.name, path: document.sourcePath, pagesTotal: document.pageCount,
        textAnalyzedPages: [], visualIndexedPages: document.indexedPages ?? [],
        assetIds: catalog.assets.filter((asset) => asset.documentId === document.id).map((asset) => asset.id), status, ...(sha256 ? { sha256 } : {}) });
      if (status !== 'current') gaps.push(`${document.name}: visual source ${status}.`);
    }
    if (!run) gaps.push('No text research evidence is available.');
    else gaps.push(...run.warnings.slice(0, 15));
    const imageConsent = setup?.intent.imageIntakeConsent === true && setup.intent.imageIntakeDecision !== 'declined';
    if (!imageConsent) gaps.push('Image inspection is blocked until project image consent is saved.');
    const incompleteTables = catalog.assets.filter((asset) => asset.status === 'ready' && asset.kind === 'table' && asset.tableData?.complete !== true);
    if (incompleteTables.length) gaps.push(`${incompleteTables.length} indexed tables have missing or incomplete structured transcriptions; visual intake is not complete cell verification.`);
    gaps.push('Visual indexed pages indicate intake coverage, not independent verification of every table cell or drawing detail.');
    const content = { sources, textStatus: run?.status ?? 'not-started', imagesStatus: catalog.documents.some((doc) => ['processing', 'queued'].includes(doc.status)) ? 'indexing' : catalog.documents.some((doc) => doc.status === 'failed') ? 'partial' : catalog.documents.length ? 'indexed' : 'not-started', imageConsent, gaps };
    const ledger: ProjectCustodianLedger = { version: 1, ...(projectId ? { projectId } : {}), ...content,
      snapshotRevision: digest(JSON.stringify({ content, run: run?.updatedAt, catalog })) };
    return { root, ledger, run, catalog, sourceIds };
  }
  async ledger(root: string, metadata?: ProjectMetadata | null, projectId?: string): Promise<ProjectCustodianLedger> {
    return (await this.snapshotData(root, metadata, projectId)).ledger;
  }
  async snapshot(root: string, metadata?: ProjectMetadata | null, projectId?: string) { return this.ledger(root, metadata, projectId); }
  /** Full cached native pages, without a model query or a research/indexing job. */
  async readNativeSourcePages(source: DocumentResearchSource): Promise<CustodianNativePages> { return this.nativePages(source); }
  async ask(root: string, input: unknown, metadata?: ProjectMetadata | null, projectId?: string): Promise<CustodianAnswer> {
    const request = AskProjectCustodianSchema.parse(input);
    if (this.running >= 2) throw new Error('Two custodian queries are already running; retry shortly');
    this.running += 1;
    try { return await this.query(root, request, metadata, projectId); } finally { this.running -= 1; }
  }
  private async query(root: string, request: ReturnType<typeof AskProjectCustodianSchema.parse>, metadata?: ProjectMetadata | null, projectId?: string): Promise<CustodianAnswer> {
    const snapshot = await this.snapshotData(root, metadata, projectId), { ledger, run, catalog, sourceIds } = snapshot;
    const receiptId = randomUUID(), runDir = path.join(this.options.dataDir, 'project-custodians', digest(`${snapshot.root}\0${projectId ?? ''}`).slice(0, 32), receiptId);
    await mkdir(runDir, { recursive: true });
    const event = { ...(projectId ? { projectId } : {}), domain: request.domain, question: request.question, receiptId, snapshotRevision: ledger.snapshotRevision };
    await this.options.recordEvent?.({ ...event, type: 'custodian-query-started' });
    try {
      const tokens = [...new Set(request.question.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])];
      const rank = (text: string) => tokens.reduce((score, token) => score + (text.toLocaleLowerCase().includes(token) ? 1 : 0), 0);
      const evidence: OfferedEvidence[] = [], images: string[] = [], imageAssetIds: string[] = [];
      let selectedAssets: IntakeAsset[] = [];
      if (request.domain === 'text') {
        const findings = [...(run?.findings ?? []), ...(run?.overview ?? [])];
        const pages: Array<{ source: DocumentResearchSource; page: number; text: string; truncated: boolean; score: number }> = [];
        for (const source of run?.sources ?? []) {
          if (ledger.sources.find((entry) => entry.sourceId === source.id)?.status !== 'current') continue;
          try {
            const native = await this.nativePages(source);
            if (!native.complete) ledger.gaps.push(`${source.title}: native text extraction is partial; global absence cannot be established.`);
            for (const page of native.pages) if (page.text.trim()) {
              const locatorBoost = findings.some((finding) => finding.sourceId === source.id && finding.pages.includes(page.page) && rank(finding.text) > 0) ? 1 : 0;
              pages.push({ source, ...page, score: rank(page.text) + locatorBoost });
            }
          } catch { ledger.gaps.push(`${source.title}: actual native pages unavailable; saved summaries cannot establish facts or absence.`); }
        }
        const selected = new Set<string>();
        let retained = 0;
        const include = (entry: typeof pages[number]) => {
          const key = `${entry.source.id}/${entry.page}`;
          if (selected.has(key) || selected.size >= 18 || retained >= 100_000) return;
          const text = entry.text.slice(0, Math.min(12_000, 100_000 - retained));
          selected.add(key); retained += text.length;
          evidence.push({ sourceId: entry.source.id, title: entry.source.title, pages: [entry.page], text,
            basis: 'native-page', textTruncated: entry.truncated || text.length < entry.text.length, certainty: 'observed' });
        };
        const ranked = [...pages].sort((a, b) => b.score - a.score);
        for (const entry of ranked.slice(0, Math.min(request.limit * 2, 12))) include(entry);
        for (const entry of ranked.slice(0, 6)) for (const neighbor of pages.filter((page) => page.source.id === entry.source.id && Math.abs(page.page - entry.page) === 1)) include(neighbor);
        if (pages.length > selected.size || evidence.some((entry) => entry.textTruncated)) ledger.gaps.push(`This answer uses ${selected.size} selected native pages out of ${pages.length} readable cached pages. Unoffered pages were not inspected by this query; do not infer missing requirements from this subset.`);
        evidence.sort((a, b) => ledger.sources.findIndex((source) => source.sourceId === a.sourceId) - ledger.sources.findIndex((source) => source.sourceId === b.sourceId) || a.pages[0]! - b.pages[0]!);
      } else if (ledger.imageConsent) {
        const wholePage = /\b(full[\s-]*page|whole[\s-]*page|entire[\s-]*page|pagina\s+intera|intera\s+pagina|pagine\s+intere|pagina\s+completa|(pagina|pagine|page|pages)\s+\d+)\b/i.test(request.question);
        selectedAssets = catalog.assets.filter((asset) => asset.status === 'ready' && (wholePage || asset.kind !== 'page'))
          .sort((a, b) => rank(JSON.stringify(b)) - rank(JSON.stringify(a))).slice(0, request.limit);
        // A mixed composition request must not spend every visual slot on similar photographs.
        const attachmentIds = new Set<string>(), seenKinds = new Set<string>();
        for (const asset of selectedAssets) {
          const kind = asset.kind === 'image' && /\b(map|mappa|catastal|catastale|planimetr|keymap|keyplan)/i.test(`${asset.title} ${asset.tags.join(' ')}`) ? 'map' : asset.kind;
          if (!seenKinds.has(kind) && attachmentIds.size < 6) { attachmentIds.add(asset.id); seenKinds.add(kind); }
        }
        for (const asset of selectedAssets) if (attachmentIds.size < 6) attachmentIds.add(asset.id);
        for (const asset of selectedAssets) {
          const sourceId = sourceIds.get(asset.documentId), source = ledger.sources.find((entry) => entry.sourceId === sourceId);
          if (!source || ['changed', 'unavailable'].includes(source.status)) continue;
          let image: string | undefined;
          if (attachmentIds.has(asset.id)) {
            try {
              const candidate = await containedIntakePath(snapshot.root, asset.imagePath), info = await stat(candidate);
              if (info.isFile() && info.size <= 8_000_000 && /\.(png|jpe?g|webp)$/i.test(candidate)) image = candidate;
            } catch { /* Missing crops remain explicit metadata-only evidence. */ }
          }
          const metadata = JSON.stringify({ title: asset.title, kind: asset.kind, description: asset.description, tags: asset.tags,
            tableData: asset.tableData, vectorPreference: asset.vectorPreference ? { reason: asset.vectorPreference.reason, available: asset.vectorPreference.available } : undefined,
            vectorVersions: asset.vectorVersions?.map((version) => ({ label: version.label })), visuallyAttached: !!image });
          evidence.push({ sourceId: source.sourceId, title: source.title, pages: [asset.page], assetId: asset.id,
            text: metadata.slice(0, 8000), metadataTruncated: metadata.length > 8000,
            ...(asset.kind === 'table' ? { tableDataComplete: metadata.length <= 8000 && asset.tableData?.complete === true } : {}) });
          if (image) { images.push(image); imageAssetIds.push(asset.id); }
        }
      }
      // The ledger retains source order even when relevant evidence is ranked for a bounded query.
      const worker = { domain: request.domain, question: request.question, ledger, evidence, images, imageAssetIds, runDir };
      const readers = this.options.runner ? [{ name: 'codex' as const, ...CODEX_CUSTODIAN_READER, run: this.options.runner }]
        : await (this.options.readers ?? (() => custodianReaders(this.options.dataDir, process.env)))();
      // A reader that fails, or answers outside the offered evidence, hands the question to the next one.
      const readerFallbacks: Array<{ reader: string; error: string }> = [];
      let parsed: ReturnType<typeof CustodianAnswerSchema.parse> | undefined, answeredBy: CustodianReader | undefined;
      if (!evidence.length) parsed = CustodianAnswerSchema.parse({
        answer: request.domain === 'images' && !ledger.imageConsent ? 'Consenti l’analisi delle immagini nelle impostazioni del progetto per consultarle.' : 'Non ho ancora evidenze aggiornate sufficienti per rispondere.',
        citations: [], assetIds: [], gaps: ['No current evidence was offered; run or complete the relevant project intake.'],
      });
      else for (const [index, reader] of readers.entries()) {
        try { parsed = answerWithinEvidence(await reader.run(worker), evidence); answeredBy = reader; break; }
        catch (error) {
          if (index === readers.length - 1) throw error;
          readerFallbacks.push({ reader: reader.name, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (!parsed) throw new Error('No custodian reader is available');
      const assets: CustodianAssetDescriptor[] = [];
      for (const id of parsed.assetIds) {
        const asset = selectedAssets.find((entry) => entry.id === id)!;
        try {
          const file = await containedIntakePath(snapshot.root, asset.imagePath);
          if (!(await stat(file)).isFile()) throw new Error('Crop unavailable');
        } catch { parsed.gaps.push(`${asset.title}: the crop file is unavailable for composition.`); continue; }
        let tableDataPath: string | undefined;
        let tableDataComplete = false;
        if (asset.tableDataPath) {
          try {
            const file = await containedIntakePath(snapshot.root, asset.tableDataPath);
            const info = await stat(file);
            if (info.isFile() && info.size <= 2_000_000) {
              const saved = JSON.parse(await readFile(file, 'utf8'));
              if (JSON.stringify(saved) !== JSON.stringify(asset.tableData)) throw new Error('Table sidecar differs from current catalog');
              tableDataPath = asset.tableDataPath;
              tableDataComplete = asset.tableData?.complete === true;
            }
          } catch { parsed.gaps.push(`${asset.title}: structured table file unavailable.`); }
        }
        const offered = evidence.find((entry) => entry.assetId === id)!;
        assets.push({ id, title: asset.title, kind: asset.kind, imagePath: asset.imagePath, width: asset.width, height: asset.height,
          page: asset.page, sourceName: asset.sourceName, metadataTruncated: offered.metadataTruncated === true,
          ...(tableDataPath ? { tableDataPath } : {}),
          ...(asset.kind === 'table' ? { tableDataComplete } : {}),
          ...(asset.vectorPreference?.available ? { preferredVector: { path: asset.vectorPreference.path, sha256: asset.vectorPreference.sha256, reason: asset.vectorPreference.reason } } : {}),
          ...(asset.vectorVersions?.length ? { vectorVersions: asset.vectorVersions } : {}) });
      }
      const result: CustodianAnswer = { ...parsed, gaps: [...new Set([...parsed.gaps, ...ledger.gaps])].slice(0, 30),
        domain: request.domain, receiptId, snapshotRevision: ledger.snapshotRevision, assets };
      const temporary = path.join(runDir, 'receipt.tmp');
      await writeFile(temporary, JSON.stringify({ version: 1, createdAt: new Date().toISOString(),
        reader: answeredBy?.name ?? null, requestedModel: answeredBy?.model ?? null, requestedEffort: answeredBy?.effort ?? null,
        ...(readerFallbacks.length ? { readerFallbacks } : {}), workerInvoked: evidence.length > 0,
        request, evidence, attachedAssetIds: imageAssetIds, ledger, result }, null, 2), { flag: 'wx' });
      await rename(temporary, path.join(runDir, 'receipt.json'));
      await this.options.recordEvent?.({ ...event, type: 'custodian-query-completed' });
      return result;
    } catch (error) {
      await this.options.recordEvent?.({ ...event, type: 'custodian-query-failed', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}
