import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listHeaderFooterSourceFiles, readHeaderFooterSourceFiles } from '../../src/services/header-footer-sources.js';

const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
const logo = '<svg viewBox="0 0 80 20"><rect width="80" height="20"/></svg>';
describe('logos already supplied to the project', () => {
  it('offers selected source images and ZIPs without treating them as imported assets or scanning galleries', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'header-footer-sources-')); folders.push(root);
    const selected = path.join(root, 'sources'), gallery = path.join(selected, 'intake-assets'); await mkdir(gallery, { recursive: true });
    await writeFile(path.join(selected, 'loghi.zip'), 'zip'); await writeFile(path.join(selected, 'logo.svg'), logo); await writeFile(path.join(selected, 'rules.pdf'), 'pdf'); await writeFile(path.join(gallery, 'unrelated.png'), 'image');
    const listed = await listHeaderFooterSourceFiles([selected, selected]);
    expect(listed.truncated).toBe(false); expect(listed.files.map((item) => item.name).sort()).toEqual(['loghi.zip', 'logo.svg']);
    expect(JSON.stringify(listed)).not.toContain(root); expect(listed.files.every((item) => /^[a-f0-9]{64}$/.test(item.id))).toBe(true);
    expect(await readHeaderFooterSourceFiles([selected], [listed.files.find((item) => item.name === 'logo.svg')!.id])).toEqual([{ filename: 'logo.svg', data: Buffer.from(logo) }]);
  });
  it('cannot import a file from a deselected root or an unknown opaque ID', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'header-footer-source-scope-')); folders.push(root);
    const source = path.join(root, 'source'), other = path.join(root, 'other'); await mkdir(source); await mkdir(other); await writeFile(path.join(source, 'logo.svg'), logo);
    const id = (await listHeaderFooterSourceFiles([source])).files[0]!.id;
    await expect(readHeaderFooterSourceFiles([other], [id])).rejects.toThrow('non è più disponibile');
    await expect(readHeaderFooterSourceFiles([source], ['a'.repeat(64)])).rejects.toThrow('non è più disponibile');
  });
  it('does not traverse linked source subfolders', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'header-footer-source-link-')); folders.push(root);
    const source = path.join(root, 'source'), outside = path.join(root, 'outside'); await mkdir(source); await mkdir(outside); await writeFile(path.join(outside, 'logo.svg'), logo);
    await symlink(outside, path.join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await listHeaderFooterSourceFiles([source])).files).toEqual([]);
  });
});
