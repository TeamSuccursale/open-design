import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { HeaderFooterSourceFile, HeaderFooterSourceFilesResponse } from '@open-design/contracts';
import { HEADER_FOOTER_UPLOAD_LIMITS, type HeaderFooterUpload } from './header-footer-assets.js';

const excluded = new Set(['node_modules', '.git', '.melillodesign', '.tmp', 'intake-assets', 'header-footer']);
const supported = /\.(svg|png|jpe?g|webp|gif|bmp|zip)$/i;
const inside = (root: string, file: string) => { const relative = path.relative(root, file); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
interface Source extends HeaderFooterSourceFile { absolute: string; root: string }

/** Scan only roots already selected for this project. Symlinks and generated galleries are never followed. */
async function sources(roots: string[]): Promise<{ files: Source[]; truncated: boolean }> {
  const files: Source[] = [], seen = new Set<string>(); let visited = 0, truncated = false;
  for (const supplied of roots) {
    const canonical = await realpath(supplied).catch(() => null); if (!canonical || seen.has(canonical)) continue;
    const root: string = canonical; seen.add(root);
    async function walk(folder: string, depth: number): Promise<void> {
      const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (++visited > 2000 || files.length >= 128) { truncated = true; return; }
        if (entry.isSymbolicLink() || entry.name.startsWith('.') || excluded.has(entry.name)) continue;
        const absolute = path.join(folder, entry.name);
        if (entry.isDirectory()) { if (depth < 3) await walk(absolute, depth + 1); continue; }
        if (!entry.isFile() || !supported.test(entry.name)) continue;
        const stat = await lstat(absolute).catch(() => null), zip = /\.zip$/i.test(entry.name);
        if (!stat || stat.isSymbolicLink() || stat.size < 1 || stat.size > (zip ? HEADER_FOOTER_UPLOAD_LIMITS.batchBytes : HEADER_FOOTER_UPLOAD_LIMITS.fileBytes)) continue;
        const relativePath = path.relative(root, absolute).replaceAll('\\', '/');
        files.push({ id: createHash('sha256').update(`${root}\0${relativePath}`).digest('hex'), name: entry.name, relativePath, folder: path.basename(root), size: stat.size, kind: zip ? 'zip' : 'image', absolute, root });
      }
    }
    await walk(root, 0); if (truncated) break;
  }
  return { files, truncated };
}

export async function listHeaderFooterSourceFiles(roots: string[]): Promise<HeaderFooterSourceFilesResponse> {
  const result = await sources(roots); return { files: result.files.map(({ absolute: _absolute, root: _root, ...file }) => file), truncated: result.truncated };
}

/** Resolve opaque IDs afresh before reading. Import cannot select a path outside current project roots. */
export async function readHeaderFooterSourceFiles(roots: string[], ids: readonly string[]): Promise<HeaderFooterUpload[]> {
  const available = await sources(roots), uploads: HeaderFooterUpload[] = []; let total = 0;
  for (const id of new Set(ids)) {
    const source = available.files.find((file) => file.id === id);
    if (!source) throw Object.assign(new Error('Il file non è più disponibile nelle cartelle scelte. Aggiorna l’elenco e riprova.'), { statusCode: 409 });
    const current = await realpath(source.absolute), stat = await lstat(source.absolute);
    if (!inside(source.root, current) || stat.isSymbolicLink() || !stat.isFile() || stat.size !== source.size) throw Object.assign(new Error('Il file sorgente è cambiato. Aggiorna l’elenco e riprova.'), { statusCode: 409 });
    total += stat.size; if (total > HEADER_FOOTER_UPLOAD_LIMITS.batchBytes) throw Object.assign(new Error('Importa al massimo 50 MB per volta.'), { statusCode: 413 });
    uploads.push({ filename: source.name, data: await readFile(current) });
  }
  return uploads;
}
