import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

export const HEADER_FOOTER_UPLOAD_LIMITS = { fileBytes: 12 * 1024 * 1024, batchBytes: 50 * 1024 * 1024, entries: 128 } as const;
export interface HeaderFooterAssetInput {
  name: string; filename: string; mimeType: string; width?: number; height?: number;
  source: 'upload' | 'web'; sourceUrl?: string; organisation?: string;
}
export interface HeaderFooterUpload { filename: string; data: Buffer }
export interface HeaderFooterUploadError { name: string; message: string }
export type HeaderFooterAssetSaver<T> = (input: HeaderFooterAssetInput, data: Buffer) => Promise<T>;
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function dimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 100_000 || height > 100_000) throw new Error('Dimensioni del logo non valide');
  return { width, height };
}

/** Inspect the bytes rather than trusting the extension or the browser's MIME. SVG remains vector. */
export function inspectHeaderFooterLogo(filename: string, data: Buffer): HeaderFooterAssetInput {
  if (!data.length || data.length > HEADER_FOOTER_UPLOAD_LIMITS.fileBytes) throw new Error('Il logo deve essere compreso tra 1 byte e 12 MB');
  let mimeType: string, size: { width: number; height: number } | undefined;
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mimeType = 'image/png'; size = dimensions(data.readUInt32BE(16), data.readUInt32BE(20));
  } else if (data.length >= 10 && /GIF8[79]a/.test(data.toString('ascii', 0, 6))) {
    mimeType = 'image/gif'; size = dimensions(data.readUInt16LE(6), data.readUInt16LE(8));
  } else if (data.length >= 26 && data.toString('ascii', 0, 2) === 'BM') {
    mimeType = 'image/bmp'; size = dimensions(Math.abs(data.readInt32LE(18)), Math.abs(data.readInt32LE(22)));
  } else if (data.length >= 4 && data[0] === 255 && data[1] === 216) {
    mimeType = 'image/jpeg'; let offset = 2;
    while (offset + 8 < data.length) {
      if (data[offset] !== 255) { offset++; continue; }
      const marker = data[offset + 1]!;
      if ([0xd8, 0xd9, 0x01].includes(marker) || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = data.readUInt16BE(offset + 2); if (length < 2 || offset + length + 2 > data.length) break;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) { size = dimensions(data.readUInt16BE(offset + 7), data.readUInt16BE(offset + 5)); break; }
      offset += length + 2;
    }
    if (!size) throw new Error('JPEG incompleto: dimensioni non leggibili');
  } else if (data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    mimeType = 'image/webp'; const kind = data.toString('ascii', 12, 16);
    if (kind === 'VP8X') size = dimensions(data.readUIntLE(24, 3) + 1, data.readUIntLE(27, 3) + 1);
    else if (kind === 'VP8 ' && data[23] === 0x9d && data[24] === 1 && data[25] === 0x2a) size = dimensions(data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff);
    else if (kind === 'VP8L' && data[20] === 0x2f) { const bits = data.readUInt32LE(21); size = dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1); }
    if (!size) throw new Error('WebP incompleto: dimensioni non leggibili');
  } else {
    const svg = data.toString('utf8').replace(/^\uFEFF/, '');
    if (!/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(svg)) throw new Error('Formato non supportato: usa SVG, PNG, JPEG, WebP, GIF o BMP');
    // Uploaded SVGs are assets, never executable documents or external loaders.
    const references = [...svg.matchAll(/\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi)].map((match) => match[2]!.trim());
    const cssReferences = [...svg.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)].map((match) => match[2]!.trim());
    if (/<\s*(?:script|foreignObject|iframe|object|embed|audio|video)\b|<!DOCTYPE|<!ENTITY|\son[a-z]+\s*=|<\?xml-stylesheet|@import/i.test(svg)
      || /\b(?:href|src)\s*=\s*[^\s"']/i.test(svg)
      || references.some((reference) => !reference.startsWith('#') && !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(reference))
      || cssReferences.some((reference) => !reference.startsWith('#'))) throw new Error('SVG con contenuti attivi o risorse esterne: esporta un logo SVG autonomo');
    const tag = svg.match(/<svg\b[^>]*>/i)?.[0] ?? '';
    const viewBox = tag.match(/\bviewBox\s*=\s*["']\s*([-+\d.eE]+)[ ,]+([-+\d.eE]+)[ ,]+([-+\d.eE]+)[ ,]+([-+\d.eE]+)\s*["']/i);
    const width = tag.match(/\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i), height = tag.match(/\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i);
    if (viewBox) size = dimensions(Number(viewBox[3]), Number(viewBox[4]));
    else if (width && height) size = dimensions(Number(width[1]), Number(height[1]));
    else throw new Error('Il logo SVG richiede viewBox o dimensioni esplicite');
    mimeType = 'image/svg+xml';
  }
  const extension = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/gif': '.gif', 'image/bmp': '.bmp' } as Record<string, string>)[mimeType]!;
  const supplied = path.posix.basename(filename.replace(/\\/g, '/')).replace(/[\x00-\x1f<>:"|?*]/g, '-').slice(0, 180);
  const name = path.parse(supplied).name || 'logo';
  return { name, filename: `${name}${extension}`, mimeType, ...size, source: 'upload' };
}

const crcTable = Array.from({ length: 256 }, (_, value) => { let n = value; for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(data: Buffer): number { let n = 0xffffffff; for (const byte of data) n = crcTable[(n ^ byte) & 255]! ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; }
interface ZipEntry { name: string; data?: Buffer; error?: string }

/** Central-directory inspection + bounded inflate prevents path escapes and dishonest zip bombs. */
export function unpackHeaderFooterZip(data: Buffer): ZipEntry[] {
  if (data.length > HEADER_FOOTER_UPLOAD_LIMITS.batchBytes) throw new Error('ZIP oltre il limite di 50 MB');
  let end = -1;
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65557); offset--) if (data.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  if (end < 0 || data.readUInt16LE(end + 4) !== 0 || data.readUInt16LE(end + 6) !== 0) throw new Error('ZIP non valido o archivio multidisco non supportato');
  const count = data.readUInt16LE(end + 10), centralSize = data.readUInt32LE(end + 12); let offset = data.readUInt32LE(end + 16);
  if (count > HEADER_FOOTER_UPLOAD_LIMITS.entries || count === 0xffff || offset === 0xffffffff || offset + centralSize > end) throw new Error('ZIP oltre il limite di 128 elementi o struttura non supportata');
  const entries: ZipEntry[] = []; let total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) throw new Error('Indice ZIP non valido');
    const flags = data.readUInt16LE(offset + 8), method = data.readUInt16LE(offset + 10), expectedCrc = data.readUInt32LE(offset + 16);
    const compressed = data.readUInt32LE(offset + 20), expanded = data.readUInt32LE(offset + 24), nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30), commentLength = data.readUInt16LE(offset + 32), mode = data.readUInt32LE(offset + 38) >>> 16, local = data.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > data.length) throw new Error('Indice ZIP troncato');
    const name = data.toString('utf8', offset + 46, offset + 46 + nameLength).replace(/\\/g, '/'); offset = next;
    if (name.endsWith('/')) continue;
    try {
      if (!name || /[\x00-\x1f]/.test(name) || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..') || (mode & 0xf000) === 0xa000) throw new Error('Percorso o collegamento non consentito nel pacchetto');
      if (/\.zip$/i.test(name)) throw new Error('Gli ZIP annidati non vengono estratti');
      if (flags & 1 || ![0, 8].includes(method)) throw new Error('ZIP cifrato o metodo di compressione non supportato');
      if (expanded > HEADER_FOOTER_UPLOAD_LIMITS.fileBytes || total + expanded > HEADER_FOOTER_UPLOAD_LIMITS.batchBytes) throw new Error('Elemento oltre il limite di estrazione');
      if (local + 30 > data.length || data.readUInt32LE(local) !== 0x04034b50) throw new Error('Elemento ZIP non valido');
      const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
      if (start + compressed > data.length) throw new Error('Elemento ZIP troncato');
      const packed = data.subarray(start, start + compressed);
      const body = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.min(HEADER_FOOTER_UPLOAD_LIMITS.fileBytes, HEADER_FOOTER_UPLOAD_LIMITS.batchBytes - total) });
      if (body.length !== expanded || crc32(body) !== expectedCrc) throw new Error('Dimensione o controllo integrità ZIP non valido');
      total += body.length; entries.push({ name, data: body });
    } catch (error) { entries.push({ name, error: errorText(error) }); }
  }
  return entries;
}

/** No asset ever receives the ZIP itself. Immutable originals remain in the owning library archive. */
export async function collectHeaderFooterUploads<T>(uploads: HeaderFooterUpload[], saveAsset: HeaderFooterAssetSaver<T>, options: { archiveDirectory?: string } = {}): Promise<{ assets: T[]; errors: HeaderFooterUploadError[] }> {
  if (uploads.length > HEADER_FOOTER_UPLOAD_LIMITS.entries || uploads.reduce((sum, file) => sum + file.data.length, 0) > HEADER_FOOTER_UPLOAD_LIMITS.batchBytes) throw new Error('Carica al massimo 128 file e 50 MB per volta');
  const assets: T[] = [], errors: HeaderFooterUploadError[] = []; let count = 0, total = 0;
  for (const upload of uploads) {
    try {
      const zip = /\.zip$/i.test(upload.filename) || upload.data.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
      if (zip && options.archiveDirectory) {
        if (!path.isAbsolute(options.archiveDirectory)) throw new Error('Archive directory must derive from the resolved daemon root');
        await mkdir(options.archiveDirectory, { recursive: true });
        await writeFile(path.join(options.archiveDirectory, `${digest(upload.data)}.zip`), upload.data, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
      }
      const entries = zip ? unpackHeaderFooterZip(upload.data) : [{ name: upload.filename, data: upload.data }];
      for (const entry of entries) {
        const name = zip ? `${upload.filename}/${entry.name}` : entry.name;
        if (entry.error) { errors.push({ name, message: entry.error }); continue; }
        try {
          count++; total += entry.data!.length;
          if (count > HEADER_FOOTER_UPLOAD_LIMITS.entries || total > HEADER_FOOTER_UPLOAD_LIMITS.batchBytes) throw new Error('Limite del caricamento raggiunto');
          assets.push(await saveAsset(inspectHeaderFooterLogo(entry.name, entry.data!), entry.data!));
        } catch (error) { errors.push({ name, message: errorText(error) }); }
      }
    } catch (error) { errors.push({ name: upload.filename, message: errorText(error) }); }
  }
  return { assets, errors };
}
