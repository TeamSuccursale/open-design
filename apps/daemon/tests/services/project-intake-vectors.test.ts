import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IntakeAsset } from '@open-design/contracts';
import { ProjectIntakeService } from '../../src/services/project-intake.js';
import { preferIntakeVector, registerIntakeVector } from '../../src/services/project-intake-vectors.js';
import { loadIntakeAttachmentContext, prepareIntakeContextFiles } from '../../src/services/project-intake-context.js';

let root: string;
const source: IntakeAsset = { id: 'table', documentId: 'doc', sourcePath: 'original/source.pdf', sourceName: 'source.pdf', page: 3, box: [0, 0, 1000, 1000], imagePath: 'intake-assets/source.png', width: 100, height: 100, kind: 'table', title: 'Source table', description: 'Two rows', tags: [], status: 'ready' };
const svg = (text: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="10" y="30">${text}</text></svg>`;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'melillo-vectors-'));
  await mkdir(path.join(root, 'intake-assets'));
  await mkdir(path.join(root, 'designs/vector/table'), { recursive: true });
  await writeFile(path.join(root, 'intake-assets/catalog.json'), JSON.stringify({ version: 1, documents: [], assets: [source] }));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const asset = async () => (await new ProjectIntakeService().catalog(root)).assets[0]!;

describe('source-linked SVG versions and user preference', () => {
  it('discovers real saved SVGs, links them to the source and preserves all earlier versions', async () => {
    await writeFile(path.join(root, 'designs/vector/table/v1.svg'), svg('First'));
    await writeFile(path.join(root, 'designs/vector/table/v2.svg'), svg('Second'));
    await writeFile(path.join(root, 'designs/vector/table/incomplete.svg'), '<svg>');
    const result = await asset();
    expect(result.vectorVersions?.map((version) => version.path)).toEqual(['designs/vector/table/v1.svg', 'designs/vector/table/v2.svg']);
    expect(result.vectorPreference).toBeUndefined();
    expect(JSON.parse(await readFile(path.join(root, 'intake-assets/catalog.json'), 'utf8')).assets[0]).toEqual(source);
    expect(await readFile(path.join(root, result.vectorVersions![0]!.path), 'utf8')).toContain('First');
  });
  it('persists a preferred exact version and explanation across service restart, and supplies them privately for source or SVG attachments', async () => {
    await writeFile(path.join(root, 'designs/vector/table/v1.svg'), svg('First'));
    const version = (await asset()).vectorVersions![0]!;
    await preferIntakeVector(root, source, { versionId: version.id, reason: 'The column headings are clearer' });
    const reread = await asset();
    expect(reread.vectorPreference).toMatchObject({ versionId: version.id, reason: 'The column headings are clearer', path: version.path, available: true });
    for (const selected of [source.imagePath, version.path]) {
      const context = await loadIntakeAttachmentContext(root, [selected]);
      expect(context).toContain('The column headings are clearer');
      expect(context).toContain(version.path);
      expect(context).toContain('original/source.pdf');
    }
    expect(await prepareIntakeContextFiles(root, [source.imagePath])).toContain(version.path);
    await preferIntakeVector(root, source, { versionId: null });
    expect((await asset()).vectorPreference).toBeUndefined();
  });
  it('requires a new user choice after editing or removing the preferred file', async () => {
    const file = path.join(root, 'designs/vector/table/v1.svg');
    await writeFile(file, svg('First'));
    const first = (await asset()).vectorVersions![0]!;
    await preferIntakeVector(root, source, { versionId: first.id, reason: 'Readable' });
    await writeFile(file, svg('Edited'));
    expect((await asset()).vectorPreference?.available).toBe(false);
    await expect(preferIntakeVector(root, source, { versionId: first.id, reason: 'Stale' })).rejects.toThrow('changed');
    await unlink(file);
    expect((await asset()).vectorPreference).toMatchObject({ reason: 'Readable', available: false });
  });
  it('registers an existing file elsewhere and recognizes the first shortcut’s legacy path', async () => {
    await mkdir(path.join(root, 'drawings'));
    await writeFile(path.join(root, 'drawings/my-table.svg'), svg('Existing'));
    const result = await registerIntakeVector(root, source, { path: 'drawings/my-table.svg', label: 'Editorial table' });
    expect(result.vectorVersions?.[0]).toMatchObject({ label: 'Editorial table', path: 'drawings/my-table.svg' });
    await writeFile(path.join(root, 'designs/vector/table.svg'), svg('Legacy'));
    expect((await asset()).vectorVersions).toHaveLength(2);
  });
  it('rejects escaping paths, raster SVGs and preferences without explanations', async () => {
    await expect(registerIntakeVector(root, source, { path: '../outside.svg' })).rejects.toThrow();
    await writeFile(path.join(root, 'raster.svg'), '<svg><image href="data:image/png;base64,AA"/></svg>');
    await expect(registerIntakeVector(root, source, { path: 'raster.svg' })).rejects.toThrow('native vector');
    await expect(preferIntakeVector(root, source, { versionId: 'missing', reason: '' })).rejects.toThrow('Explain');
  });
  it('does not follow a version-folder junction outside the project', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'melillo-vector-outside-'));
    try {
      await writeFile(path.join(outside, 'v1.svg'), svg('External'));
      await symlink(outside, path.join(root, 'designs/vector/escape'), process.platform === 'win32' ? 'junction' : 'dir');
      await expect(registerIntakeVector(root, source, { path: 'designs/vector/escape/v1.svg' })).rejects.toThrow('inside');
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});
