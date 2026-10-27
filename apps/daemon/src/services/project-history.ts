import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, opendir, readFile, realpath, rename, rmdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import { TextDecoder } from 'node:util';
import { PROJECT_HISTORY_POLICY, type ProjectHistoryCompareResponse, type ProjectHistoryEntry, type ProjectHistoryReason, type ProjectHistoryResponse, type ProjectHistoryRestoreResponse, type ProjectHistoryVersionResponse, type ProjectOrganizationReview } from '@open-design/contracts';
import { changedHistoryPaths, eligibleHistoryPath, ensureHistoryParents, historyTree, normalizeHistoryPath, PROJECT_HISTORY_EXCLUDED, ProjectHistoryError, safeHistoryTarget, scanHistoryFiles, withinHistoryRoot, type StoredHistoryFile } from './project-history-files.js';
import { ProjectHistoryGit } from './project-history-git.js';
import { reviewHistoryOrganization } from './project-history-organization.js';

export { eligibleHistoryPath, PROJECT_HISTORY_EXCLUDED, ProjectHistoryError } from './project-history-files.js';
interface HistoryManifest { version: 1; projectId: string; projectRoot: string; entry: Omit<ProjectHistoryEntry, 'id'>; files: StoredHistoryFile[]; tree: string }
interface HistoryState {
  version: 1; projectId: string; projectRoot: string; latestId: string | null; baselineId: string | null;
  lastCommitId: string | null; lastCommittedTree: string | null; lastGitCommit: string | null;
  activeWorkMs: number; organizationWorkMs: number; lastClockAt: number; lastActivityAt: number | null;
  lastCommitAt: number | null; agentRunning: boolean; changeSequence: number; reviewedSequence: number;
  summaries: string[]; organizationReview: ProjectOrganizationReview | null;
}
const json = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
const identity = (value: string) => /^[a-f0-9]{64}$/.test(value);
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;
const exclusions = () => [...PROJECT_HISTORY_EXCLUDED, 'Collegamenti simbolici e junction: esclusi senza seguirli'];

/** Local recovery history is independent of the project's own Git repository. */
export class ProjectHistoryStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;
  private root = '';
  private storeRoot = '';
  private git!: ProjectHistoryGit;
  private state!: HistoryState;
  private initialized = false;
  private closed = false;
  private lastError: string | null = null;
  private cache = new Map<string, { value: HistoryManifest; bytes: number }>();
  private cacheBytes = 0;
  constructor(private readonly options: { dataRoot: string; projectId: string; projectRoot: string; now?: () => number }) {
    if (!path.isAbsolute(options.dataRoot) || !path.isAbsolute(options.projectRoot) || !options.projectId || options.projectId.length > 240) throw new ProjectHistoryError('History requires an explicit data root, project root and project identity');
    this.now = options.now ?? Date.now;
  }

  private async exclusive<T>(callback: () => Promise<T>, clearError = true): Promise<T> {
    const next = this.queue.catch(() => undefined).then(async () => {
      if (this.closed) throw new ProjectHistoryError('Project history is closed', 503);
      try { const value = await callback(); if (clearError) this.lastError = null; return value; }
      catch (error) { if (!(error instanceof ProjectHistoryError) || error.statusCode >= 500) this.lastError = error instanceof Error ? error.message : String(error); throw error; }
    });
    this.queue = next; return next;
  }
  async initialize(): Promise<void> { return this.exclusive(() => this.initializeInternal(), false); }

  private async initializeInternal(): Promise<void> {
    if (this.initialized) return;
    if ((await lstat(this.options.projectRoot)).isSymbolicLink()) throw new ProjectHistoryError('History requires a real project directory');
    this.root = await realpath(this.options.projectRoot);
    if (!(await stat(this.root)).isDirectory()) throw new ProjectHistoryError('History requires a project directory');
    if (withinHistoryRoot(this.root, path.resolve(this.options.dataRoot))) throw new ProjectHistoryError('Private project history must stay outside the selected project');
    await mkdir(this.options.dataRoot, { recursive: true });
    const dataRoot = await realpath(this.options.dataRoot);
    const key = createHash('sha256').update(`${this.options.projectId}\0${this.root}`).digest('hex');
    this.storeRoot = path.join(dataRoot, 'project-history', key);
    if (withinHistoryRoot(this.root, this.storeRoot)) throw new ProjectHistoryError('Private project history must stay outside the selected project');
    await ensureHistoryParents(dataRoot, `project-history/${key}/state.json`);
    if (!withinHistoryRoot(dataRoot, await realpath(this.storeRoot))) throw new ProjectHistoryError('Private history path escapes the daemon data root');
    this.git = new ProjectHistoryGit(this.storeRoot);
    const gitPath = path.join(this.storeRoot, 'objects.git');
    try { if ((await lstat(gitPath)).isSymbolicLink()) throw new ProjectHistoryError('Private history Git directory cannot be linked'); } catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
    await this.git.initialize();
    const time = this.now();
    this.state = { version: 1, projectId: this.options.projectId, projectRoot: this.root, latestId: null, baselineId: null, lastCommitId: null, lastCommittedTree: null, lastGitCommit: null, activeWorkMs: 0, organizationWorkMs: 0, lastClockAt: time, lastActivityAt: null, lastCommitAt: null, agentRunning: false, changeSequence: 0, reviewedSequence: 0, summaries: [], organizationReview: null };
    try {
      const statePath = path.join(this.storeRoot, 'state.json');
      if ((await stat(statePath)).size > 1_000_000) throw new Error('History clock metadata exceeds its size limit');
      const saved = JSON.parse(await readFile(statePath, 'utf8')) as HistoryState;
      if (saved.version !== 1 || saved.projectId !== this.options.projectId || saved.projectRoot !== this.root || !Array.isArray(saved.summaries) || saved.summaries.length > 16 || !saved.summaries.every((item) => typeof item === 'string' && item.length <= 12_000) || ![saved.activeWorkMs, saved.organizationWorkMs, saved.changeSequence, saved.reviewedSequence, saved.lastClockAt].every((value) => Number.isFinite(value) && value >= 0) || ![saved.lastActivityAt, saved.lastCommitAt].every((value) => value === null || Number.isFinite(value)) || ![saved.latestId, saved.baselineId, saved.lastCommitId, saved.lastCommittedTree, saved.lastGitCommit].every((value) => value === null || (typeof value === 'string' && identity(value)))) throw new Error('Invalid history clock metadata');
      this.state = { ...saved, lastClockAt: time, agentRunning: false };
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        // Immutable manifests and refs remain authoritative if a clock file was interrupted.
        await rename(path.join(this.storeRoot, 'state.json'), path.join(this.storeRoot, `state-recovered-${randomUUID()}.json`)).catch(() => undefined);
      }
    }
    const latest = await this.git.reference('refs/history/latest');
    if (latest) {
      if (latest !== this.state.latestId || !this.state.baselineId) await this.recoverState(latest);
      else await this.manifest(latest);
    } else {
      const files = await scanHistoryFiles(this.root, this.git);
      await this.append(files, 'save', 'initial', 'Punto di partenza', 'Copia di recupero iniziale dei file del progetto.', true);
      this.state.baselineId = this.state.latestId;
      this.state.lastCommittedTree = (await this.manifest(this.state.latestId!)).tree;
    }
    this.initialized = true; await this.persist(); this.lastError = null;
  }

  private async recoverState(latest: string): Promise<void> {
    const commit = await this.git.reference('refs/heads/history');
    let id: string | null = latest, count = 0, last: HistoryManifest | null = null, foundCommit = false, lastSavedAt: number | null = null;
    while (id) {
      if (++count > 100_000) throw new Error('History recovery chain exceeds its metadata limit');
      const manifest = await this.manifest(id); last = manifest;
      if (lastSavedAt === null && manifest.entry.kind === 'save') lastSavedAt = Date.parse(manifest.entry.createdAt);
      if (!foundCommit && commit && manifest.entry.gitCommit === commit) {
        this.state.lastCommitId = id; this.state.lastGitCommit = commit; this.state.lastCommittedTree = manifest.tree;
        this.state.lastCommitAt = Date.parse(manifest.entry.createdAt); foundCommit = true;
      }
      if (!manifest.entry.parentId) this.state.baselineId = id;
      id = manifest.entry.parentId;
    }
    this.state.latestId = latest;
    if (lastSavedAt !== null && Number.isFinite(lastSavedAt)) this.state.lastActivityAt = Math.max(this.state.lastActivityAt ?? 0, lastSavedAt);
    if (!foundCommit) { this.state.lastCommitId = null; this.state.lastGitCommit = null; this.state.lastCommittedTree = last?.tree ?? null; }
    this.state.changeSequence += 1;
  }

  private async persist(): Promise<void> {
    const target = path.join(this.storeRoot, 'state.json'), temporary = path.join(this.storeRoot, `state-${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(json(this.state)); await handle.sync(); }
    finally { await handle.close(); }
    try { await rename(temporary, target); }
    finally { await unlink(temporary).catch(() => undefined); }
  }
  private async manifest(id: string): Promise<HistoryManifest> {
    if (!identity(id)) throw new ProjectHistoryError('Unknown project history entry', 404);
    const cached = this.cache.get(id); if (cached) return cached.value;
    let value: HistoryManifest;
    try { value = await this.git.json(id) as HistoryManifest; } catch { throw new ProjectHistoryError('Unknown or damaged project history entry', 404); }
    if (value.version !== 1 || value.projectId !== this.options.projectId || value.projectRoot !== this.root || !identity(value.tree) || !value.entry || !Array.isArray(value.files) || value.files.length > 50_000 || !Array.isArray(value.entry.changedPaths) || (value.entry.parentId !== null && !identity(value.entry.parentId))) throw new Error('Invalid project history manifest');
    const seen = new Set<string>();
    for (const file of value.files) {
      if (!file || !eligibleHistoryPath(file.path) || normalizeHistoryPath(file.path) !== file.path || seen.has(file.path) || !identity(file.hash) || !Number.isSafeInteger(file.size) || file.size < 0 || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) throw new Error('Unsafe project history manifest');
      seen.add(file.path);
    }
    this.cacheManifest(id, value, json(value).length);
    return value;
  }
  private cacheManifest(id: string, value: HistoryManifest, bytes: number): void {
    this.cache.set(id, { value, bytes }); this.cacheBytes += bytes;
    while (this.cacheBytes > 32_000_000 && this.cache.size > 1) { const first = this.cache.keys().next().value!; this.cacheBytes -= this.cache.get(first)!.bytes; this.cache.delete(first); }
  }
  private entry(id: string, manifest: HistoryManifest): ProjectHistoryEntry { return { id, ...manifest.entry }; }
  private advance(time = this.now()): void {
    const until = this.state.agentRunning ? time : this.state.lastActivityAt === null ? this.state.lastClockAt : Math.min(time, this.state.lastActivityAt + 60_000);
    const elapsed = Math.max(0, until - this.state.lastClockAt);
    this.state.activeWorkMs += elapsed; this.state.organizationWorkMs += elapsed; this.state.lastClockAt = time;
  }
  private remember(summary?: string): void {
    const value = summary?.trim().slice(0, 12_000);
    if (value) this.state.summaries = [...this.state.summaries.filter((item) => item !== value), value].slice(-16);
  }
  private summary(paths: string[]): string {
    return this.state.summaries.slice(-4).join('\n\n').slice(0, 12_000) || `${paths.length} file aggiornati${paths.length ? `: ${paths.slice(0, 6).join(', ')}${paths.length > 6 ? '…' : ''}` : ''}.`;
  }

  private async append(files: StoredHistoryFile[], kind: 'save' | 'commit', reason: ProjectHistoryReason, title: string, summary: string, force = false, milestonePaths?: string[]): Promise<ProjectHistoryEntry | null> {
    const previous = this.state.latestId ? await this.manifest(this.state.latestId) : null;
    const changedPaths = changedHistoryPaths(previous?.files ?? [], files);
    if (!changedPaths.length && !force) return null;
    const time = this.now(), tree = await historyTree(this.git, files);
    const gitCommit = kind === 'commit' ? await this.git.commit(tree, this.state.lastGitCommit, `${title}\n\n${summary}\n`, time) : undefined;
    const entry: Omit<ProjectHistoryEntry, 'id'> = { kind, reason, createdAt: new Date(time).toISOString(), title: title.slice(0, 240), summary: summary.slice(0, 12_000), changedPaths: milestonePaths ?? changedPaths, fileCount: files.length, totalBytes: files.reduce((sum, file) => sum + file.size, 0), parentId: this.state.latestId, ...(gitCommit ? { gitCommit } : {}) };
    const manifest: HistoryManifest = { version: 1, projectId: this.options.projectId, projectRoot: this.root, entry, files, tree };
    const content = json(manifest); if (content.length > 16_000_000) throw new ProjectHistoryError('History manifest exceeds its metadata limit', 413);
    const id = await this.git.blob(content); await this.git.publish(id, tree, gitCommit);
    // The next save compares against this manifest; reading it back would start one more git process.
    this.cacheManifest(id, manifest, content.length);
    this.state.latestId = id;
    if (kind === 'commit') { this.state.lastCommitId = id; this.state.lastCommittedTree = tree; this.state.lastGitCommit = gitCommit!; this.state.lastCommitAt = time; this.state.activeWorkMs = 0; this.state.summaries = []; }
    else if (changedPaths.length && reason !== 'initial') { this.advance(time); this.state.changeSequence++; this.state.lastActivityAt = time; }
    await this.persist(); return { id, ...entry };
  }
  private async captureInternal(paths?: string[], reason: ProjectHistoryReason = 'save', summary?: string): Promise<ProjectHistoryEntry | null> {
    const previous = this.state.latestId ? (await this.manifest(this.state.latestId)).files : [];
    const files = await scanHistoryFiles(this.root, this.git, paths, previous);
    const changes = changedHistoryPaths(previous, files); if (!changes.length) return null;
    this.remember(summary);
    return this.append(files, 'save', reason, changes.length === 1 ? `Salvato ${path.posix.basename(changes[0]!)}` : `Salvati ${changes.length} file`, summary?.trim() || this.summary(changes));
  }
  async capture(paths?: string[], reason: ProjectHistoryReason = 'save', summary?: string): Promise<ProjectHistoryEntry | null> { return this.exclusive(async () => { await this.initializeInternal(); return this.captureInternal(paths, reason, summary); }); }

  private async checkpointInternal(reason: 'work' | 'idle' | 'manual' | 'before-restore', title?: string, summary?: string): Promise<ProjectHistoryEntry | null> {
    await this.captureInternal();
    const current = await this.manifest(this.state.latestId!);
    if (current.tree === this.state.lastCommittedTree) return null;
    const base = this.state.lastCommitId ?? this.state.baselineId;
    const changed = changedHistoryPaths(base ? (await this.manifest(base)).files : [], current.files);
    const fallback = reason === 'work' ? 'Punto di lavoro · 45 minuti' : reason === 'idle' ? 'Lavoro salvato dopo la pausa' : reason === 'before-restore' ? 'Prima del ripristino' : 'Punto di lavoro';
    return this.append(current.files, 'commit', reason, title?.trim() || fallback, summary?.trim() || this.summary(changed), true, changed);
  }
  async checkpoint(reason: 'work' | 'idle' | 'manual' | 'before-restore', title?: string, summary?: string): Promise<ProjectHistoryEntry | null> { return this.exclusive(async () => { await this.initializeInternal(); this.advance(); return this.checkpointInternal(reason, title, summary); }); }
  async activity(kind: 'user' | 'agent-start' | 'agent-end' | 'save', summary?: string): Promise<void> {
    return this.exclusive(async () => { await this.initializeInternal(); const time = this.now(); this.advance(time); this.remember(summary); this.state.lastActivityAt = time; if (kind === 'agent-start') this.state.agentRunning = true; if (kind === 'agent-end') this.state.agentRunning = false; await this.persist(); });
  }
  async tick(options: { agentRunning?: boolean } = {}): Promise<void> {
    return this.exclusive(async () => {
      await this.initializeInternal(); const time = this.now(); this.advance(time); if (options.agentRunning !== undefined) this.state.agentRunning = options.agentRunning;
      const current = await this.manifest(this.state.latestId!); const dirty = current.tree !== this.state.lastCommittedTree;
      const idle = !this.state.agentRunning && this.state.lastActivityAt !== null ? time - this.state.lastActivityAt : 0;
      if (dirty && this.state.activeWorkMs >= PROJECT_HISTORY_POLICY.workCommitMs) await this.checkpointInternal('work');
      else if (dirty && idle >= PROJECT_HISTORY_POLICY.idleCommitMs) await this.checkpointInternal('idle');
      if (this.state.changeSequence > this.state.reviewedSequence && (this.state.organizationWorkMs >= PROJECT_HISTORY_POLICY.workReviewMs || idle >= PROJECT_HISTORY_POLICY.idleReviewMs)) await this.reviewInternal(this.state.organizationWorkMs >= PROJECT_HISTORY_POLICY.workReviewMs ? 'work' : 'idle');
      await this.persist();
    });
  }

  async list(limit = 200, beforeId?: string): Promise<ProjectHistoryResponse> {
    // List remains useful after an operation failed: callers can show recovery status.
    return this.exclusive(async () => {
      try { await this.initializeInternal(); } catch (error) { this.lastError = error instanceof Error ? error.message : String(error); return { status: { state: 'error', revision: null, dirty: false, activeWorkMs: 0, organizationWorkMs: 0, lastActivityAt: null, lastCommitAt: null, error: this.lastError, organizationReview: null, excluded: exclusions() }, entries: [] }; }
      const entries: ProjectHistoryEntry[] = []; let id = beforeId === undefined ? this.state.latestId : (await this.manifest(beforeId)).entry.parentId;
      while (id && entries.length < Math.max(1, Math.min(200, Math.floor(limit) || 50))) { const manifest = await this.manifest(id); entries.push(this.entry(id, manifest)); id = manifest.entry.parentId; }
      const current = this.state.latestId ? await this.manifest(this.state.latestId) : null;
      return { status: { state: this.lastError ? 'error' : 'ready', revision: this.state.latestId, dirty: current?.tree !== this.state.lastCommittedTree, activeWorkMs: this.state.activeWorkMs, organizationWorkMs: this.state.organizationWorkMs, lastActivityAt: this.state.lastActivityAt === null ? null : new Date(this.state.lastActivityAt).toISOString(), lastCommitAt: this.state.lastCommitAt === null ? null : new Date(this.state.lastCommitAt).toISOString(), ...(this.lastError ? { error: this.lastError } : {}), organizationReview: this.state.organizationReview, excluded: exclusions() }, entries, nextCursor: id ? entries.at(-1)!.id : null };
    }, false);
  }
  async version(id: string): Promise<ProjectHistoryVersionResponse> { return this.exclusive(async () => { await this.initializeInternal(); const manifest = await this.manifest(id); return { entry: this.entry(id, manifest), files: manifest.files.map(({ path: name, hash, size }) => ({ path: name, hash, size })) }; }, false); }
  async compare(fromId: string, toId?: string, selectedPath?: string): Promise<ProjectHistoryCompareResponse> {
    return this.exclusive(async () => {
      await this.initializeInternal(); const before = await this.manifest(fromId);
      const after = toId ? (await this.manifest(toId)).files : await scanHistoryFiles(this.root, this.git);
      const selected = selectedPath === undefined ? null : normalizeHistoryPath(selectedPath);
      if (selected && !eligibleHistoryPath(selected)) throw new ProjectHistoryError('This path is excluded from project history');
      const left = new Map(before.files.map((file) => [file.path, file])), right = new Map(after.map((file) => [file.path, file]));
      const changes: ProjectHistoryCompareResponse['changes'] = []; let textBudget = 2_000_000;
      for (const name of changedHistoryPaths(before.files, after).filter((name) => !selected || name === selected || name.startsWith(`${selected}/`))) {
        const a = left.get(name), b = right.get(name), max = Math.max(0, Math.min(64_000, Math.floor(textBudget / 2)));
        const old = a ? await this.git.prefix(a.hash, max || 8192) : Buffer.alloc(0), next = b ? await this.git.prefix(b.hash, max || 8192) : Buffer.alloc(0);
        let beforeText = '', afterText = '', binary = /\.(?:pdf|png|jpe?g|webp|gif|tiff?|bmp|ico|zip|7z|docx?|xlsx?|pptx?|woff2?|ttf|otf|mp[34]|mov|avi|wav|dwg|fnx)$/i.test(name) || [old, next].some((value) => value.includes(0));
        try { beforeText = new TextDecoder('utf-8', { fatal: true }).decode(old, { stream: true }); afterText = new TextDecoder('utf-8', { fatal: true }).decode(next, { stream: true }); } catch { binary = true; }
        const truncated = !binary && (!max || (a?.size ?? 0) > old.length || (b?.size ?? 0) > next.length);
        if (!max) { beforeText = ''; afterText = ''; }
        if (!binary) textBudget -= old.length + next.length;
        changes.push({ path: name, kind: !a ? 'added' : !b ? 'deleted' : 'modified', binary, beforeSize: a?.size ?? 0, afterSize: b?.size ?? 0, ...(!binary ? { beforeText, afterText, ...(truncated ? { truncated: true } : {}) } : {}) });
      }
      return { fromId, toId: toId ?? null, changes };
    }, false);
  }

  private async reviewInternal(reason: ProjectOrganizationReview['reason']): Promise<ProjectOrganizationReview> {
    await this.captureInternal(); const current = await this.manifest(this.state.latestId!);
    const review = await reviewHistoryOrganization(current.files, reason, this.now(), async (file) => (await this.git.prefix(file.hash, 512_000)).toString('utf8'));
    this.state.organizationReview = review; this.state.reviewedSequence = this.state.changeSequence; this.state.organizationWorkMs = 0; await this.persist(); return review;
  }
  async organization(action: 'review' | 'acknowledge', reviewId?: string): Promise<ProjectOrganizationReview | null> {
    return this.exclusive(async () => {
      await this.initializeInternal(); if (action === 'review') return this.reviewInternal('manual');
      const review = this.state.organizationReview;
      if (!review || review.id !== reviewId) throw new ProjectHistoryError('This organization review is no longer current', 409);
      this.state.organizationReview = { ...review, status: 'acknowledged' }; await this.persist(); return this.state.organizationReview;
    });
  }

  async restore(request: { entryId: string; paths?: string[] | undefined; baseRevision: string }): Promise<ProjectHistoryRestoreResponse> {
    return this.exclusive(async () => {
      await this.initializeInternal(); await this.captureInternal();
      if (request.baseRevision !== this.state.latestId) throw new ProjectHistoryError('Project files changed. Review the latest version before restoring.', 409);
      const target = await this.manifest(request.entryId), current = await this.manifest(this.state.latestId!);
      const available = [...new Set([...target.files.map((file) => file.path), ...current.files.map((file) => file.path)])];
      const prefixes = request.paths?.map((name) => { const normalized = normalizeHistoryPath(name); if (!eligibleHistoryPath(normalized)) throw new ProjectHistoryError('This path is protected from history restore'); return normalized; });
      for (const prefix of prefixes ?? []) await safeHistoryTarget(this.root, prefix, true);
      if (prefixes && (!prefixes.length || prefixes.some((prefix) => !available.some((name) => name === prefix || name.startsWith(`${prefix}/`))))) throw new ProjectHistoryError('Selected restore path is absent from both versions', 404);
      const selected = available.filter((name) => !prefixes || prefixes.some((prefix) => name === prefix || name.startsWith(`${prefix}/`)));
      const old = new Map(current.files.map((file) => [file.path, file])), desired = new Map(target.files.map((file) => [file.path, file]));
      const changed = selected.filter((name) => old.get(name)?.hash !== desired.get(name)?.hash || old.get(name)?.mode !== desired.get(name)?.mode);
      await this.preflightRestore(changed, desired, new Set(changed.filter((name) => !desired.has(name))));
      const safety = await this.append(current.files, 'save', 'before-restore', 'Prima del ripristino', `Copia di sicurezza prima di ripristinare ${changed.length} file.`, true);
      try {
        for (const name of changed.filter((name) => !desired.has(name)).sort((a, b) => b.length - a.length)) await this.removeProjectFile(name);
        for (const name of changed.filter((name) => desired.has(name))) await this.restoreFile(desired.get(name)!);
      } catch (error) {
        await this.captureInternal(undefined, 'restore', `Ripristino interrotto. I file precedenti restano recuperabili dal punto ${safety!.id}.`).catch(() => undefined);
        throw new ProjectHistoryError(`Restore interrupted; safety snapshot ${safety!.id} is available. ${error instanceof Error ? error.message : String(error)}`, 500);
      }
      const files = await scanHistoryFiles(this.root, this.git);
      const restored = await this.append(files, 'save', 'restore', 'Versione ripristinata', `File ripristinati: ${changed.length}. Versione di origine: ${target.entry.title}.`, true);
      return { entry: restored!, restoredPaths: changed, safetyEntryId: safety!.id };
    });
  }
  private async preflightRestore(names: string[], desired: Map<string, StoredHistoryFile>, deleted: Set<string>): Promise<void> {
    const checkDirectory = async (relative: string): Promise<void> => {
      const directory = await safeHistoryTarget(this.root, relative);
      for await (const item of await opendir(directory)) {
        const name = `${relative}/${item.name}`;
        if (!eligibleHistoryPath(name)) throw new ProjectHistoryError(`Restore would replace protected project data: ${name}`);
        const target = await safeHistoryTarget(this.root, name), info = await lstat(target);
        if (info.isDirectory()) await checkDirectory(name);
        else if (!deleted.has(name)) throw new ProjectHistoryError(`Restore would replace an unselected file: ${name}`);
      }
    };
    for (const name of names) {
      await safeHistoryTarget(this.root, name, true);
      const parts = name.split('/');
      for (let index = 1; index < parts.length; index++) {
        const parent = parts.slice(0, index).join('/'), info = await lstat(path.join(this.root, ...parts.slice(0, index))).catch((error) => { if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return null; throw error; });
        if (info?.isFile() && !deleted.has(parent)) throw new ProjectHistoryError(`Restore would replace an unselected parent: ${parent}`);
      }
      const target = path.join(this.root, ...parts), info = await lstat(target).catch((error) => { if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return null; throw error; });
      if (desired.has(name) && info?.isDirectory()) await checkDirectory(name);
    }
  }
  private async removeEmptyDirectory(relative: string): Promise<void> {
    const target = await safeHistoryTarget(this.root, relative);
    for await (const item of await opendir(target)) {
      const child = `${relative}/${item.name}`;
      if (!eligibleHistoryPath(child) || !(await lstat(await safeHistoryTarget(this.root, child))).isDirectory()) throw new ProjectHistoryError(`Restore refuses a nonempty directory: ${relative}`);
      await this.removeEmptyDirectory(child);
    }
    await rmdir(target);
  }
  private async removeProjectFile(relative: string): Promise<void> {
    const target = await safeHistoryTarget(this.root, relative);
    const info = await lstat(target).catch((error) => { if (errorCode(error) === 'ENOENT') return null; throw error; });
    if (!info) return;
    if (!info.isFile()) throw new ProjectHistoryError(`Restore refuses a non-file deletion: ${relative}`);
    await unlink(target);
  }
  private async restoreFile(file: StoredHistoryFile): Promise<void> {
    const existing = await safeHistoryTarget(this.root, file.path);
    const info = await lstat(existing).catch((error) => { if (errorCode(error) === 'ENOENT') return null; throw error; });
    if (info?.isDirectory()) await this.removeEmptyDirectory(file.path);
    await ensureHistoryParents(this.root, file.path);
    const parent = path.posix.dirname(file.path), temporary = `${parent === '.' ? '' : `${parent}/`}.${path.posix.basename(file.path)}.melillo-restore-${randomUUID()}.tmp`;
    const target = await safeHistoryTarget(this.root, temporary), handle = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      const output = new Writable({ write(chunk: Buffer, _encoding, callback) { void handle.writeFile(chunk).then(() => callback(), callback); } });
      try { await this.git.exportBlob(file.hash, file.size, output); await handle.sync(); }
      finally { await handle.close(); }
      await safeHistoryTarget(this.root, file.path); await chmod(target, file.mode); await rename(target, await safeHistoryTarget(this.root, file.path));
    }
    finally { await unlink(target).catch(() => undefined); }
  }
  async close(): Promise<void> { return this.exclusive(async () => { if (this.initialized) { this.advance(); this.state.agentRunning = false; await this.persist(); } this.closed = true; this.cache.clear(); this.cacheBytes = 0; }); }
}
