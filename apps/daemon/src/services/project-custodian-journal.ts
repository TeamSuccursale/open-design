import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type CustodianDomain = 'text' | 'images' | 'project';
export type CustodianEventType = 'sources-changed' | 'index-started' | 'index-completed' | 'index-failed' | 'query' | 'correction' | 'gap';
export interface CustodianEventInput {
  domain: CustodianDomain; type: CustodianEventType; summary: string; sourceIds?: string[];
}
export interface CustodianJournalEvent extends CustodianEventInput {
  seq: number; at: string; parentRevision: string | null; revision: string;
}
export interface CustodianIndexSnapshot {
  domain: CustodianDomain; revision: string; parentRevision: string | null; at: string;
  sources: string[]; index: unknown;
}
const queues = new Map<string, Promise<unknown>>();
function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Custodian history must contain JSON values');
  return encoded;
}
async function serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  queues.set(key, next);
  try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
}
async function optionalRead(file: string): Promise<string | null> {
  try { return await readFile(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

/** Append-only local history. Diary activity never changes the index revision. */
export class ProjectCustodianJournal {
  private readonly base: string;
  constructor(dataDir: string, private readonly now: () => number = Date.now) {
    if (!path.isAbsolute(dataDir)) throw new Error('An explicit absolute daemon data directory is required');
    this.base = path.join(dataDir, 'project-custodians');
  }
  private folder(projectId: string): string {
    if (!projectId.trim()) throw new Error('A project ID is required');
    return path.join(this.base, digest(projectId));
  }
  private async events(folder: string): Promise<CustodianJournalEvent[]> {
    let names: string[];
    try { names = await readdir(path.join(folder, 'journal')); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const events: CustodianJournalEvent[] = [];
    for (const name of names.filter((entry) => /^\d{12}\.json$/.test(entry)).sort()) {
      const event = JSON.parse(await readFile(path.join(folder, 'journal', name), 'utf8')) as CustodianJournalEvent;
      const { revision, ...payload } = event;
      if (event.seq !== events.length + 1 || name !== `${String(event.seq).padStart(12, '0')}.json`
        || event.parentRevision !== (events.at(-1)?.revision ?? null) || digest(payload) !== revision) {
        throw new Error('Custodian diary integrity check failed');
      }
      events.push(event);
    }
    const head = await optionalRead(path.join(folder, 'journal', 'HEAD'));
    if (head !== (events.at(-1)?.revision ?? null)) throw new Error('Custodian diary head integrity check failed');
    return events;
  }
  async append(projectId: string, input: CustodianEventInput): Promise<CustodianJournalEvent> {
    const folder = this.folder(projectId);
    return serial(folder, async () => {
      const events = await this.events(folder);
      const payload = { domain: input.domain, type: input.type, summary: input.summary.slice(0, 4000), sourceIds: [...(input.sourceIds ?? [])],
        seq: events.length + 1, at: new Date(this.now()).toISOString(), parentRevision: events.at(-1)?.revision ?? null };
      const event = { ...payload, revision: digest(payload) };
      const directory = path.join(folder, 'journal'); await mkdir(directory, { recursive: true });
      const destination = path.join(directory, `${String(event.seq).padStart(12, '0')}.json`);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(event)); await rename(temporary, destination);
      const head = path.join(directory, 'HEAD'), nextHead = `${head}.${randomUUID()}.tmp`;
      await writeFile(nextHead, event.revision); await rename(nextHead, head);
      return event;
    });
  }
  async read(projectId: string, options: { limit?: number } = {}): Promise<{ events: CustodianJournalEvent[]; revision: string | null; verified: true }> {
    const folder = this.folder(projectId);
    return serial(folder, async () => {
      const events = await this.events(folder);
      return { events: events.slice(-Math.max(1, Math.min(100, options.limit ?? 100))), revision: events.at(-1)?.revision ?? null, verified: true };
    });
  }
  async snapshot(projectId: string, input: { domain: CustodianDomain; sources: string[]; index: unknown }): Promise<CustodianIndexSnapshot> {
    const folder = this.folder(projectId);
    return serial(folder, async () => {
      const directory = path.join(folder, 'snapshots', input.domain); await mkdir(directory, { recursive: true });
      const head = path.join(directory, 'HEAD'); const parentRevision = await optionalRead(head);
      if (parentRevision) {
        const previous = await this.loadSnapshot(directory, parentRevision);
        if (canonical(previous.sources) === canonical(input.sources) && canonical(previous.index) === canonical(input.index)) return previous;
      }
      const payload = { domain: input.domain, parentRevision, at: new Date(this.now()).toISOString(), sources: [...input.sources], index: input.index };
      const snapshot = { ...payload, revision: digest(payload) };
      await writeFile(path.join(directory, `${snapshot.revision}.json`), JSON.stringify(snapshot), { flag: 'wx' });
      const temporary = `${head}.${randomUUID()}.tmp`; await writeFile(temporary, snapshot.revision); await rename(temporary, head);
      return snapshot;
    });
  }
  private async loadSnapshot(directory: string, revision: string): Promise<CustodianIndexSnapshot> {
    if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('Invalid custodian index revision');
    const snapshot = JSON.parse(await readFile(path.join(directory, `${revision}.json`), 'utf8')) as CustodianIndexSnapshot;
    const { revision: stored, ...payload } = snapshot;
    if (stored !== revision || digest(payload) !== revision) throw new Error('Custodian index integrity check failed');
    return snapshot;
  }
  async snapshots(projectId: string, domain: CustodianDomain): Promise<CustodianIndexSnapshot[]> {
    const folder = this.folder(projectId);
    return serial(folder, async () => {
      const directory = path.join(folder, 'snapshots', domain); let revision = await optionalRead(path.join(directory, 'HEAD'));
      const result: CustodianIndexSnapshot[] = [], seen = new Set<string>();
      while (revision) {
        if (seen.has(revision)) throw new Error('Custodian index history cycle'); seen.add(revision);
        const snapshot = await this.loadSnapshot(directory, revision); result.push(snapshot); revision = snapshot.parentRevision;
      }
      return result;
    });
  }
}
