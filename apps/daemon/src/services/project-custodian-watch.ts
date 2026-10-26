import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectMetadata } from '@open-design/contracts';
import { ProjectCustodianJournal } from './project-custodian-journal.js';

export interface CustodianManifestEntry { path: string; size: number; mtimeMs: number; hash: string; kind: 'document' | 'image' }
export interface CustodianManifest { entries: CustodianManifestEntry[]; gaps: string[] }
export interface CustodianWatchInput { projectId: string; root: string; metadata: ProjectMetadata; sourceRoots?: string[]; excludedRoots?: string[]; active: true }
export interface CustodianWorkRequest { projectId: string; root: string; metadata: ProjectMetadata; changedPaths: string[] }
export interface CustodianWorkResult { partial?: boolean; message?: string }
export interface CustodianWatchStatus {
  indexing: boolean; phase: 'idle' | 'checking' | 'text' | 'images' | 'partial' | 'failed';
  lastCheckedAt?: string; lastRevision?: string; queuedChanges: string[]; message: string; pendingDomains: ('text' | 'images')[];
}
interface WatchState {
  input: CustodianWatchInput; leaseUntil: number; manifest: CustodianManifestEntry[]; initialized: boolean;
  text: Set<string>; images: Set<string>; status: CustodianWatchStatus; checking?: Promise<void>; work?: Promise<void>;
  gaps: string[]; workGaps: Map<string, string>; awaitingImageConsent: boolean; loaded: boolean;
  completed: { text: Record<string, string>; images: Record<string, string> };
  retry: { text: { count: number; at: number }; images: { count: number; at: number } };
}
export interface ProjectCustodianWatchOptions {
  journal: ProjectCustodianJournal;
  enqueueText: (request: CustodianWorkRequest) => Promise<CustodianWorkResult | void>;
  enqueueImages: (request: CustodianWorkRequest) => Promise<CustodianWorkResult | void>;
  imageConsent: (root: string, projectId: string) => Promise<boolean>;
  now?: () => number; pollMs?: number; leaseMs?: number;
  scan?: (roots: string[], previous: CustodianManifestEntry[], excludedRoots?: string[]) => Promise<CustodianManifest>;
}
const DOCUMENTS = new Set(['.pdf', '.docx', '.txt', '.md']);
const IMAGES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff']);
const SKIP = new Set(['node_modules', 'intake-assets', 'generated', 'designs', 'blockout', 'output', 'exports', 'dist', 'build', 'coverage', 'artifacts', '__pycache__']);
const MAX_BYTES = 100 * 1024 * 1024;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1000);
const inside = (root: string, candidate: string) => { const relative = path.relative(root, candidate); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
function rootAllowed(root: string): boolean {
  const absolute = path.resolve(root);
  return path.isAbsolute(root) && absolute !== path.parse(absolute).root
    && !/(?:^|[\\/])(windows|program files(?: \(x86\))?|system volume information)(?:[\\/]|$)/i.test(absolute)
    && !/(?:^|[\\/])(?:programdata|appdata(?:[\\/](?:local|locallow|roaming))?(?:[\\/]temp)?)$/i.test(absolute);
}

/** Read only authorized roots, never follow links, and report every scan bound. */
export async function scanCustodianManifest(roots: string[], previous: CustodianManifestEntry[] = [], excludedRoots: string[] = []): Promise<CustodianManifest> {
  const entries: CustodianManifestEntry[] = [], gaps: string[] = [], seen = new Set<string>();
  const prior = new Map(previous.map((entry) => [entry.path, entry]));
  let visited = 0, bytesRead = 0;
  async function walk(directory: string, root: string, depth: number): Promise<void> {
    if (visited >= 600) { gaps.push('Scan entry limit reached (600); coverage is partial.'); return; }
    const stream = await opendir(directory);
    for await (const entry of stream) {
      visited += 1;
      if (visited > 600) { gaps.push('Scan entry limit reached (600); coverage is partial.'); break; }
      if (entry.name.startsWith('.') || SKIP.has(entry.name.toLowerCase()) || entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (excludedRoots.some((excluded) => inside(path.resolve(excluded), file))) continue;
      if (entry.isDirectory()) {
        if (depth >= 5) gaps.push(`Depth limit reached: ${file}`); else await walk(file, root, depth + 1);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase(); if (!DOCUMENTS.has(ext) && !IMAGES.has(ext)) continue;
      if (seen.has(file)) continue;
      try {
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || !inside(root, await realpath(file))) { gaps.push(`Skipped redirected source: ${file}`); continue; }
        if (info.size > MAX_BYTES) { gaps.push(`Source exceeds 100 MB: ${file}`); continue; }
        const old = prior.get(file); let hash = old?.hash;
        if (!old || old.size !== info.size || old.mtimeMs !== info.mtimeMs) {
          if (bytesRead + info.size > MAX_BYTES) { gaps.push(`Scan hashing budget reached (100 MB): ${file}`); continue; }
          const hasher = createHash('sha256'); let fileBytes = 0;
          for await (const chunk of createReadStream(file, { highWaterMark: 64 * 1024 })) {
            fileBytes += chunk.length; bytesRead += chunk.length;
            if (fileBytes > MAX_BYTES || bytesRead > MAX_BYTES) throw new Error('Source changed or exceeded hashing budget while reading');
            hasher.update(chunk);
          }
          const after = await lstat(file);
          if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.isSymbolicLink()) throw new Error('Source changed during scan; retry next check');
          hash = hasher.digest('hex');
        }
        seen.add(file); entries.push({ path: file, size: info.size, mtimeMs: info.mtimeMs, hash: hash!, kind: DOCUMENTS.has(ext) ? 'document' : 'image' });
      } catch (error) { gaps.push(`${file}: ${errorText(error)}`); }
    }
  }
  for (const selected of [...new Set(roots)]) {
    if (!rootAllowed(selected)) { gaps.push(`Disallowed source root: ${selected}`); continue; }
    try {
      const info = await lstat(selected); const canonical = await realpath(selected);
      if (info.isSymbolicLink() || !info.isDirectory() || path.resolve(selected) !== canonical) { gaps.push(`Source root must be a canonical directory: ${selected}`); continue; }
      await walk(canonical, canonical, 0);
    } catch (error) { gaps.push(`${selected}: ${errorText(error)}`); }
  }
  return { entries: entries.sort((a, b) => a.path.localeCompare(b.path)), gaps: [...new Set(gaps)] };
}

/** Active UI leases gate new work; running jobs may finish after a lease expires. */
export class ProjectCustodianWatch {
  private readonly states = new Map<string, WatchState>();
  private readonly now: () => number; private readonly timer: ReturnType<typeof setInterval>;
  private closed = false;
  constructor(private readonly options: ProjectCustodianWatchOptions) {
    this.now = options.now ?? Date.now;
    this.timer = setInterval(() => {
      for (const [projectId, state] of this.states) if (this.active(state)) void this.check(projectId).catch(() => undefined);
    }, options.pollMs ?? 30_000); this.timer.unref();
  }
  private active(state: WatchState): boolean { return !this.closed && state.leaseUntil > this.now(); }
  async activate(input: CustodianWatchInput): Promise<CustodianWatchStatus> {
    if (this.closed) throw new Error('Custodian watcher is closed');
    let state = this.states.get(input.projectId);
    if (!state) {
      state = { input, leaseUntil: 0, manifest: [], initialized: false, text: new Set(), images: new Set(), gaps: [], workGaps: new Map(), awaitingImageConsent: false, loaded: false,
        completed: { text: {}, images: {} }, retry: { text: { count: 0, at: 0 }, images: { count: 0, at: 0 } },
        status: { indexing: false, phase: 'idle', queuedChanges: [], message: '', pendingDomains: [] } };
      this.states.set(input.projectId, state);
    }
    state.input = input; state.leaseUntil = this.now() + (this.options.leaseMs ?? 90_000);
    await this.check(input.projectId); return this.status(input.projectId);
  }
  status(projectId: string): CustodianWatchStatus {
    const state = this.states.get(projectId);
    if (!state) return { indexing: false, phase: 'idle', queuedChanges: [], pendingDomains: [], message: 'Project is inactive.' };
    return { ...state.status, queuedChanges: [...new Set([...state.text, ...state.images])], pendingDomains: [...(state.text.size ? ['text' as const] : []), ...(state.images.size ? ['images' as const] : [])] };
  }
  deactivate(projectId: string): void { const state = this.states.get(projectId); if (state) state.leaseUntil = 0; }
  close(): void { this.closed = true; clearInterval(this.timer); }
  async waitForIdle(projectId: string): Promise<void> {
    const state = this.states.get(projectId); if (!state) return;
    while (state.checking || state.work) { await state.checking; await state.work; }
  }
  async check(projectId: string): Promise<void> {
    const state = this.states.get(projectId); if (!state || !this.active(state)) return;
    if (state.checking) return state.checking;
    const checking = this.scan(state).catch(async (error) => {
      state.status = { ...state.status, phase: 'failed', indexing: !!state.work, message: errorText(error) };
      await this.options.journal.append(projectId, { domain: 'project', type: 'index-failed', summary: errorText(error) });
    });
    state.checking = checking;
    try { await checking; } finally { if (state.checking === checking) delete state.checking; }
  }
  private async scan(state: WatchState): Promise<void> {
    const { projectId, root, metadata } = state.input;
    state.status = { ...state.status, indexing: true, phase: 'checking', message: 'Checking project sources.' };
    if (!state.loaded) {
      const previous = (await this.options.journal.snapshots(projectId, 'project'))[0];
      // A manifest is an observation, never evidence that its indexes finished.
      if (previous && previous.index && typeof previous.index === 'object' && 'entries' in previous.index) {
        state.manifest = (previous.index as { entries: CustodianManifestEntry[] }).entries;
        const saved = previous.index as { completed?: WatchState['completed'] };
        if (saved.completed?.text && saved.completed.images) state.completed = saved.completed;
      }
      state.loaded = true;
    }
    const roots = [root, ...(state.input.sourceRoots ?? metadata.documentSetupIntent?.contextRoots ?? [])];
    const manifest = await (this.options.scan ?? scanCustodianManifest)(roots, state.manifest, state.input.excludedRoots);
    const prior = new Map(state.manifest.map((entry) => [entry.path, entry]));
    const changed = manifest.entries.filter((entry) => !state.initialized || prior.get(entry.path)?.hash !== entry.hash);
    // Missing entries only count as deletions after a complete scan.
    const removed = manifest.gaps.length ? [] : state.manifest.filter((entry) => !manifest.entries.some((current) => current.path === entry.path));
    // Retain previously known sources through an incomplete scan so a later
    // complete scan can still notice genuine removals and invalidate indexes.
    state.manifest = manifest.gaps.length
      ? [...new Map([...state.manifest, ...manifest.entries].map((entry) => [entry.path, entry])).values()].sort((a, b) => a.path.localeCompare(b.path))
      : manifest.entries;
    state.initialized = true; state.gaps = manifest.gaps;
    for (const source of changed) {
      if (source.kind === 'document' && state.completed.text[source.path] !== source.hash) state.text.add(source.path);
      if (!['.txt', '.md'].includes(path.extname(source.path).toLowerCase()) && state.completed.images[source.path] !== source.hash) state.images.add(source.path);
    }
    for (const source of removed) {
      if (source.kind === 'document') state.text.add(source.path);
      if (!['.txt', '.md'].includes(path.extname(source.path).toLowerCase())) state.images.add(source.path);
    }
    if (changed.length || removed.length) await this.options.journal.append(projectId, { domain: 'project', type: 'sources-changed',
      summary: `${changed.length} new or changed sources; ${removed.length} removed sources.`, sourceIds: [...changed, ...removed].map((entry) => entry.path) });
    const revision = await this.persist(state);
    state.status.lastRevision = revision.revision; state.status.lastCheckedAt = new Date(this.now()).toISOString();
    if (manifest.gaps.length) await this.options.journal.append(projectId, { domain: 'project', type: 'gap', summary: manifest.gaps.join('\n') });
    if (!state.work && this.active(state)) {
      const work = this.drain(state); state.work = work;
      void work.finally(() => { if (state.work === work) delete state.work; }).catch(() => undefined);
    }
  }
  private async persist(state: WatchState) {
    return this.options.journal.snapshot(state.input.projectId, { domain: 'project', sources: state.manifest.map((entry) => entry.path),
      index: { entries: state.manifest, gaps: state.gaps, completed: state.completed } });
  }
  private async drain(state: WatchState): Promise<void> {
    const { projectId, root } = state.input;
    try {
      while (this.active(state) && (state.text.size || state.images.size)) {
        const domain = state.text.size && state.retry.text.at <= this.now() ? 'text'
          : state.images.size && state.retry.images.at <= this.now() ? 'images' : null;
        if (!domain) break;
        if (domain === 'images' && !await this.options.imageConsent(root, projectId)) {
          if (!state.awaitingImageConsent) await this.options.journal.append(projectId, { domain, type: 'gap', summary: 'Image indexing is waiting for persisted user consent.', sourceIds: [...state.images] });
          state.awaitingImageConsent = true; break;
        }
        state.awaitingImageConsent = false;
        const queue = domain === 'text' ? state.text : state.images; const changedPaths = [...queue]; queue.clear();
        const capturedHashes = new Map(state.manifest.map((entry) => [entry.path, entry.hash]));
        state.status = { ...state.status, indexing: true, phase: domain, message: domain === 'text' ? 'Indexing source text.' : 'Analyzing pages and image crops.' };
        await this.options.journal.append(projectId, { domain, type: 'index-started', summary: `Indexing ${changedPaths.length} changed sources.`, sourceIds: changedPaths });
        try {
          const result = await (domain === 'text' ? this.options.enqueueText : this.options.enqueueImages)({ ...state.input, changedPaths });
          if (result?.partial) state.workGaps.set(domain, result.message ?? `${domain} coverage is partial.`); else state.workGaps.delete(domain);
          if (!result?.partial) for (const source of changedPaths) {
            const hash = capturedHashes.get(source); if (hash) state.completed[domain][source] = hash; else delete state.completed[domain][source];
          }
          state.retry[domain] = { count: 0, at: 0 };
          const revision = await this.persist(state); state.status.lastRevision = revision.revision;
          await this.options.journal.append(projectId, { domain, type: 'index-completed', summary: result?.message ?? `${domain} indexing job finished.`, sourceIds: changedPaths });
        } catch (error) {
          for (const file of changedPaths) queue.add(file);
          const count = state.retry[domain].count + 1;
          state.retry[domain] = { count, at: this.now() + Math.min(600_000, 30_000 * 2 ** Math.min(count - 1, 5)) };
          throw error;
        }
      }
      const partial = state.gaps.length > 0 || state.workGaps.size > 0 || state.text.size > 0 || state.images.size > 0;
      state.status = { ...state.status, indexing: false, phase: partial ? 'partial' : 'idle', message: state.awaitingImageConsent ? 'Text checked; image indexing is waiting for consent.' : partial ? 'Some sources still need indexing or review.' : 'Source indexes are up to date.' };
    } catch (error) {
      state.status = { ...state.status, indexing: false, phase: 'failed', message: errorText(error) };
      await this.options.journal.append(projectId, { domain: 'project', type: 'index-failed', summary: errorText(error) });
    }
  }
}
