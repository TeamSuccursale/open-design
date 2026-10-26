import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectIntakeService } from '../../src/services/project-intake.js';

vi.mock('node:child_process', async (original) => ({ ...(await original<typeof import('node:child_process')>()), spawn: vi.fn() }));

class HeldRender extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  kill = vi.fn();
  finish() { this.stdout.write(JSON.stringify({ pageCount: 0, pages: [] })); this.emit('close', 0); }
}
let root: string, project: string, oldSource: string, newSource: string;
let service: ProjectIntakeService, render: HeldRender;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'melillo-active-intake-'));
  project = path.join(root, 'project'); oldSource = path.join(root, 'existing-reference'); newSource = path.join(root, 'new-reference');
  await Promise.all([project, oldSource, newSource].map((directory) => mkdir(directory)));
  await writeFile(path.join(project, 'source.pdf'), 'Held render fixture; no real image or model analysis');
  render = new HeldRender(); vi.mocked(spawn).mockReturnValue(render as never);
  service = new ProjectIntakeService();
  await service.configure(project, { version: 1, sourceDirs: [oldSource], outputDir: 'prepared/figures' });
});
afterEach(async () => {
  render.finish();
  await vi.waitFor(async () => {
    const catalog = JSON.parse(await readFile(path.join(project, 'intake-assets', 'catalog.json'), 'utf8')) as { documents: Array<{ status: string }> };
    expect(catalog.documents.every((document) => document.status !== 'queued' && document.status !== 'processing')).toBe(true);
  });
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('source additions during background intake', () => {
  it('allows adding sources without restarting active work and rejects source removal or output changes', async () => {
    await service.start(project, { paths: ['source.pdf'] });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    expect((await service.catalog(project)).documents[0]?.status).toBe('processing');
    const sources = [oldSource, newSource];
    await expect(service.configure(project, { version: 1, sourceDirs: sources, outputDir: 'prepared/figures' })).resolves.toMatchObject({ sourceDirs: [await realpath(oldSource), await realpath(newSource)], outputDir: 'prepared/figures' });
    expect(spawn).toHaveBeenCalledOnce();
    await expect(service.configure(project, { version: 1, sourceDirs: [newSource], outputDir: 'prepared/figures' })).rejects.toThrow('Wait for intake');
    await expect(service.configure(project, { version: 1, sourceDirs: sources, outputDir: 'different-output' })).rejects.toThrow('Wait for intake');
    expect(await service.settings(project)).toMatchObject({ sourceDirs: [await realpath(oldSource), await realpath(newSource)], outputDir: 'prepared/figures' });
    expect((await service.catalog(project)).documents[0]?.status).toBe('processing');
  });
});
