import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { withProjectHistoryMutation } from '../project-history-observer.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import type { IntakeAsset, IntakeAssetKind, IntakeDocument, IntakeTableData, ProjectIntakeCatalog, ProjectIntakeConfig, ProjectIntakeSettings, StartProjectIntakeRequest } from '@open-design/contracts';
import { createCommandInvocation } from '@open-design/platform';
import { createCodexCliInvocation } from '../codex-cli.js';
import { codexWorkerPermissionArgs } from '../runtimes/codex-permissions.js';
import { intakeCropPrompt, intakePagePrompt } from '../prompts/project-intake.js';
import { containedIntakePath, INTAKE_CATALOG_DIR, insideDirectory, intakeSettings, readIntakeConfig, resolveIntakeSource, validateIntakeConfig, writeIntakeConfig } from './project-intake-settings.js';
import { withIntakeVectors } from './project-intake-vectors.js';

const KINDS: IntakeAssetKind[] = ['image', 'drawing', 'chart', 'table'];
const worker = fileURLToPath(new URL('../../pdf-intake/worker.py', import.meta.url));
const bundledPython = path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const python = () => process.env.MELILLO_PYTHON || (existsSync(bundledPython) ? bundledPython : 'python');
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const objectSchema = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const kindSchema = { type: 'string', enum: KINDS };
const pageSchema = objectSchema({ summary: { type: 'string' }, regions: { type: 'array', items: objectSchema({ title: { type: 'string' }, kind: kindSchema, box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 } }) } });
const tableSchema = objectSchema({ headers: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
  rows: { type: 'array', items: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'null' }] } } },
  notes: { type: 'array', items: { type: 'string' } }, unreadableCells: { type: 'array', items: { type: 'string' } }, complete: { type: 'boolean' } });
const cropSchema = objectSchema({ title: { type: 'string' }, kind: kindSchema, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
  tableData: { anyOf: [tableSchema, { type: 'null' }] } });

/** Realpath containment also rejects symlinks that escape a project. */
export async function intakeProjectFile(root: string, relative: string): Promise<string> {
  if (!relative || path.isAbsolute(relative)) throw new Error('Expected a project-relative file path');
  const base = await realpath(root);
  const target = await realpath(path.resolve(root, relative));
  const difference = path.relative(base, target);
  if (!difference || difference.startsWith('..') || path.isAbsolute(difference)) throw new Error('File must stay inside the project');
  return target;
}

function execute(command: string, args: string[], cwd: string, input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const invocation = createCommandInvocation({ command, args, env: process.env });
    const child = spawn(invocation.command, invocation.args, { cwd, env: process.env, windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180_000);
    child.stdout.on('data', (data) => { if (stdout.length < 8_000_000) stdout += String(data); });
    child.stderr.on('data', (data) => { stderr = (stderr + String(data)).slice(-5000); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('Intake analysis timed out; retry this document.'));
      else if (code !== 0) reject(new Error(stderr.slice(-1000) || `Intake worker exited ${code}`));
      else resolve(stdout);
    });
    child.stdin.end(input);
  });
}

let activeAnalyses = 0;
const analysisWaiters: Array<() => void> = [];
async function limitedAnalysis<T>(action: () => Promise<T>): Promise<T> {
  if (activeAnalyses >= 3) await new Promise<void>((resolve) => analysisWaiters.push(resolve));
  else activeAnalyses += 1;
  try { return await action(); }
  finally {
    const next = analysisWaiters.shift();
    if (next) next(); else activeAnalyses -= 1;
  }
}

async function analyze(image: string, prompt: string, schema: unknown, directory: string, name: string): Promise<unknown> {
  return limitedAnalysis(async () => {
    const diagnostics = path.join(directory, '.analysis');
    await mkdir(diagnostics, { recursive: true });
    const schemaPath = path.join(diagnostics, `${name}.schema.json`);
    const resultPath = path.join(diagnostics, `${name}.analysis.json`);
    await writeFile(schemaPath, JSON.stringify(schema));
    const args = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', ...codexWorkerPermissionArgs(),
      '--model', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="low"', '-c', 'project_doc_max_bytes=0',
      '--disable', 'shell_tool', '-c', 'agents.enabled=false', '-c', 'web_search="disabled"',
      '--image', image, '--output-schema', schemaPath, '--output-last-message', resultPath, '-'];
    const invocation = createCodexCliInvocation(args, process.env);
    await execute(invocation.command, invocation.args, directory, prompt);
    return JSON.parse(await readFile(resultPath, 'utf8')) as unknown;
  });
}

interface RenderedPage { page: number; file: string; width: number; height: number; text: string }
interface PageRegions { summary: string; regions: Array<{ title: string; kind: IntakeAssetKind; box: [number, number, number, number] }> }
interface CropAnalysis { title: string; kind: IntakeAssetKind; description: string; tags: string[]; tableData: IntakeTableData | null }

export function validatedIntakeTable(value: unknown): IntakeTableData {
  const input = value as Partial<IntakeTableData> | null;
  const matrix = (rows: unknown): rows is Array<Array<string | null>> => Array.isArray(rows) && rows.length <= 200
    && rows.every((row) => Array.isArray(row) && row.length <= 40 && row.every((cell) => cell === null || (typeof cell === 'string' && cell.length <= 4000)));
  if (!input || !matrix(input.headers) || input.headers.some((row) => row.some((cell) => cell === null)) || !matrix(input.rows)
    || !Array.isArray(input.notes) || !input.notes.every((note) => typeof note === 'string' && note.length <= 4000)
    || !Array.isArray(input.unreadableCells) || !input.unreadableCells.every((cell) => typeof cell === 'string')
    || typeof input.complete !== 'boolean') throw new Error('Invalid structured table analysis');
  return input as IntakeTableData;
}

function validatedRegions(value: unknown): PageRegions['regions'] {
  const regions = (value as Partial<PageRegions> | null)?.regions;
  if (!Array.isArray(regions)) throw new Error('Invalid page analysis');
  return regions.slice(0, 12).map((region) => {
    const box = region.box;
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)
      || box[0]! < 0 || box[1]! < 0 || box[2]! > 1000 || box[3]! > 1000
      || box[2]! - box[0]! < 8 || box[3]! - box[1]! < 8) throw new Error('Invalid figure coordinates from image analysis');
    const kind = KINDS.includes(region.kind) ? region.kind : 'image';
    // Table boundaries often coincide with the last border/descender. Preserve a
    // small source margin instead of cutting those pixels at the detected edge.
    const padded = kind === 'table' ? [Math.max(0, box[0]! - 12), Math.max(0, box[1]! - 12), Math.min(1000, box[2]! + 12), Math.min(1000, box[3]! + 12)] : box;
    return { title: String(region.title).slice(0, 200), kind, box: padded as IntakeAsset['box'] };
  });
}

function cropNeedsRepair(asset: IntakeAsset): boolean {
  return asset.kind === 'table' && asset.tableData?.complete === false
    && (asset.analysis?.cropRepairAttempts ?? 0) < 1
    && /ritagli|crop|margine|tagliat/i.test(asset.tableData.notes.join(' '));
}

export class ProjectIntakeService {
  private catalogs = new Map<string, ProjectIntakeCatalog>();
  private loads = new Map<string, Promise<ProjectIntakeCatalog>>();
  private starts = new Map<string, Promise<unknown>>();
  private writes = new Map<string, Promise<void>>();
  private running = new Set<string>();
  private queued: Array<() => Promise<void>> = [];
  private activeDocuments = 0;
  async prepareHistoryRestore(root: string, _projectId?: string): Promise<void> {
    const canonical = await realpath(root);
    const sameRoot = (value: string) => {
      const normalize = (entry: string) => process.platform === 'win32' ? path.resolve(entry).toLowerCase() : path.resolve(entry);
      return normalize(value) === normalize(root) || normalize(value) === normalize(canonical);
    };
    const busy = () => [...this.running].some(key => sameRoot(key.slice(0, key.lastIndexOf(':'))));
    if (busy()) throw Object.assign(new Error('Wait for intake to finish before restoring project files'), { statusCode: 409 });
    if ([...this.starts.keys(), ...this.writes.keys(), ...this.loads.keys()].some(sameRoot)) throw Object.assign(new Error('Wait for intake saves to finish before restoring project files'), { statusCode: 409 });
    for (const key of this.catalogs.keys()) if (sameRoot(key)) this.catalogs.delete(key);
    for (const key of this.loads.keys()) if (sameRoot(key)) this.loads.delete(key);
  }
  private async outputDirectory(root: string, documentId?: string): Promise<string> {
    const config = await readIntakeConfig(root);
    const base = await containedIntakePath(root, config.outputDir, true);
    if (!documentId) return base;
    return containedIntakePath(root, path.join(config.outputDir, documentId), true);
  }
  settings(root: string): Promise<ProjectIntakeSettings> { return intakeSettings(root); }
  private serialize<T>(root: string, action: () => Promise<T>): Promise<T> {
    const next = (this.starts.get(root) ?? Promise.resolve()).catch(() => {}).then(action);
    this.starts.set(root, next);
    const clear = () => { if (this.starts.get(root) === next) this.starts.delete(root); };
    void next.then(clear, clear);
    return next;
  }
  configure(root: string, config: unknown): Promise<ProjectIntakeSettings> {
    return this.serialize(root, async () => {
      if ([...this.running].some((key) => key.startsWith(`${root}:`))) {
        const current = await validateIntakeConfig(root, await readIntakeConfig(root));
        const next = await validateIntakeConfig(root, config);
        const key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
        const nextSources = new Set(next.sourceDirs.map(key));
        const sameOutput = key(path.resolve(root, current.outputDir)) === key(path.resolve(root, next.outputDir));
        // Existing jobs already hold absolute source paths. Additional sources
        // are safe to discover, while moving output or withdrawing a source
        // during those jobs would change their in-flight configuration.
        if (!sameOutput || current.sourceDirs.some((source) => !nextSources.has(key(source)))) throw new Error('Wait for intake to finish before changing folders');
        return writeIntakeConfig(root, next);
      }
      return writeIntakeConfig(root, config);
    });
  }
  async catalog(root: string): Promise<ProjectIntakeCatalog> {
    return withIntakeVectors(root, await this.baseCatalog(root));
  }
  private async baseCatalog(root: string): Promise<ProjectIntakeCatalog> {
    const cached = this.catalogs.get(root);
    if (cached) return cached;
    const pending = this.loads.get(root);
    if (pending) return pending;
    const loading = this.loadCatalog(root);
    this.loads.set(root, loading);
    try { return await loading; } finally { this.loads.delete(root); }
  }
  private async loadCatalog(root: string): Promise<ProjectIntakeCatalog> {
    let result: ProjectIntakeCatalog = { version: 1, documents: [], assets: [] };
    try {
      const catalogPath = await intakeProjectFile(root, 'intake-assets/catalog.json');
      result = JSON.parse(await readFile(catalogPath, 'utf8')) as ProjectIntakeCatalog;
      if (result.version !== 1 || !Array.isArray(result.documents) || !Array.isArray(result.assets)) throw new Error('Unsupported intake catalog');
      for (const document of result.documents) {
        document.indexedPages ??= [];
        if (document.status === 'processing' || document.status === 'queued') {
          document.status = 'failed'; document.error = 'Intake was interrupted. Retry to continue.';
        }
      }
      for (const asset of result.assets) if (asset.status === 'processing' || asset.status === 'queued') {
        asset.status = 'failed'; asset.error = 'Intake was interrupted. Retry the document.';
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    this.catalogs.set(root, result);
    return result;
  }
  private save(root: string, catalog: ProjectIntakeCatalog): Promise<void> {
    const bytes = JSON.stringify(catalog, null, 2);
    const pending = (this.writes.get(root) ?? Promise.resolve()).catch(() => {}).then(() => withProjectHistoryMutation({ root, paths: [`${INTAKE_CATALOG_DIR}/catalog.json`] }, async () => {
      const directory = await containedIntakePath(root, INTAKE_CATALOG_DIR, true);
      await writeFile(path.join(directory, 'catalog.json.tmp'), bytes);
      // Windows readers/antivirus can briefly hold the destination open. Keep the
      // last valid catalogue intact and retry atomic replacement, never unlink it.
      for (let attempt = 0; ; attempt += 1) {
        try { await rename(path.join(directory, 'catalog.json.tmp'), path.join(directory, 'catalog.json')); break; }
        catch (error) {
          if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
        }
      }
    }));
    this.writes.set(root, pending);
    const clear = () => { if (this.writes.get(root) === pending) this.writes.delete(root); };
    void pending.then(clear, clear);
    return pending;
  }
  async start(root: string, request: StartProjectIntakeRequest): Promise<ProjectIntakeCatalog> {
    return this.serialize(root, () => this.startUnlocked(root, request));
  }
  private enqueue(action: () => Promise<void>) {
    this.queued.push(action);
    this.drain();
  }
  private drain() {
    while (this.activeDocuments < 2 && this.queued.length) {
      const next = this.queued.shift()!;
      this.activeDocuments += 1;
      void next().catch((error: unknown) => console.error('Project intake could not persist its result:', errorText(error)))
        .finally(() => { this.activeDocuments -= 1; this.drain(); });
    }
  }
  private async startUnlocked(root: string, request: StartProjectIntakeRequest): Promise<ProjectIntakeCatalog> {
    const catalog = await this.baseCatalog(root);
    const config = await validateIntakeConfig(root, await readIntakeConfig(root));
    const paths = request.paths ?? await this.discoverSources(root, config);
    // Discovery that finds no PDFs leaves nothing to acquire (a text-only folder),
    // which is not a failed launch. An explicit empty selection remains an error.
    if (!paths.length && !request.paths) return catalog;
    if (!paths.length) throw new Error('No PDFs found in the project or registered intake folders');
    if (paths.length > 500) throw new Error('Select at most 500 PDFs per intake');
    const jobs: Array<{ document: IntakeDocument; absolute: string }> = [];
    const verified: Array<{ relative: string; absolute: string; digest: string; sha256: string }> = [];
    for (const relative of [...new Set(paths)]) {
      if (!/\.pdf$/i.test(relative)) throw new Error('PDF documents are required');
      const absolute = await resolveIntakeSource(root, relative, config);
      const info = await stat(absolute);
      if (!info.isFile()) throw new Error('PDF input must be a file');
      const size = info.size;
      if (size > 200 * 1024 * 1024) throw new Error('PDF exceeds the 200 MB intake limit');
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(absolute)) hash.update(chunk);
      const sha256 = hash.digest('hex');
      verified.push({ relative, absolute, digest: sha256.slice(0, 24), sha256 });
    }
    for (const { relative, absolute, digest, sha256 } of verified) {
      let document = catalog.documents.find((item) => item.id === digest);
      const indexedPages = document?.indexedPages ?? [];
      if (this.running.has(`${root}:${digest}`)) continue;
      if (document?.status === 'ready' && !catalog.assets.some((asset) => asset.documentId === digest && cropNeedsRepair(asset)) && (request.pages
        ? request.pages.every((page) => indexedPages.includes(page))
        : indexedPages.length === document.pageCount)) continue;
      if (document?.status === 'failed' && !request.retry) continue;
      if (!document) {
        const sourcePath = insideDirectory(await realpath(root), absolute) ? path.relative(root, absolute).replaceAll('\\', '/') : absolute;
        document = { id: digest, sourcePath, name: path.basename(absolute), status: 'queued', pageCount: 0, completedPages: 0, indexedPages: [], updatedAt: new Date().toISOString() };
        catalog.documents.push(document);
      }
      document.status = 'queued'; delete document.error;
      document.sha256 = sha256;
      this.running.add(`${root}:${digest}`);
      jobs.push({ document, absolute });
    }
    await writeIntakeConfig(root, config);
    await this.save(root, catalog);
    for (const job of jobs) this.enqueue(() => this.process(root, catalog, job.document, job.absolute, request.pages)
      .catch(async (error: unknown) => { job.document.status = 'failed'; job.document.error = errorText(error); await this.save(root, catalog); })
      .finally(() => this.running.delete(`${root}:${job.document.id}`)));
    return catalog;
  }
  private async discoverSources(root: string, config: ProjectIntakeConfig): Promise<string[]> {
    const sources = [await realpath(root), ...config.sourceDirs];
    const excluded = [path.resolve(root, INTAKE_CATALOG_DIR), path.resolve(root, config.outputDir)];
    const paths = new Set<string>();
    for (const source of sources) {
      for (const file of await this.discover(source, excluded)) {
        paths.add(file);
        if (paths.size > 500) throw new Error('Too many PDFs; select a smaller set');
      }
    }
    return [...paths];
  }
  private async discover(root: string, excluded: string[], prefix = ''): Promise<string[]> {
    const results: string[] = [];
    for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const relative = path.join(prefix, entry.name);
      const absolute = path.join(root, relative);
      if (excluded.some((directory) => insideDirectory(directory, absolute))) continue;
      if (entry.isDirectory()) results.push(...await this.discover(root, excluded, relative));
      else if (/\.pdf$/i.test(entry.name)) results.push(absolute);
      if (results.length > 500) throw new Error('Too many PDFs; select a smaller set');
    }
    return results;
  }
  private async process(root: string, catalog: ProjectIntakeCatalog, document: IntakeDocument, source: string, selectedPages?: number[]): Promise<void> {
    const directory = await this.outputDirectory(root, document.id);
    const snapshot = path.join(directory, '.source.pdf');
    await copyFile(source, snapshot);
    const sourceSha256 = createHash('sha256').update(await readFile(snapshot)).digest('hex');
    if (document.sha256 && document.sha256 !== sourceSha256) throw new Error('Source changed before intake; rescan this document');
    document.sha256 = sourceSha256;
    source = snapshot;
    document.status = 'processing'; document.updatedAt = new Date().toISOString();
    await this.save(root, catalog);
    const render = JSON.parse(await execute(python(), [worker, 'render', '--input', source, '--output', directory,
      ...(selectedPages ? ['--pages', JSON.stringify(selectedPages)] : [])], root)) as { pageCount: number; pages: RenderedPage[] };
    document.pageCount = render.pageCount; document.completedPages = document.indexedPages.length;
    const pendingPages = render.pages.filter((page) => !document.indexedPages.includes(page.page)
      || catalog.assets.some((asset) => asset.documentId === document.id && asset.page === page.page && cropNeedsRepair(asset)));
    let nextPage = 0;
    const processPage = async (page: RenderedPage) => {
      const image = path.join(directory, page.file);
      const pageId = `${document.id}-p${page.page}`;
      let overview = catalog.assets.find((asset) => asset.id === pageId);
      if (!overview) {
        overview = { id: pageId, documentId: document.id, sourcePath: document.sourcePath, sourceName: document.name,
          page: page.page, box: [0, 0, 1000, 1000], imagePath: path.relative(root, image).replaceAll('\\', '/'),
          width: page.width, height: page.height, kind: 'page', title: `${document.name} · ${page.page}`,
          description: page.text.slice(0, 1000), tags: [], status: 'processing' };
        catalog.assets.push(overview);
      }
      overview.status = 'processing';
      await this.save(root, catalog);
      try {
        const pageResult = await analyze(image, intakePagePrompt(document.name, page.page, page.text), pageSchema, directory, `page-${page.page}`) as PageRegions;
        const regions = validatedRegions(pageResult);
        if (typeof pageResult.summary !== 'string') throw new Error('Invalid full-page summary');
        overview.description = pageResult.summary.slice(0, 4000);
        overview.analysis = { stage: 'page', sourceSha256, model: 'gpt-6.1-sol', effort: 'low', analyzedAt: new Date().toISOString() };
        for (let index = 0; index < regions.length; index += 1) {
          const region = regions[index]!;
          const id = `${pageId}-r${index + 1}`;
          if (catalog.assets.some((asset) => asset.id === id && asset.status === 'ready' && !cropNeedsRepair(asset))) continue;
          const imagePath = path.join(directory, `${id}.png`);
          const dimensions = JSON.parse(await execute(python(), [worker, 'crop', '--input', source, '--page', String(page.page), '--output', imagePath, '--box', JSON.stringify(region.box)], root)) as { width: number; height: number };
          let asset = catalog.assets.find((item) => item.id === id);
          if (!asset) {
            asset = { ...overview, ...dimensions, id, box: region.box, imagePath: path.relative(root, imagePath).replaceAll('\\', '/'), kind: region.kind, title: region.title, description: '', tags: [], status: 'processing' };
            catalog.assets.push(asset);
          }
          asset.box = region.box; asset.width = dimensions.width; asset.height = dimensions.height;
          asset.status = 'processing'; delete asset.error;
          await this.save(root, catalog);
          try {
            const result = await analyze(imagePath, intakeCropPrompt(), cropSchema, directory, id) as CropAnalysis;
            if (!result || typeof result.description !== 'string' || !Array.isArray(result.tags)) throw new Error('Invalid crop description');
            asset.title = String(result.title).slice(0, 200); asset.kind = KINDS.includes(result.kind) ? result.kind : region.kind;
            asset.description = result.description.slice(0, 4000); asset.tags = result.tags.filter((tag) => typeof tag === 'string').slice(0, 16);
            asset.analysis = { stage: 'crop', parentPageId: pageId, sourceSha256, model: 'gpt-6.1-sol', effort: 'low',
              analyzedAt: new Date().toISOString(), parentAnalyzedAt: overview.analysis!.analyzedAt,
              cropRepairAttempts: (asset.analysis?.cropRepairAttempts ?? 0) + (cropNeedsRepair(asset) ? 1 : 0) };
            if (asset.kind === 'table') {
              asset.tableData = validatedIntakeTable(result.tableData);
              asset.tableDataPath = asset.imagePath.replace(/\.png$/i, '.table.json');
              await writeFile(await containedIntakePath(root, asset.tableDataPath), JSON.stringify(asset.tableData, null, 2));
            }
            asset.status = 'ready';
          } catch (error) { asset.status = 'failed'; asset.error = errorText(error); }
          await this.save(root, catalog);
        }
        overview.status = 'ready'; delete overview.error;
      } catch (error) { overview.status = 'failed'; overview.error = errorText(error); }
      if (!catalog.assets.some((asset) => asset.documentId === document.id && asset.page === page.page && asset.status === 'failed')) document.indexedPages = [...new Set([...document.indexedPages, page.page])].sort((a, b) => a - b);
      document.completedPages = document.indexedPages.length; document.updatedAt = new Date().toISOString();
      await this.save(root, catalog);
    };
    const pageWorkers = await Promise.allSettled(Array.from({ length: Math.min(2, pendingPages.length) }, async () => {
      while (nextPage < pendingPages.length) { const page = pendingPages[nextPage++]!; await processPage(page); }
    }));
    const failedWorker = pageWorkers.find((result) => result.status === 'rejected');
    if (failedWorker?.status === 'rejected') throw failedWorker.reason;
    document.status = catalog.assets.some((asset) => asset.documentId === document.id && asset.status === 'failed') ? 'failed' : 'ready';
    if (document.status === 'failed') document.error = 'Some pages or figures could not be analyzed. Retry the document.';
    await this.save(root, catalog);
  }
}
