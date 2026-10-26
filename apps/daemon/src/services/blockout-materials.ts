import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { BlockoutMaterialInventorySchema, type BlockoutMaterialInventory, type BlockoutMaterialItem, type BlockoutMaterialSource,
  type DocumentResearchSource, type ProjectMetadata, type ProjectIntakeCatalog } from '@open-design/contracts';
import { ProjectCustodianService, type CustodianNativePages } from './project-custodians.js';
import type { ProjectIntakeService } from './project-intake.js';
import { containedIntakePath, insideDirectory, readIntakeConfig } from './project-intake-settings.js';
import { readDocumentSetup } from './document-setup.js';
import { validateLinkedDirs } from '../linked-dirs.js';
import { withProjectHistoryMutation } from '../project-history-observer.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const stamp = () => new Date().toISOString();
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1500);
const INPUTS = /\.(?:pdf|docx|txt|md|png|jpe?g|webp)$/i;
const RASTER = /\.(?:png|jpe?g|webp)$/i;
const SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'blockout', 'blockouts', 'documents', 'designs', 'intake-assets']);
const MAX_FILE_BYTES = 100_000_000, MAX_TOTAL_BYTES = 200_000_000, MAX_ITEMS = 20_000;
interface Candidate { absolute: string; root: string; relative: string; sourcePath: string; signature: string; role: BlockoutMaterialSource['role'] }
interface Inputs { files: Candidate[]; catalog: ProjectIntakeCatalog; signature: string; gaps: string[] }
interface State { inventory: BlockoutMaterialInventory; signature: string; pending?: Promise<void> }
export interface BlockoutMaterialsOptions {
  dataDir: string; custodians?: Pick<ProjectCustodianService, 'readNativeSourcePages'>; intake?: Pick<ProjectIntakeService, 'catalog'>;
  nativeReader?: (source: DocumentResearchSource) => Promise<CustodianNativePages>;
  imageReader?: (file: string) => Promise<{ width: number; height: number }>;
}
function relativeState(projectId: string) { return `blockout/.context/materials-${hash(projectId).slice(0, 24)}.json`; }
/** Segments preserve every source character; offsets are UTF-16 code units within the original page. */
export function blockoutTextParagraphs(text: string): Array<{ text: string; offsetStart: number; offsetEnd: number }> {
  const result: Array<{ text: string; offsetStart: number; offsetEnd: number }> = [];
  let start = 0;
  for (const match of text.matchAll(/(?:\r?\n[\t ]*){2,}/g)) {
    const end = match.index! + match[0].length;
    result.push({ text: text.slice(start, end), offsetStart: start, offsetEnd: end }); start = end;
  }
  if (start < text.length) result.push({ text: text.slice(start), offsetStart: start, offsetEnd: text.length });
  return result;
}
async function actualImageSize(file: string): Promise<{ width: number; height: number }> {
  const bundled = path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const python = process.env.MELILLO_PYTHON || (existsSync(bundled) ? bundled : 'python');
  return new Promise((resolve, reject) => execFile(python, ['-X', 'utf8', '-c', 'from PIL import Image;import sys,json;im=Image.open(sys.argv[1]);w,h=im.size;im.verify();print(json.dumps({"width":w,"height":h}))', file],
    { windowsHide: true, timeout: 10_000, maxBuffer: 10_000 }, (error, output) => {
      if (error) { reject(error); return; }
      try { const value = JSON.parse(output); if (!(value.width > 0 && value.height > 0)) throw new Error('Invalid image dimensions'); resolve(value); } catch (failure) { reject(failure); }
    }));
}

/** One local extraction per project. This service never starts AI research or image intake. */
export class BlockoutMaterialsService {
  async prepareHistoryRestore(root: string, projectId?: string): Promise<void> {
    const canonical = await realpath(root);
    const matches = (key: string) => key.startsWith(`${canonical}\0`) && (projectId === undefined || key === `${canonical}\0${projectId}`);
    for (const [key, state] of this.states) if (matches(key) && state.pending) throw Object.assign(new Error('Wait for material inventory to finish before restoring project files'), { statusCode: 409 });
    for (const key of this.states.keys()) if (matches(key)) this.states.delete(key);
  }
  private readonly states = new Map<string, State>();
  private readonly custodians: Pick<ProjectCustodianService, 'readNativeSourcePages'>;
  private readonly intake: Pick<ProjectIntakeService, 'catalog'>;
  constructor(private readonly options: BlockoutMaterialsOptions) {
    if (!path.isAbsolute(options.dataDir)) throw new Error('Materials require the resolved daemon data root');
    this.custodians = options.custodians ?? new ProjectCustodianService({ dataDir: options.dataDir });
    this.intake = options.intake ?? { catalog: async (root) => {
      try {
        const file = await containedIntakePath(root, 'intake-assets/catalog.json');
        if ((await stat(file)).size > 12_000_000) throw new Error('Image catalog exceeds byte limit');
        const value = JSON.parse(await readFile(file, 'utf8')) as ProjectIntakeCatalog;
        if (value.version !== 1 || !Array.isArray(value.documents) || !Array.isArray(value.assets)) throw new Error('Invalid image catalog');
        return value;
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, documents: [], assets: [] }; throw error; }
    } };
  }
  async read(root: string, projectId = 'project'): Promise<BlockoutMaterialInventory | null> {
    const canonical = await realpath(root), key = `${canonical}\0${projectId}`;
    if (this.states.has(key)) return this.states.get(key)!.inventory;
    try {
      const file = await containedIntakePath(canonical, relativeState(projectId));
      if ((await stat(file)).size > 40_000_000) throw new Error('Material inventory exceeds byte limit');
      const stored = JSON.parse(await readFile(file, 'utf8'));
      const inventory = BlockoutMaterialInventorySchema.parse(stored.inventory);
      if (inventory.projectId !== projectId) throw new Error('Material inventory project mismatch');
      this.states.set(key, { inventory, signature: String(stored.signature ?? '') }); return inventory;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async get(root: string, metadata?: ProjectMetadata | null, projectId = 'project'): Promise<BlockoutMaterialInventory> {
    return this.request(root, metadata, projectId, false);
  }
  async refresh(root: string, metadata?: ProjectMetadata | null, projectId = 'project'): Promise<BlockoutMaterialInventory> {
    return this.request(root, metadata, projectId, true);
  }
  private async request(root: string, metadata: ProjectMetadata | null | undefined, projectId: string, refresh: boolean) {
    root = await realpath(root); const key = `${root}\0${projectId}`;
    await this.read(root, projectId);
    const inputs = await this.inputs(root, metadata, projectId), old = this.states.get(key);
    if (old?.pending) {
      // Terminal readiness is durable before a caller can consume it.
      if (old.inventory.status !== 'preparing') await old.pending;
      return old.inventory;
    }
    if (!refresh && old?.signature === inputs.signature && !['preparing'].includes(old.inventory.status)) return old.inventory;
    const now = stamp();
    const inventory: BlockoutMaterialInventory = { version: 1, projectId, revision: hash(`preparing:${inputs.signature}`), status: 'preparing',
      sources: { processed: 0, total: inputs.files.length, entries: [] }, items: [], gaps: inputs.gaps, createdAt: old?.inventory.createdAt ?? now, updatedAt: now };
    const state: State = { inventory, signature: inputs.signature }; this.states.set(key, state);
    state.pending = this.build(root, metadata, projectId, inputs, state).catch(async (error) => {
      state.inventory = { ...state.inventory, revision: hash(`failed:${inputs.signature}:${errorText(error)}`), status: 'failed', gaps: [...state.inventory.gaps, errorText(error)].slice(0, 200), updatedAt: stamp() };
      try { await this.persist(root, projectId, state); }
      catch (writeError) { state.inventory.gaps = [...state.inventory.gaps, `Inventory could not be persisted: ${errorText(writeError)}`].slice(0, 200); }
    }).finally(() => { delete state.pending; });
    return state.inventory;
  }
  private async persist(root: string, projectId: string, state: State) {
    const relative = relativeState(projectId);
    await containedIntakePath(root, 'blockout/.context', true);
    const file = await containedIntakePath(root, relative), temporary = await containedIntakePath(root, `${relative}.${randomUUID()}.tmp`);
    const body = JSON.stringify({ inventory: BlockoutMaterialInventorySchema.parse(state.inventory), signature: state.signature });
    if (Buffer.byteLength(body) > 40_000_000) throw new Error('Material inventory exceeds byte limit');
    await withProjectHistoryMutation({ root, projectId, paths: [relative] }, async () => {
      await writeFile(temporary, body, { flag: 'wx' }); await rename(temporary, file);
    });
  }
  private async inputs(root: string, metadata: ProjectMetadata | null | undefined, projectId: string): Promise<Inputs> {
    const config = await readIntakeConfig(root), gaps: string[] = [], files: Candidate[] = [];
    const requested = [...(metadata?.linkedDirs ?? []), ...config.sourceDirs.map((entry) => path.resolve(root, entry))];
    const validated = validateLinkedDirs(requested); if ('error' in validated) gaps.push(`Additional source unavailable: ${validated.error}`);
    const roots = [...new Set([root, ...('dirs' in validated ? validated.dirs ?? [] : [])])];
    const setup = await readDocumentSetup(root, metadata?.documentSetupIntent, projectId);
    let visited = 0, totalBytes = 0;
    const seen = new Set<string>();
    const walk = async (base: string, directory: string, depth: number): Promise<void> => {
      if (depth > 6 || visited >= 1500 || files.length >= 60) { gaps.push('Source discovery limited to 60 files, 1500 entries and 6 folder levels; remaining scope is not inventoried.'); return; }
      let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch { gaps.push(`Source folder unavailable: ${directory}`); return; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (++visited > 1500) break;
        if (entry.name.startsWith('.') || SKIP.has(entry.name) || entry.name === config.outputDir.split('/')[0]) continue;
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) { if (INPUTS.test(entry.name)) gaps.push(`Linked source is not inventoried: ${file}`); continue; }
        if (entry.isDirectory()) { await walk(base, file, depth + 1); continue; }
        if (!entry.isFile() || !INPUTS.test(entry.name) || /^(?:AGENTS|README|DESIGN|SKILL)\.md$/i.test(entry.name)) continue;
        try {
          const absolute = await realpath(file), info = await stat(absolute);
          if (!insideDirectory(base, absolute)) throw new Error('Source escaped its selected root');
          if (seen.has(absolute)) continue;
          if (info.size > MAX_FILE_BYTES || totalBytes + info.size > MAX_TOTAL_BYTES || files.length >= 60) { gaps.push(`Source exceeds inventory byte/file limits: ${file}`); continue; }
          seen.add(absolute); totalBytes += info.size;
          const relative = path.relative(base, absolute).replaceAll('\\', '/'), sourcePath = insideDirectory(root, absolute) ? path.relative(root, absolute).replaceAll('\\', '/') : absolute;
          const known = setup?.scan.sources.find((source) => source.root === base && source.path === relative)?.role;
          const role = known === 'template' ? 'rules' : known ?? (/\b(?:dip|disciplinare|capitolato|bando|template|modulo)\b/i.test(entry.name) ? 'rules' : 'content');
          files.push({ absolute, root: base, relative, sourcePath, signature: `${absolute}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`, role });
        } catch (error) { gaps.push(`${file}: ${errorText(error)}`); }
      }
    };
    for (const base of roots) await walk(base, base, 0);
    const catalog = JSON.parse(JSON.stringify(await this.intake.catalog(root))) as ProjectIntakeCatalog;
    const imageSignatures = await Promise.all(catalog.assets.slice(0, 1000).map(async (asset) => {
      try { const info = await stat(await containedIntakePath(root, asset.imagePath)); return `${asset.id}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`; }
      catch { return `${asset.id}:unavailable`; }
    }));
    if (catalog.assets.length > 1000) gaps.push('Gallery coverage limited to 1000 assets; remaining visuals are not inventoried.');
    return { files, catalog, gaps: [...new Set(gaps)].slice(0, 150), signature: hash(JSON.stringify({ files: files.map((file) => [file.signature, file.role]), catalog, imageSignatures, gaps })) };
  }
  private async build(root: string, metadata: ProjectMetadata | null | undefined, projectId: string, inputs: Inputs, state: State) {
    const items: BlockoutMaterialItem[] = [], sources: BlockoutMaterialSource[] = [], gaps = [...inputs.gaps];
    let waiting = false, textBytes = 0;
    for (const candidate of inputs.files) {
      const coverage: NonNullable<BlockoutMaterialSource['coverage']> = { text: RASTER.test(candidate.absolute) ? 'not-applicable' : 'partial', images: /\.pdf$/i.test(candidate.absolute) ? 'not-requested' : 'not-applicable' };
      const entry: BlockoutMaterialSource = { id: `source-${hash(candidate.absolute).slice(0, 24)}`, path: candidate.sourcePath, role: candidate.role, status: 'preparing', pagesProcessed: 0, pagesTotal: 0, gaps: [], coverage };
      sources.push(entry);
      try {
        const bytes = await readFile(candidate.absolute); if (bytes.length > MAX_FILE_BYTES) throw new Error('Source exceeds byte limit');
        const sourceHash = hash(bytes); entry.hash = sourceHash;
        if (RASTER.test(candidate.absolute)) {
          if (!insideDirectory(root, candidate.absolute)) throw new Error('Import this external image into the working folder before binding it');
          const dimensions = await (this.options.imageReader ?? actualImageSize)(candidate.absolute);
          items.push({ id: `material-${hash(`${candidate.absolute}:${sourceHash}`).slice(0, 32)}`, kind: 'image', label: path.basename(candidate.absolute), sourcePath: candidate.sourcePath, sourcePage: 1, sourceHash, sourceRole: entry.role, imagePath: candidate.sourcePath, ...dimensions });
          entry.pagesProcessed = entry.pagesTotal = 1; entry.status = 'ready';
          coverage.images = 'complete';
        } else {
          const source: DocumentResearchSource = { id: entry.id, root: candidate.root, path: candidate.relative, title: path.basename(candidate.absolute), sha256: sourceHash, pagesTotal: 0 };
          const native = await (this.options.nativeReader ? this.options.nativeReader(source) : this.custodians.readNativeSourcePages(source));
          if (native.sourceSha256 !== sourceHash) throw new Error('Native text cache is stale');
          entry.pagesTotal = native.pagesTotal;
          const pageNumbers = new Set<number>();
          let unreadable = 0;
          for (const page of native.pages) {
            if (!Number.isInteger(page.page) || page.page < 1 || page.page > native.pagesTotal || pageNumbers.has(page.page)) throw new Error('Invalid native page coverage');
            pageNumbers.add(page.page);
            if (page.truncated) entry.gaps.push(`Page ${page.page}: native text truncated; only the available exact prefix is usable.`);
            if (!page.text.trim()) { unreadable += 1; continue; }
            entry.pagesProcessed += 1;
            for (const paragraph of blockoutTextParagraphs(page.text)) {
              if (items.length >= MAX_ITEMS) throw new Error('Inventory item limit reached; remaining text was not inventoried');
              textBytes += Buffer.byteLength(paragraph.text);
              if (textBytes > 20_000_000) throw new Error('Inventory text exceeds 20 MB; remaining exact source text is not inventoried');
              items.push({ id: `material-${hash(`${sourceHash}:${candidate.absolute}:${page.page}:${paragraph.offsetStart}:${paragraph.offsetEnd}`).slice(0, 32)}`,
                kind: 'text', label: `${path.basename(candidate.absolute)} · p. ${page.page} · ${paragraph.offsetStart}`, sourcePath: candidate.sourcePath, sourcePage: page.page, sourceHash, sourceRole: entry.role, ...paragraph });
            }
          }
          if (!native.complete || pageNumbers.size !== native.pagesTotal) entry.gaps.push(`Native text is partial: ${pageNumbers.size}/${native.pagesTotal} pages; no OCR performed.`);
          if (unreadable) entry.gaps.push(`${unreadable} pages have no searchable native text; no OCR performed.`);
          coverage.text = native.complete && pageNumbers.size === native.pagesTotal && native.pagesTotal > 0 && !unreadable && !native.pages.some((page) => page.truncated) ? 'complete' : 'partial';
          const document = inputs.catalog.documents.find((doc) => path.resolve(root, doc.sourcePath) === candidate.absolute);
          if (document) {
            coverage.images = 'partial';
            if (!document.sha256 || document.sha256 !== sourceHash) entry.gaps.push('Image intake source is stale or unverified.');
            else {
              let imagesComplete = true;
              if (document.status !== 'ready' || document.pageCount !== native.pagesTotal || document.completedPages !== document.pageCount || new Set(document.indexedPages).size !== document.pageCount) {
                imagesComplete = false;
                if (['processing', 'queued'].includes(document.status)) waiting = true;
                entry.gaps.push(`Image intake ${document.status}: ${document.completedPages}/${document.pageCount} pages; pending scope is not complete.`);
              }
              const pendingAssets = inputs.catalog.assets.filter((asset) => asset.documentId === document.id && asset.kind !== 'page' && asset.status !== 'ready');
              if (pendingAssets.length) {
                imagesComplete = false;
                if (pendingAssets.some((asset) => ['queued', 'processing'].includes(asset.status))) waiting = true;
                entry.gaps.push(`${pendingAssets.length} visual assets are pending or failed; only the ready subset is present.`);
              }
              for (const asset of inputs.catalog.assets.slice(0, 1000).filter((asset) => asset.documentId === document.id && asset.status === 'ready' && asset.kind !== 'page')) {
                try {
                  if (items.length >= MAX_ITEMS) throw new Error('Inventory item limit reached');
                  if (path.resolve(root, asset.sourcePath) !== candidate.absolute || asset.analysis?.sourceSha256 !== sourceHash || !document.indexedPages.includes(asset.page)) throw new Error('Asset ownership/source revision is unverified');
                  const imageFile = await containedIntakePath(root, asset.imagePath), info = await stat(imageFile);
                  if (!info.isFile() || info.size > 30_000_000) throw new Error('Image exceeds byte limit or is not a file');
                  const dimensions = await (this.options.imageReader ?? actualImageSize)(imageFile);
                  const kind = asset.kind === 'table' ? 'table' : asset.kind === 'drawing' || asset.kind === 'chart' ? 'drawing' : 'image';
                  // Asset bytes, not just catalog labels, participate in revision and identity.
                  const assetHash = hash(await readFile(imageFile));
                  items.push({ id: `material-${hash(`${sourceHash}:${asset.id}:${assetHash}`).slice(0, 32)}`, kind, label: asset.title || path.basename(asset.imagePath), sourcePath: candidate.sourcePath,
                    sourcePage: asset.page, sourceHash, sourceRole: entry.role, imagePath: asset.imagePath, assetId: asset.id, ...dimensions });
                } catch (error) { imagesComplete = false; entry.gaps.push(`${asset.title || asset.id}: ${errorText(error)}`); }
              }
              coverage.images = imagesComplete ? 'complete' : 'partial';
            }
          }
          entry.status = entry.gaps.length ? (document && (['queued', 'processing'].includes(document.status) || inputs.catalog.assets.some((asset) => asset.documentId === document.id && ['queued', 'processing'].includes(asset.status))) ? 'waiting' : 'partial') : 'ready';
        }
      } catch (error) { entry.status = 'failed'; entry.gaps.push(errorText(error)); }
      gaps.push(...entry.gaps.map((gap) => `${path.basename(candidate.sourcePath)}: ${gap}`));
      state.inventory = { ...state.inventory, sources: { processed: sources.length, total: inputs.files.length, entries: sources }, items, gaps: gaps.slice(0, 200), updatedAt: stamp() };
    }
    if (!inputs.files.length) gaps.push('No original material files found. Add the source PDF, text or images to the working folder or a selected source folder.');
    else if (!items.length) gaps.push('No usable exact text or verified visual assets are available; provide readable material or complete the missing intake.');
    const fresh = await this.inputs(root, metadata, projectId);
    if (fresh.signature !== inputs.signature) { waiting = true; gaps.push('Sources or intake changed during preparation. Refresh the inventory before evaluating this snapshot.'); }
    const status: BlockoutMaterialInventory['status'] = waiting ? 'waiting' : gaps.length || !items.length ? 'needs-input' : 'ready';
    const content = { sources: { processed: sources.length, total: inputs.files.length, entries: sources }, items, gaps: [...new Set(gaps)].slice(0, 200), status };
    state.inventory = { ...state.inventory, ...content, revision: hash(JSON.stringify(content)), updatedAt: stamp() };
    await this.persist(root, projectId, state);
  }
}
