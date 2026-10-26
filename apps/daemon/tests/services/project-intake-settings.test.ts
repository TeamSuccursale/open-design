import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { intakeSettings, readIntakeConfig, resolveIntakeSource, writeIntakeConfig } from '../../src/services/project-intake-settings.js';
import { ProjectIntakeService } from '../../src/services/project-intake.js';
let root: string, project: string, source: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'melillo-intake-folders-'));
  project = path.join(root, 'project'); source = path.join(root, 'reference library');
  await mkdir(project); await mkdir(source);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe('portable intake folder configuration', () => {
  it('persists one discoverable config and preserves existing catalog/image paths when output changes', async () => {
    await mkdir(path.join(project, 'intake-assets'));
    const catalog = JSON.stringify({ version: 1, documents: [], assets: [{ imagePath: 'intake-assets/old.png' }] });
    await writeFile(path.join(project, 'intake-assets/catalog.json'), catalog);
    const settings = await writeIntakeConfig(project, { version: 1, sourceDirs: [source, source], outputDir: 'library/figures' });
    expect(settings.sourceDirs).toEqual([await realpath(source)]);
    expect(settings.outputPath).toBe(path.join(await realpath(project), 'library/figures'));
    expect(await readIntakeConfig(project)).toMatchObject({ outputDir: 'library/figures' });
    expect(await readFile(settings.catalogPath, 'utf8')).toBe(catalog);
    expect(JSON.parse(await readFile(settings.configPath, 'utf8'))).toEqual({ version: 1, sourceDirs: [await realpath(source)], outputDir: 'library/figures' });
  });
  it('reads an external PDF only after its folder is registered and rejects a symlink escape', async () => {
    const pdf = path.join(source, 'drawing.pdf'); await writeFile(pdf, 'PDF');
    const config = { version: 1 as const, sourceDirs: [], outputDir: 'intake-assets' };
    await expect(resolveIntakeSource(project, pdf, config)).rejects.toThrow('registered');
    const saved = await writeIntakeConfig(project, { ...config, sourceDirs: [source] });
    expect(await resolveIntakeSource(project, pdf, saved)).toBe(await realpath(pdf));
    const outside = path.join(root, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'private.pdf'), 'PDF');
    await symlink(outside, path.join(source, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(resolveIntakeSource(project, path.join(source, 'link/private.pdf'), saved)).rejects.toThrow('registered');
  });
  it('rejects output escapes before creating directories or changing the existing config', async () => {
    await writeIntakeConfig(project, { version: 1, sourceDirs: [], outputDir: 'intake-assets' });
    await symlink(source, path.join(project, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(writeIntakeConfig(project, { version: 1, sourceDirs: [], outputDir: 'escape/new' })).rejects.toThrow('inside the project');
    await expect(writeIntakeConfig(project, { version: 1, sourceDirs: [], outputDir: '../outside' })).rejects.toThrow('inside the project');
    expect((await intakeSettings(project)).outputDir).toBe('intake-assets');
  });
  it('scans registered folders and deduplicates already indexed PDFs without changing originals', async () => {
    const bytes = 'already indexed external PDF', id = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
    await writeFile(path.join(source, 'drawing.pdf'), bytes);
    await writeIntakeConfig(project, { version: 1, sourceDirs: [source], outputDir: 'library/figures' });
    await mkdir(path.join(project, 'intake-assets'));
    await writeFile(path.join(project, 'intake-assets/catalog.json'), JSON.stringify({ version: 1, documents: [{ id, sourcePath: path.join(source, 'drawing.pdf'), status: 'ready', indexedPages: [1], pageCount: 1 }], assets: [] }));
    expect((await new ProjectIntakeService().start(project, {})).documents).toHaveLength(1);
    expect(await readFile(path.join(source, 'drawing.pdf'), 'utf8')).toBe(bytes);
  });
  it('discovers project PDFs, UI-uploaded PDFs and registered references together while preserving saved output settings', async () => {
    await mkdir(path.join(project, 'context-documents'));
    await mkdir(path.join(project, 'intake-assets'));
    const inputs = [
      { file: path.join(project, 'from-codex.pdf'), sourcePath: 'from-codex.pdf', bytes: 'Already indexed PDF supplied in the working folder' },
      { file: path.join(project, 'context-documents', 'from-ui.pdf'), sourcePath: 'context-documents/from-ui.pdf', bytes: 'Already indexed PDF uploaded through the UI' },
      { file: path.join(source, 'reference.pdf'), sourcePath: path.join(source, 'reference.pdf'), bytes: 'Already indexed PDF supplied by an additional source folder' },
    ];
    const documents = await Promise.all(inputs.map(async (input) => {
      await writeFile(input.file, input.bytes);
      return { id: createHash('sha256').update(input.bytes).digest('hex').slice(0, 24), sourcePath: input.sourcePath, name: path.basename(input.file), status: 'ready', pageCount: 1, completedPages: 1, indexedPages: [1], updatedAt: '2026-10-23T12:00:00Z' };
    }));
    await writeFile(path.join(project, 'intake-assets/catalog.json'), JSON.stringify({ version: 1, documents, assets: [] }));
    await writeIntakeConfig(project, { version: 1, sourceDirs: [source], outputDir: 'saved-gallery/figures' });
    const service = new ProjectIntakeService();
    const result = await service.start(project, {});
    expect(result.documents).toHaveLength(3);
    expect(result.documents.map((document) => document.sourcePath)).toEqual(documents.map((document) => document.sourcePath));
    expect(result.documents.every((document) => document.status === 'ready')).toBe(true);
    expect(await service.settings(project)).toMatchObject({ sourceDirs: [await realpath(source)], outputDir: 'saved-gallery/figures' });
    for (const input of inputs) expect(await readFile(input.file, 'utf8')).toBe(input.bytes);
  });
  it('reports an invalid config instead of silently reverting to defaults', async () => {
    await writeFile(path.join(project, 'intake.config.json'), '{broken');
    await expect(intakeSettings(project)).rejects.toThrow();
  });
});
