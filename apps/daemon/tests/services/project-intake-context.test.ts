import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadIntakeAttachmentContext, prepareIntakeContextFiles, renderFrozenIntakeContext } from '../../src/services/project-intake-context.js';
import { buildOdNextTaskConfigurationV1, createOdNextTaskInputSnapshot, createOdNextRunInputProjection, loadOdNextTaskInputSnapshot, removeOdNextRunInputProjection } from '../../src/strategies/od-next/task-input-snapshot.js';
import { preferIntakeVector } from '../../src/services/project-intake-vectors.js';
import { ProjectIntakeService } from '../../src/services/project-intake.js';
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'melillo-private-context-'));
  await mkdir(path.join(root, 'project/intake-assets'), { recursive: true });
  await writeFile(path.join(root, 'project/intake-assets/figure.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  await writeFile(path.join(root, 'project/intake-assets/catalog.json'), JSON.stringify({ version: 1, documents: [], assets: [{ id: 'figure', title: 'Map', imagePath: 'intake-assets/figure.png', sourcePath: 'original/site.pdf', page: 3, box: [0, 0, 1000, 1000], kind: 'drawing', status: 'ready', description: 'Source description', tags: ['site map'] }] }));
});
afterEach(async () => {
  async function writable(target: string): Promise<void> {
    await chmod(target, 0o700);
    for (const entry of await readdir(target, { withFileTypes: true })) {
      const child = path.join(target, entry.name);
      if (entry.isDirectory()) await writable(child); else await chmod(child, 0o600);
    }
  }
  await writable(root); await rm(root, { recursive: true, force: true });
});
describe('private intake attachment context', () => {
  it('makes source metadata available to ordinary runtime prompts without altering visible attachments', async () => {
    const attachments = ['intake-assets/figure.png'];
    const text = await loadIntakeAttachmentContext(path.join(root, 'project'), attachments);
    expect(text).toContain('original/site.pdf');
    expect(text).toContain('"pdfPage": 3');
    expect(attachments).toEqual(['intake-assets/figure.png']);
    expect(await loadIntakeAttachmentContext(path.join(root, 'project'), ['not-this-asset.png'])).toBe('');
  });
  it('freezes the same private context into OD Next input files for request and production runs', async () => {
    const projectRoot = path.join(root, 'project'), snapshotsRoot = path.join(root, 'snapshots');
    await mkdir(path.join(projectRoot, 'designs/vector/figure'), { recursive: true });
    await writeFile(path.join(projectRoot, 'designs/vector/figure/v1.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><text>Preferred vector</text></svg>');
    const asset = (await new ProjectIntakeService().catalog(projectRoot)).assets[0]!;
    await preferIntakeVector(projectRoot, asset, { versionId: asset.vectorVersions![0]!.id, reason: 'Readable labels' });
    const originalAttachments = ['intake-assets/figure.png'];
    const files = await prepareIntakeContextFiles(projectRoot, originalAttachments);
    expect(files).toHaveLength(2);
    const taskConfiguration = buildOdNextTaskConfigurationV1({ taskType: 'prototype', locale: 'it', selectedAgentId: 'codex', sessionMode: 'design', mediaExecution: { mode: 'enabled' } });
    const descriptor = createOdNextTaskInputSnapshot({ projectRoot, snapshotsRoot, uploadRoot: root, taskExecutionId: 'vector-test', taskConfiguration, projectAttachments: [...originalAttachments, ...files] });
    const frozen = loadOdNextTaskInputSnapshot(descriptor, snapshotsRoot);
    expect(frozen.files.some((file) => file.content.toString('utf8').includes('original/site.pdf'))).toBe(true);
    expect(frozen.files.some((file) => file.content.toString('utf8').includes('Preferred vector'))).toBe(true);
    expect(frozen.imagePaths).toHaveLength(1);
    expect(frozen.imagePaths[0]).toMatch(/\.png$/);
    const inline = renderFrozenIntakeContext(frozen.files);
    expect(inline).toContain('name="intake-svg-workflow"');
    expect(inline).toContain('name="intake-source-reference"');
    expect(inline).toContain('original/site.pdf');
    expect(inline).toContain('Readable labels');
    expect(inline).toContain('suggestedSvgPath');
    const projection = createOdNextRunInputProjection({ descriptor, snapshotsRoot, projectionsRoot: path.join(root, 'projections'), runId: 'intake-vision' });
    expect(projection.imagePaths).toHaveLength(1);
    expect(await readFile(projection.imagePaths[0]!)).toEqual(await readFile(path.join(projectRoot, 'intake-assets/figure.png')));
    removeOdNextRunInputProjection(projection);
    expect(originalAttachments).toEqual(['intake-assets/figure.png']);
    expect(await readFile(path.join(projectRoot, files[0]!), 'utf8')).toContain('native SVG geometry and editable text');
  });
});
