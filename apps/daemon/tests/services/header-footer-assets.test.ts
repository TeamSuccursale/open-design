import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { collectHeaderFooterUploads, inspectHeaderFooterLogo, unpackHeaderFooterZip } from '../../src/services/header-footer-assets.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80"><path d="M0 0h240v80H0z" fill="#175b49"/></svg>');

describe('header/footer logo collection', () => {
  it('keeps vector bytes intact and measures the logo independently of an untrusted extension', async () => {
    const results: Buffer[] = [];
    const result = await collectHeaderFooterUploads([{ filename: '../../marca.exe', data: svg }], async (metadata, data) => { results.push(data); return metadata; });
    expect(result.errors).toEqual([]);
    expect(result.assets).toEqual([{ name: 'marca', filename: 'marca.svg', mimeType: 'image/svg+xml', width: 240, height: 80, source: 'upload' }]);
    expect(results[0]).toEqual(svg);
    expect(inspectHeaderFooterLogo('gradient.svg', Buffer.from('<svg viewBox="0 0 20 20"><defs><linearGradient id="g"/></defs><path fill="url(\'#g\')" d="M0 0h20v20z"/></svg>')).mimeType).toBe('image/svg+xml');
  });
  it('rejects executable, externally dependent and dimensionless SVGs without invoking persistence', async () => {
    for (const body of ['<script>alert(1)</script>', '<image href="https://example.com/image.png"/>', '<path onload="alert(1)"/>', '<foreignObject/>', '<style>@import "https://example.com/a.css";</style>']) {
      expect(() => inspectHeaderFooterLogo('logo.svg', Buffer.from(`<svg viewBox="0 0 20 20">${body}</svg>`))).toThrow('contenuti attivi');
    }
    expect(() => inspectHeaderFooterLogo('logo.svg', Buffer.from('<svg><path/></svg>'))).toThrow('viewBox');
    expect(() => inspectHeaderFooterLogo('logo.png', Buffer.from('<html>not an image</html>'))).toThrow('Formato non supportato');
  });
  it('extracts supported ZIP entries, reports each unsupported/unsafe entry, and archives the original package', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'melillo-logo-assets-')); temporary.push(directory);
    const zip = new JSZip();
    zip.file('logos/marca.svg', svg); zip.file('../escape.svg', svg); zip.file('readme.txt', 'Logo notes'); zip.file('nested.zip', Buffer.from('PK')); zip.file('linked.svg', 'logo.svg', { unixPermissions: 0o120777 });
    const data = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX', compression: 'DEFLATE' });
    const result = await collectHeaderFooterUploads([{ filename: 'identita.zip', data }], async (metadata) => metadata, { archiveDirectory: directory });
    expect(result.assets.map((asset) => asset.filename)).toEqual(['marca.svg']);
    expect(result.errors).toHaveLength(4);
    expect(result.errors.map((error) => error.message).join(' ')).toMatch(/Percorso/);
    const archived = await readdir(directory);
    expect(archived).toHaveLength(1); expect(archived[0]).toMatch(/^[a-f0-9]{64}\.zip$/);
    expect(await readFile(path.join(directory, archived[0]!))).toEqual(data);
    await collectHeaderFooterUploads([{ filename: 'identita.zip', data }], async (metadata) => metadata, { archiveDirectory: directory });
    expect(await readdir(directory)).toEqual(archived);
  });
  it('bounds inflated data even when a ZIP lies about its expanded size', async () => {
    const zip = new JSZip(); zip.file('big.svg', 'x'.repeat(13 * 1024 * 1024));
    const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); data.writeUInt32LE(10, central + 24);
    const entries = unpackHeaderFooterZip(data);
    expect(entries).toHaveLength(1); expect(entries[0]!.data).toBeUndefined(); expect(entries[0]!.error).toBeTruthy();
  });
  it('measures PNG and WebP headers and rejects oversized dimensions', () => {
    const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(320, 16); png.writeUInt32BE(120, 20);
    expect(inspectHeaderFooterLogo('logo.png', png)).toMatchObject({ width: 320, height: 120, mimeType: 'image/png' });
    png.writeUInt32BE(1_000_000, 16); expect(() => inspectHeaderFooterLogo('logo.png', png)).toThrow('Dimensioni');
    const webp = Buffer.alloc(30); webp.write('RIFF', 0); webp.write('WEBP', 8); webp.write('VP8X', 12); webp.writeUIntLE(319, 24, 3); webp.writeUIntLE(119, 27, 3);
    expect(inspectHeaderFooterLogo('logo.webp', webp)).toMatchObject({ width: 320, height: 120, mimeType: 'image/webp' });
  });
});
