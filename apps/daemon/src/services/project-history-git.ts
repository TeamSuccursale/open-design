import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ProjectHistoryError } from './project-history-files.js';

/**
 * Every command has an explicit private Git directory and ignores inherited Git configuration.
 * Inherited configuration is also where Windows users enable long paths, so it is set here: a
 * data root deep enough for objects/xx/<62 hex> to pass 260 characters must still record history.
 */
export class ProjectHistoryGit {
  readonly directory: string;
  private readonly environment: NodeJS.ProcessEnv;
  constructor(private readonly root: string) {
    this.directory = path.join(root, 'objects.git');
    this.environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    Object.assign(this.environment, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'MelilloDesign', GIT_AUTHOR_EMAIL: 'history@localhost', GIT_COMMITTER_NAME: 'MelilloDesign', GIT_COMMITTER_EMAIL: 'history@localhost' });
  }

  async initialize(): Promise<void> {
    const empty = path.join(this.root, 'empty');
    await mkdir(empty, { recursive: true });
    await this.run(['init', '--bare', '--object-format=sha256', `--template=${empty}`, this.directory]);
  }

  private async command(args: string[], options: { input?: Readable | Uint8Array; output?: Writable; limit?: number; prefix?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<Buffer> {
    const child = spawn('git', ['--no-pager', `--git-dir=${this.directory}`, '-c', `core.hooksPath=${path.join(this.root, 'empty')}`, '-c', 'core.fsmonitor=false', '-c', 'core.longpaths=true', '-c', 'commit.gpgSign=false', '-c', 'gc.auto=0', '-c', 'core.fsync=all', ...args], { cwd: this.root, env: { ...this.environment, ...options.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let errorText = '', outputBytes = 0, exceeded = false, ioError: unknown;
    const chunks: Buffer[] = [], limit = options.limit ?? 16_000_000;
    const completed = new Promise<{ code: number | null; error?: Error }>((resolve) => {
      child.once('error', (error) => resolve({ code: null, error }));
      child.once('close', (code) => resolve({ code }));
    });
    child.stderr.on('data', (chunk: Buffer) => { if (errorText.length < 32_000) errorText += chunk.toString('utf8').slice(0, 32_000 - errorText.length); });
    let outputTask: Promise<void> | undefined;
    if (options.output) outputTask = pipeline(child.stdout, options.output).catch((error) => { ioError = error; child.kill(); });
    else child.stdout.on('data', (chunk: Buffer) => {
      if (exceeded) return;
      const remaining = limit - outputBytes;
      if (chunk.length > remaining) {
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        outputBytes = limit; exceeded = true; child.kill();
      } else { chunks.push(chunk); outputBytes += chunk.length; }
    });
    const inputTask = options.input ? pipeline(options.input instanceof Readable ? options.input : Readable.from([options.input]), child.stdin).catch((error) => { ioError = error; child.kill(); }) : Promise.resolve(child.stdin.end()).then(() => undefined);
    const timer = setTimeout(() => { ioError = new Error('Private history Git operation timed out'); child.kill(); }, 120_000);
    timer.unref();
    const result = await completed;
    await Promise.all([inputTask, outputTask]); clearTimeout(timer);
    if (result.error) throw new Error(`Private history Git unavailable: ${result.error.message}`);
    if (ioError) throw ioError;
    if (exceeded && !options.prefix) throw new Error('Private history metadata exceeds its size limit');
    if (result.code !== 0 && /'\$GIT_DIR' too big|Filename too long/i.test(errorText)) {
      // Past Git's own limit (about 221 characters for the Git directory on Windows) only a shorter data root helps.
      throw Object.assign(new ProjectHistoryError(`La cronologia del progetto non può essere salvata: il percorso della cartella dati del daemon è troppo lungo per Git su Windows (${this.directory.length} caratteri fino alla cronologia). Sposta la cartella dati in un percorso più breve.`, 503), { code: 'HISTORY_PATH_TOO_LONG' });
    }
    if (result.code !== 0 && !(exceeded && options.prefix)) throw new Error(`Private history Git failed: ${errorText.trim() || `exit ${result.code}`}`);
    return Buffer.concat(chunks, outputBytes);
  }

  async run(args: string[], input?: Readable | Uint8Array): Promise<string> {
    return (await this.command(args, input === undefined ? {} : { input })).toString('utf8');
  }
  async blob(input: Readable | Uint8Array): Promise<string> { return (await this.run(['hash-object', '-w', '--stdin', '--no-filters'], input)).trim(); }
  /**
   * Writes several files with one process and returns their ids in order. Git reads them by path, so the
   * caller compares each id with the one it read from the file itself. History paths never hold a line break.
   */
  async blobs(paths: string[]): Promise<string[]> {
    if (!paths.length) return [];
    return (await this.run(['hash-object', '-w', '--no-filters', '--stdin-paths'], Buffer.from(paths.map((file) => `${file}\n`).join(''))))
      .split('\n').map((line) => line.trim()).filter(Boolean);
  }
  private readonly trees = new Set<string>();
  /**
   * Writes, with one process, the trees this repository has not written yet. Their ids are computed by the
   * caller, children before parents, and each must come back from Git unchanged.
   */
  async writeTrees(trees: { id: string; entries: string }[]): Promise<void> {
    const missing = [...new Map(trees.filter((tree) => !this.trees.has(tree.id)).map((tree) => [tree.id, tree])).values()];
    if (!missing.length) return;
    const written = (await this.run(['mktree', '-z', '--batch'], Buffer.from(missing.map((tree) => `${tree.entries}\0`).join(''))))
      .split('\n').map((line) => line.trim()).filter(Boolean);
    if (written.length !== missing.length || written.some((id, index) => id !== missing[index]!.id)) throw new Error('Private history tree identity mismatch');
    if (this.trees.size + missing.length > 50_000) this.trees.clear();
    for (const tree of missing) this.trees.add(tree.id);
  }
  async json(hash: string): Promise<unknown> { this.assertHash(hash); return JSON.parse(await this.run(['cat-file', 'blob', hash])); }
  async prefix(hash: string, limit: number): Promise<Buffer> { this.assertHash(hash); return this.command(['cat-file', 'blob', hash], { prefix: true, limit }); }
  async reference(name: string): Promise<string | null> {
    const value = await this.run(['for-each-ref', '--format=%(objectname)', name]);
    return value.trim() || null;
  }
  async publish(id: string, tree: string, commit?: string): Promise<void> {
    this.assertHash(id); this.assertHash(tree); if (commit) this.assertHash(commit);
    await this.run(['update-ref', '--stdin'], Buffer.from(`start\nupdate refs/snapshots/${id} ${tree}\nupdate refs/recovery/${id} ${id}\nupdate refs/history/latest ${id}\n${commit ? `update refs/heads/history ${commit}\n` : ''}prepare\ncommit\n`));
  }
  async commit(tree: string, parent: string | null, message: string, now: number): Promise<string> {
    this.assertHash(tree); if (parent) this.assertHash(parent);
    const date = `${Math.floor(now / 1000)} +0000`;
    return (await this.command(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-F', '-'], { input: Buffer.from(message), env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } })).toString('utf8').trim();
  }
  async exportBlob(hash: string, size: number, output: Writable): Promise<void> {
    this.assertHash(hash);
    const digest = createHash('sha256').update(`blob ${size}\0`); let bytes = 0;
    // The writable receives a bounded stream; file bytes never collect in memory.
    const { Transform } = await import('node:stream');
    const verify = new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; if (bytes > size) { callback(new Error('History blob size does not match its manifest')); return; } digest.update(chunk); callback(null, chunk); } });
    const forwarded = pipeline(verify, output);
    const streamed = this.command(['cat-file', 'blob', hash], { output: verify });
    try { await Promise.all([streamed, forwarded]); }
    catch (error) { verify.destroy(); await Promise.allSettled([streamed, forwarded]); throw error; }
    if (bytes !== size || digest.digest('hex') !== hash) throw new Error('History blob integrity check failed');
  }
  private assertHash(hash: string): void { if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid history object identity'); }
}
