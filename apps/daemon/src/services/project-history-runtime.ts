import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import chokidar from 'chokidar';
import type { ProjectHistoryRestoreResponse } from '@open-design/contracts';
import { installProjectHistoryObserver, type ProjectHistoryMutation } from '../project-history-observer.js';
import { eligibleHistoryPath, ProjectHistoryStore } from './project-history.js';

interface Registration { root: string; store: ProjectHistoryStore; ready: Promise<void>; unsubscribe: () => Promise<void> }
interface Options {
  dataRoot: string; projectsRoot: string;
  resolveProject: (id: string) => { root: string } | null;
  isAgentRunning: (id: string) => boolean;
  beforeRestore?: (projectId: string, root: string) => Promise<void>;
  onError?: (error: unknown) => void;
  intervalMs?: number;
}

/** Keeps recovery alive without an open tab; app writes wait for their durable snapshot. */
export class ProjectHistoryRuntime {
  private registrations = new Map<string, Registration>();
  private pending = new Map<string, Promise<unknown>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopObserver: () => void;
  private closed = false;
  private ticking = false;
  private registryWrite: Promise<void> = Promise.resolve();
  private knownProjectIds = new Set<string>();
  constructor(private options: Options) {
    this.stopObserver = installProjectHistoryObserver((mutation, write) => this.mutation(mutation, write));
  }
  private async serial<T>(root: string, work: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(root) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.pending.set(root, next);
    try { return await next; } finally { if (this.pending.get(root) === next) this.pending.delete(root); }
  }
  private error = (error: unknown) => this.options.onError?.(error);
  private watch(root: string, observe: (absolute: string) => void, reconcile: () => Promise<void>): { ready: Promise<void>; close: () => Promise<void> } {
    let watcher: ReturnType<typeof chokidar.watch> | null = null;
    let stopped = false, settled = false;
    let resolveReady!: () => void, rejectReady!: (error: unknown) => void;
    let handoff = Promise.resolve();
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const fail = (error: unknown) => { this.error(error); if (!settled) { settled = true; rejectReady(error); } };
    const start = (usePolling: boolean): void => {
      if (stopped) return;
      const onError = (error: unknown, source: typeof watcher) => {
        if (stopped || source !== watcher) return;
        const code = (error as NodeJS.ErrnoException | null)?.code;
        if (!usePolling && (code === 'EBUSY' || code === 'EPERM')) {
          // Windows scanners/editors can temporarily lock a file against fs.watch.
          // Switch once; retrying native watches would repeatedly block app saves.
          watcher = null; this.error(error);
          handoff = (async () => { await source?.close(); start(true); })().catch(fail);
        } else fail(error);
      };
      let next: ReturnType<typeof chokidar.watch>;
      try {
        next = chokidar.watch(root, {
          ignored: (absolute: string, stats?: Stats) => { const relative = path.relative(root, absolute).split(path.sep).join('/'); return Boolean(relative && (!eligibleHistoryPath(relative) || stats?.isSymbolicLink())); },
          followSymlinks: false, ignoreInitial: true, atomic: 200,
          awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
          usePolling, ...(usePolling ? { interval: 1_000, binaryInterval: 1_000 } : {}),
        });
      } catch (error) { onError(error, null); return; }
      watcher = next;
      next.once('ready', () => {
        if (stopped || next !== watcher) return;
        if (!settled) { settled = true; resolveReady(); }
        else {
          // ignoreInitial suppresses events for files changed during the handoff.
          void reconcile().catch(this.error);
        }
      });
      next.on('error', (error) => onError(error, next));
      next.on('add', observe); next.on('change', observe); next.on('unlink', observe);
    };
    start(process.env.OD_WATCHER_USE_POLLING === '1' || process.env.CHOKIDAR_USEPOLLING === '1');
    return { ready, close: async () => {
      stopped = true;
      if (!settled) { settled = true; rejectReady(new Error('Project history watcher is closing')); }
      await watcher?.close(); await handoff;
    } };
  }
  private persistRegistry(): Promise<void> {
    this.registryWrite = this.registryWrite.catch(() => undefined).then(async () => {
      const folder = path.join(this.options.dataRoot, 'project-history');
      await mkdir(folder, { recursive: true });
      const temporary = path.join(folder, `.registry.${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify({ version: 1, projects: [...this.knownProjectIds] }));
      await rename(temporary, path.join(folder, '.registry.json'));
    });
    return this.registryWrite;
  }
  async start(): Promise<void> {
    let saved: unknown;
    try { saved = JSON.parse(await readFile(path.join(this.options.dataRoot, 'project-history', '.registry.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.error(error); }
    const ids = saved && typeof saved === 'object' && 'projects' in saved && Array.isArray(saved.projects) ? saved.projects : [];
    for (const id of ids) if (typeof id === 'string') this.knownProjectIds.add(id);
    for (const id of ids) {
      if (this.closed || typeof id !== 'string') continue;
      const project = this.options.resolveProject(id);
      if (project) { try { await this.store(id, project.root); } catch (error) { this.error(error); } }
    }
    if (!this.closed) { this.timer = setInterval(() => void this.tick(), this.options.intervalMs ?? 15_000); this.timer.unref(); }
  }
  async store(projectId: string, root: string): Promise<ProjectHistoryStore> {
    if (this.closed) throw new Error('Project history is closing');
    const existing = this.registrations.get(projectId);
    if (existing) {
      if (path.resolve(existing.root) !== path.resolve(root)) throw Object.assign(new Error('Project location changed; reopen history'), { statusCode: 409 });
      await existing.ready; return existing.store;
    }
    const store = new ProjectHistoryStore({ dataRoot: this.options.dataRoot, projectId, projectRoot: root });
    const observe = (absolute: string) => {
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (!eligibleHistoryPath(relative)) return;
      const registration = this.registrations.get(projectId);
      if (!registration || this.closed) return;
      void registration.ready.then(() => this.serial(root, async () => { await store.capture([relative], 'save'); })).catch(this.error);
    };
    const watcher = this.watch(root, observe, async () => {
      const registration = this.registrations.get(projectId);
      if (!registration || this.closed) return;
      await registration.ready; await this.serial(root, async () => { await store.capture(); });
    });
    const ready = (async () => { await watcher.ready; await store.initialize(); await store.capture(); })();
    this.registrations.set(projectId, { root, store, ready, unsubscribe: () => watcher.close() });
    this.knownProjectIds.add(projectId);
    try { await ready; await this.persistRegistry(); return store; }
    catch (error) { this.registrations.delete(projectId); await watcher.close(); throw error; }
  }
  private async mutation<T>(mutation: ProjectHistoryMutation, write: () => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('Project history is closing');
    if (mutation.projectId) await this.store(mutation.projectId, mutation.root);
    const stores = [...this.registrations.values()].filter((item) => path.resolve(item.root) === path.resolve(mutation.root));
    if (!stores.length) return write();
    return this.serial(mutation.root, async () => {
      for (const registration of stores) { await registration.ready; await registration.store.capture(mutation.paths, 'save'); }
      try { return await write(); }
      finally { for (const registration of stores) await registration.store.capture(mutation.paths, 'save'); }
    });
  }
  async activity(projectId: string, kind: 'user' | 'agent-start' | 'agent-end' | 'save', summary?: string): Promise<void> {
    const project = this.options.resolveProject(projectId); if (!project || this.closed) return;
    const store = await this.store(projectId, project.root);
    await store.activity(kind, summary);
    if (kind === 'agent-end') await this.serial(project.root, () => store.capture(undefined, 'save', summary));
  }
  async restore(projectId: string, root: string, input: { entryId: string; paths?: string[] | undefined; baseRevision: string }): Promise<ProjectHistoryRestoreResponse> {
    const store = await this.store(projectId, root);
    return this.serial(root, async () => {
      if (this.options.isAgentRunning(projectId)) throw Object.assign(new Error('Stop the active agent before restoring files'), { statusCode: 409, code: 'HISTORY_AGENT_RUNNING' });
      try { await this.options.beforeRestore?.(projectId, root); }
      catch (error) {
        if ((error as { statusCode?: number }).statusCode === 409) throw Object.assign(new Error('Background document preparation is still running'), { statusCode: 409, code: 'HISTORY_BACKGROUND_RUNNING' });
        throw error;
      }
      return store.restore(input);
    });
  }
  async tick(): Promise<void> {
    if (this.closed || this.ticking) return; this.ticking = true;
    try {
      for (const [id, registration] of this.registrations) {
        try { await registration.ready; await this.serial(registration.root, () => registration.store.tick({ agentRunning: this.options.isAgentRunning(id) })); }
        catch (error) { this.error(error); }
      }
    } finally { this.ticking = false; }
  }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true; this.stopObserver(); if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.registrations.values()].map((item) => item.unsubscribe()));
    await Promise.allSettled([...this.pending.values(), this.registryWrite]);
    await Promise.allSettled([...this.registrations.values()].map(async (item) => { await item.ready; await item.store.close(); }));
  }
}
