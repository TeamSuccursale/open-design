import { constants, createReadStream } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath } from 'node:fs/promises';
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

async function stableHistoryFile(root: string, relative: string, git: ProjectHistoryGit): Promise<StoredHistoryFile | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const target = await safeHistoryTarget(root, relative);
    let handle;
    try { handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    try {
      const before = await handle.stat();
      if (!before.isFile()) throw new ProjectHistoryError(`History refuses special files: ${relative}`);
      const stream = createReadStream(target, { fd: handle.fd, autoClose: false, highWaterMark: 64 * 1024 });
      const hash = await git.blob(stream);
      const after = await handle.stat(), current = await lstat(target).catch((error) => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
      if (current?.isSymbolicLink()) throw new ProjectHistoryError(`History refuses linked paths: ${relative}`);
      if (current && current.ino === before.ino && current.size === before.size && current.mtimeMs === before.mtimeMs && current.ctimeMs === before.ctimeMs && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs) return { path: relative, hash, size: before.size, mode: before.mode & 0o777 };
    } finally { await handle.close(); }
  }
  throw new ProjectHistoryError(`File changed while history was saving it: ${relative}`, 409);
}

/** A full scan is bounded by metadata count; binary content is always streamed. */
export async function scanHistoryFiles(root: string, git: ProjectHistoryGit, selected?: string[], previous: StoredHistoryFile[] = []): Promise<StoredHistoryFile[]> {
  const paths = selected?.map(normalizeHistoryPath).filter(eligibleHistoryPath);
  if (paths && !paths.length) return previous;
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
      if (file) files.set(relative, file);
      if (files.size > 50_000) throw new ProjectHistoryError('Project history exceeds its 50,000-file metadata limit', 413);
    } else throw new ProjectHistoryError(`History refuses special files: ${relative}`);
  };
  for (const relative of paths ? [...new Set(paths)] : ['']) { if (relative) await safeHistoryTarget(root, relative); await visit(relative); }
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
  const write = async (tree: Tree): Promise<string> => {
    const entries: string[] = [];
    for (const [name, child] of tree.children) entries.push(`040000 tree ${await write(child)}\t${name}\0`);
    for (const file of tree.files) entries.push(`${file.mode & 0o111 ? '100755' : '100644'} blob ${file.hash}\t${file.path.split('/').at(-1)}\0`);
    return git.tree(entries.join(''));
  };
  return write(root);
}

export function changedHistoryPaths(before: StoredHistoryFile[], after: StoredHistoryFile[]): string[] {
  const previous = new Map(before.map((file) => [file.path, `${file.hash}:${file.mode}`]));
  const current = new Map(after.map((file) => [file.path, `${file.hash}:${file.mode}`]));
  return [...new Set([...previous.keys(), ...current.keys()])].filter((name) => previous.get(name) !== current.get(name)).sort();
}
