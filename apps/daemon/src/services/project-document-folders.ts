import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { lstat, mkdir, open, opendir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { isBlockoutFile, isInternalBlockoutFile, type ProjectDocumentContextResponse, type ProjectDocumentFile } from '@open-design/contracts';
import { isBlocked } from '../linked-dirs.js';

export class ProjectDocumentError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); this.name = 'ProjectDocumentError'; }
}
export class ProjectDocumentScopeConflict extends ProjectDocumentError {
  constructor(readonly documentId: string, readonly workspaceProjectId: string) {
    super(`Document ${documentId} belongs to workspace ${workspaceProjectId}. Retry with --project ${workspaceProjectId}; the collection project ID cannot save this document.`, 409);
    this.name = 'ProjectDocumentScopeConflict';
  }
}
export const documentFolderInside = (root: string, target: string) => { const relative = path.relative(root, target); return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); };
export const sameDocumentFolder = (a: string, b: string) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
const excluded = new Set(['.git', '.hg', '.svn', '.bzr', 'node_modules', '.pnpm-store', '.cache', '.next', '.tmp', '.file-versions', '.agents', '.codex', '.claude', '.melillodesign', '.od-frames', '.opendesign', '.od']);
export function documentRelativePath(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || /^[\\/]/.test(value) || path.isAbsolute(value) || /[\x00-\x1f\x7f:]/.test(value)) throw new ProjectDocumentError('Document file paths must be relative');
  const parts = value.replaceAll('\\', '/').split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || excluded.has(part.toLowerCase()))) throw new ProjectDocumentError('Unsafe document file path');
  return parts.join('/');
}
export async function safeDocumentPath(root: string, relative: string): Promise<string> {
  const parts = documentRelativePath(relative).split('/'); let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const info = await lstat(current).catch((error) => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
    if (!info) break;
    if (info.isSymbolicLink() || !documentFolderInside(root, await realpath(current))) throw new ProjectDocumentError('Document context does not follow linked files or folders');
  }
  return path.join(root, ...parts);
}
export async function createDocumentDirectory(root: string, relative: string): Promise<string> {
  const parts = documentRelativePath(relative).split('/'); let prefix = '';
  for (const part of parts) {
    prefix = prefix ? `${prefix}/${part}` : part; const target = await safeDocumentPath(root, prefix);
    try { await mkdir(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (!(await lstat(target)).isDirectory()) throw new ProjectDocumentError('A document folder parent is not a directory');
  }
  return realpath(await safeDocumentPath(root, relative));
}
export async function validateDocumentDirectory(value: string, dataRoot: string, projectRoot: string): Promise<string> {
  if (!path.isAbsolute(value)) throw new ProjectDocumentError('Choose an absolute existing document folder');
  const info = await lstat(value).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new ProjectDocumentError('Choose an existing document folder, not a linked or unavailable directory');
  const root = await realpath(value), home = await realpath(homedir()).catch(() => homedir());
  if (isBlocked(root) || sameDocumentFolder(root, home) || documentFolderInside(root, dataRoot) || (documentFolderInside(dataRoot, root) && !documentFolderInside(projectRoot, root)) || ['.ssh', '.aws', '.gnupg', '.kube', '.codex'].some((name) => documentFolderInside(path.join(home, name), root))) throw new ProjectDocumentError('Choose a document folder outside system, credentials and private daemon data');
  return root;
}
export async function documentContextFiles(root: string, requested?: string, scope?: string[]): Promise<Pick<ProjectDocumentContextResponse, 'files' | 'truncated' | 'limitations' | 'file'>> {
  const files: ProjectDocumentFile[] = []; let truncated = false, inspected = 0;
  const visit = async (directory: string, prefix = '', depth = 0): Promise<void> => {
    if (depth > 12 || inspected > 4000) { truncated = true; return; }
    for await (const entry of await opendir(directory)) {
      if (++inspected > 4000 || files.length >= 2000) { truncated = true; break; }
      if (excluded.has(entry.name.toLowerCase()) || entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isInternalBlockoutFile(relative) || isBlockoutFile(relative)) continue;
      let target: string;
      try { target = await safeDocumentPath(root, relative); } catch { continue; }
      if (entry.isDirectory()) await visit(target, relative, depth + 1);
      else if (entry.isFile()) { const info = await stat(target); files.push({ path: relative, size: info.size }); }
    }
  };
  if (scope) {
    for (const prefix of scope) {
      const target = await safeDocumentPath(root, prefix), info = await lstat(target).catch((error) => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
      if (info?.isDirectory()) await visit(target, prefix);
      else if (info?.isFile() && !isInternalBlockoutFile(prefix) && !isBlockoutFile(prefix) && !files.some((file) => file.path === prefix)) files.push({ path: prefix, size: info.size });
    }
  } else await visit(root);
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const result: Pick<ProjectDocumentContextResponse, 'files' | 'truncated' | 'limitations' | 'file'> = { files, truncated, limitations: ['Il contesto riguarda soltanto la cartella registrata per questo documento. I collegamenti annidati e le cartelle tecniche sono esclusi.', ...(truncated ? ['Inventario limitato a 2.000 file, 4.000 voci e 12 livelli. Richiedi un file preciso per leggerlo.'] : [])] };
  if (requested !== undefined) {
    const relative = documentRelativePath(requested), target = await safeDocumentPath(root, relative);
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch((error) => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ProjectDocumentError('Document file not found', 404); throw error; });
    try {
      const info = await handle.stat(); if (!info.isFile()) throw new ProjectDocumentError('Choose a document file');
      const buffer = Buffer.alloc(Math.min(info.size, 256_000)); const read = await handle.read(buffer, 0, buffer.length, 0); const content = buffer.subarray(0, read.bytesRead);
      const file: NonNullable<ProjectDocumentContextResponse['file']> = { path: relative, size: info.size, binary: content.includes(0), truncated: info.size > content.length };
      if (!file.binary) { try { file.text = new TextDecoder('utf-8', { fatal: true }).decode(content, { stream: true }); } catch { file.binary = true; } }
      result.file = file;
    } finally { await handle.close(); }
  }
  return result;
}
