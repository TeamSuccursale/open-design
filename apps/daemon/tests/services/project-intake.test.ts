import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { intakeProjectFile, ProjectIntakeService } from '../../src/services/project-intake.js';
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'melillo-intake-test-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('project-local intake boundary', () => {
  it('rejects paths outside the project and accepts contained files', async () => {
    const project = path.join(root, 'project'); await mkdir(project);
    await writeFile(path.join(root, 'outside.pdf'), 'private'); await writeFile(path.join(project, 'inside.pdf'), 'inside');
    await expect(intakeProjectFile(project, '../outside.pdf')).rejects.toThrow('inside the project');
    await expect(intakeProjectFile(project, path.join(root, 'outside.pdf'))).rejects.toThrow('project-relative');
    expect(await intakeProjectFile(project, 'inside.pdf')).toBe(await realpath(path.join(project, 'inside.pdf')));
  });
  it('does not enqueue a partial batch when another input is invalid', async () => {
    await writeFile(path.join(root, 'valid.pdf'), 'not rendered in this validation test');
    const service = new ProjectIntakeService();
    await expect(service.start(root, { paths: ['valid.pdf', 'unexpected.txt'] })).rejects.toThrow('PDF documents');
    expect((await service.catalog(root)).documents).toEqual([]);
  });
  it('shares one catalog for simultaneous reads and exposes interrupted jobs for retry', async () => {
    await mkdir(path.join(root, 'intake-assets'));
    await writeFile(path.join(root, 'intake-assets/catalog.json'), JSON.stringify({ version: 1, documents: [{ id: 'doc', status: 'processing', indexedPages: [2] }], assets: [] }));
    const service = new ProjectIntakeService();
    const [one, two] = await Promise.all([service.catalog(root), service.catalog(root)]);
    expect(one).toEqual(two);
    expect(one.documents[0]).toMatchObject({ status: 'failed', indexedPages: [2] });
  });
  it('does not silently replace a corrupt catalog with an empty one', async () => {
    await mkdir(path.join(root, 'intake-assets')); await writeFile(path.join(root, 'intake-assets/catalog.json'), 'invalid');
    await expect(new ProjectIntakeService().catalog(root)).rejects.toThrow();
    expect(await readFile(path.join(root, 'intake-assets/catalog.json'), 'utf8')).toBe('invalid');
  });
  it('rejects a catalog reached through a directory link outside the project', async () => {
    const project = path.join(root, 'project'), outside = path.join(root, 'outside');
    await mkdir(project); await mkdir(outside);
    await writeFile(path.join(outside, 'catalog.json'), JSON.stringify({ version: 1, documents: [], assets: [] }));
    await symlink(outside, path.join(project, 'intake-assets'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(new ProjectIntakeService().catalog(project)).rejects.toThrow('inside the project');
  });
  it('recognizes identical document content and skips pages already indexed', async () => {
    const bytes = 'known document bytes', id = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
    await writeFile(path.join(root, 'document.pdf'), bytes); await mkdir(path.join(root, 'intake-assets'));
    await writeFile(path.join(root, 'intake-assets/catalog.json'), JSON.stringify({ version: 1, documents: [{ id, sourcePath: 'document.pdf', status: 'ready', pageCount: 10, completedPages: 1, indexedPages: [5] }], assets: [] }));
    const result = await new ProjectIntakeService().start(root, { paths: ['document.pdf'], pages: [5] });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({ status: 'ready', completedPages: 1, indexedPages: [5] });
  });
});
