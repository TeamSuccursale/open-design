import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectHistoryFile } from '@open-design/contracts';
import type { ProjectHistoryGit } from './project-history-git.js';

export const PROJECT_HISTORY_EXCLUDED = ['.git', '.hg', '.svn', '.bzr', '.file-versions', '.tmp', 'node_modules', '.pnpm-store', '.cache', '.next', '.turbo', '.vite', '.parcel-cache', '.pytest_cache', '__pycache__', '.mypy_cache', '.ruff_cache', '.venv', 'venv', 'coverage', 'playwright-report', 'test-results'] as const;
const excluded = new Set<string>(PROJECT_HISTORY_EXCLUDED);
export interface StoredHistoryFile extends ProjectHistoryFile { mode: number }
export class ProjectHistoryError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); this.name = 'ProjectHistoryError'; }
}
export function normalizeHistoryPath(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\x00-\x1f\x7f:]/.test(value) || /^[\\/]/.test(value) || path.isAbsolute(value)) throw new ProjectHistoryError('History paths must be relative to the project');
  const parts = value.replaceAll('\\', '/').split('/');
  if (parts.some((part) => !part || ['.', '..'].includes(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new ProjectHistoryError('Unsafe project history path');
  return parts.join('/');
}
export function eligibleHistoryPath(value: string): boolean {
  try { return !normalizeHistoryPath(value).split('/').some((part) => excluded.has(part.toLowerCase()) || /^\..+\.melillo-restore-[\w-]+\.tmp$/.test(part) || /\.[0-9a-f]{8}-[0-9a-f-]{27}\.tmp$/i.test(part)); }
  catch { return false; }
}
export function withinHistoryRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
/** Never follows a symlink, junction, or existing ancestor outside the selected project. */
export async function safeHistoryTarget(root: string, relative: string, allowFileParents = false): Promise<string> {
  const normalized = normalizeHistoryPath(relative), parts = normalized.split('/'); let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]!);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !withinHistoryRoot(root, await realpath(current))) throw new ProjectHistoryError(`History refuses linked paths: ${normalized}`);
      if (index < parts.length - 1 && !info.isDirectory()) {
        if (allowFileParents && info.isFile()) break;
        throw new ProjectHistoryError(`A parent is not a directory: ${normalized}`);
      }
      if (index === parts.length - 1 && !info.isFile() && !info.isDirectory()) throw new ProjectHistoryError(`History refuses special files: ${normalized}`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
  }
  const target = path.join(root, ...parts);
  if (!withinHistoryRoot(root, target) || target === root) throw new ProjectHistoryError('History path escapes the project');
  return target;
}
export async function ensureHistoryParents(root: string, relative: string): Promise<void> {
  const parts = normalizeHistoryPath(relative).split('/'); parts.pop();
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const target = await safeHistoryTarget(root, current);
    try { await mkdir(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (!(await lstat(target)).isDirectory()) throw new ProjectHistoryError(`A parent is not a directory: ${relative}`);
    await safeHistoryTarget(root, current);
  }
}

/** The id `git hash-object --no-filters` gives in the store's sha256 format, read without starting git. */
async function gitBlobId(handle: FileHandle, size: number): Promise<string> {
  const hash = createHash('sha256').update(`blob ${size}\0`), buffer = Buffer.allocUnsafe(Math.min(Math.max(size, 1), 1 << 20));
  for (let position = 0; position < size;) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - position), position);
    if (!bytesRead) break;
    hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
  }
  return hash.digest('hex');
}

/**
 * Reads a file's id without starting git; scanHistoryFiles writes the new ones together. `direct` writes
 * this file now, streamed from the same handle, for a file that changed after its id was read.
 */
async function stableHistoryFile(root: string, relative: string, git: ProjectHistoryGit, direct = false): Promise<StoredHistoryFile | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const target = await safeHistoryTarget(root, relative);
    let handle;
    try { handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    try {
      const before = await handle.stat();
      if (!before.isFile()) throw new ProjectHistoryError(`History refuses special files: ${relative}`);
      const hash = direct
        ? await git.blob(createReadStream(target, { fd: handle.fd, autoClose: false, start: 0, highWaterMark: 64 * 1024 }))
        : await gitBlobId(handle, before.size);
      const after = await handle.stat(), current = await lstat(target).catch((error) => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
      if (current?.isSymbolicLink()) throw new ProjectHistoryError(`History refuses linked paths: ${relative}`);
      if (current && current.ino === before.ino && current.size === before.size && current.mtimeMs === before.mtimeMs && current.ctimeMs === before.ctimeMs && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs) return { path: relative, hash, size: before.size, mode: before.mode & 0o777 };
    } finally { await handle.close(); }
  }
  throw new ProjectHistoryError(`File changed while history was saving it: ${relative}`, 409);
}

/**
 * One git process per new file made the 17-file Blockout seed take 2.6 s on Windows and a first snapshot
 * of a 99-file project 8 s. Every new file is written with one process; a file whose id no longer matches
 * changed after its check, so it is stored again as it is now.
 */
async function writeHistoryBlobs(root: string, git: ProjectHistoryGit, files: Map<string, StoredHistoryFile>, unwritten: StoredHistoryFile[]): Promise<void> {
  const written = await git.blobs(unwritten.map((file) => path.join(root, ...file.path.split('/')))).catch(() => [] as string[]);
  for (const [index, file] of unwritten.entries()) {
    if (written[index] === file.hash) continue;
    const current = await stableHistoryFile(root, file.path, git, true);
    if (current) files.set(file.path, current); else files.delete(file.path);
  }
}

/** A full scan is bounded by metadata count; binary content is always streamed. */
export async function scanHistoryFiles(root: string, git: ProjectHistoryGit, selected?: string[], previous: StoredHistoryFile[] = []): Promise<StoredHistoryFile[]> {
  const paths = selected?.map(normalizeHistoryPath).filter(eligibleHistoryPath);
  if (paths && !paths.length) return previous;
  const stored = new Set(previous.map((file) => file.hash)), unwritten: StoredHistoryFile[] = [];
  const files = new Map(previous.filter((file) => paths && !paths.some((prefix) => file.path === prefix || file.path.startsWith(`${prefix}/`))).map((file) => [file.path, file]));
  const visit = async (relative: string): Promise<void> => {
    if (relative && !eligibleHistoryPath(relative)) return;
    const candidate = relative ? path.join(root, ...relative.split('/')) : root;
    const info = await lstat(candidate).catch((error) => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
    if (!info) return;
    if (info.isSymbolicLink()) { if (paths?.includes(relative)) throw new ProjectHistoryError(`History refuses linked paths: ${relative}`); return; }
    const target = relative ? await safeHistoryTarget(root, relative) : root;
    if (info.isDirectory()) {
      for await (const item of await opendir(target)) await visit(relative ? `${relative}/${item.name}` : item.name);
    } else if (info.isFile()) {
      const file = await stableHistoryFile(root, relative, git);
      if (file) { files.set(relative, file); if (!stored.has(file.hash)) unwritten.push(file); }
      if (files.size > 50_000) throw new ProjectHistoryError('Project history exceeds its 50,000-file metadata limit', 413);
    } else throw new ProjectHistoryError(`History refuses special files: ${relative}`);
  };
  for (const relative of paths ? [...new Set(paths)] : ['']) { if (relative) await safeHistoryTarget(root, relative); await visit(relative); }
  await writeHistoryBlobs(root, git, files, unwritten);
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export async function historyTree(git: ProjectHistoryGit, files: StoredHistoryFile[]): Promise<string> {
  interface Tree { files: StoredHistoryFile[]; children: Map<string, Tree> }
  const root: Tree = { files: [], children: new Map() };
  for (const file of files) {
    const parts = file.path.split('/'); let tree = root;
    for (const part of parts.slice(0, -1)) { if (!tree.children.has(part)) tree.children.set(part, { files: [], children: new Map() }); tree = tree.children.get(part)!; }
    tree.files.push(file);
  }
  // Ids are computed here with Git's own tree encoding, where a folder sorts as if its name ended in a
  // slash; Git then writes only the trees it does not have yet, children first, with one process.
  const trees: { id: string; entries: string }[] = [];
  const write = (tree: Tree): string => {
    const entries = [
      ...[...tree.children].map(([name, child]) => ({ name, mode: '40000', type: 'tree', hash: write(child), key: Buffer.from(`${name}/`) })),
      ...tree.files.map((file) => { const name = file.path.split('/').at(-1)!; return { name, mode: file.mode & 0o111 ? '100755' : '100644', type: 'blob', hash: file.hash, key: Buffer.from(name) }; }),
    ].sort((a, b) => Buffer.compare(a.key, b.key));
    const body = Buffer.concat(entries.flatMap((entry) => [Buffer.from(`${entry.mode} ${entry.name}\0`), Buffer.from(entry.hash, 'hex')]));
    const id = createHash('sha256').update(`tree ${body.length}\0`).update(body).digest('hex');
    trees.push({ id, entries: entries.map((entry) => `${entry.mode.padStart(6, '0')} ${entry.type} ${entry.hash}\t${entry.name}\0`).join('') });
    return id;
  };
  const id = write(root);
  await git.writeTrees(trees);
  return id;
}

export function changedHistoryPaths(before: StoredHistoryFile[], after: StoredHistoryFile[]): string[] {
  const previous = new Map(before.map((file) => [file.path, `${file.hash}:${file.mode}`]));
  const current = new Map(after.map((file) => [file.path, `${file.hash}:${file.mode}`]));
  return [...new Set([...previous.keys(), ...current.keys()])].filter((name) => previous.get(name) !== current.get(name)).sort();
}
