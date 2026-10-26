import { mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readIntakeConfig, writeIntakeConfig } from '../../src/services/project-intake-settings.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let root: string;
const config = (outputDir: string) => ({ version: 1, sourceDirs: [], outputDir });
beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockReset().mockImplementation(actual.rename);
  root = await mkdtemp(path.join(tmpdir(), 'melillo-config-atomic-'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('atomic intake settings writes', () => {
  it('serializes concurrent saves with distinct temporary files and returns each saved value', async () => {
    const outputs = Array.from({ length: 10 }, (_, index) => `figures-${index}`);
    const results = await Promise.all(outputs.map((output) => writeIntakeConfig(root, config(output))));
    expect(results.map((result) => result.outputDir)).toEqual(outputs);
    expect(outputs).toContain((await readIntakeConfig(root)).outputDir);
    const temporary = vi.mocked(rename).mock.calls.map(([source]) => String(source));
    expect(new Set(temporary).size).toBe(outputs.length);
    expect(await readdir(root)).toEqual(['intake.config.json']);
  });

  it('retries transient Windows destination locks while readers retain valid settings', async () => {
    await writeIntakeConfig(root, config('original'));
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const seen: string[] = [];
    vi.mocked(rename).mockImplementationOnce(async () => {
      seen.push(JSON.parse(await readFile(path.join(root, 'intake.config.json'), 'utf8')).outputDir);
      throw Object.assign(new Error('Locked'), { code: 'EPERM' });
    }).mockImplementationOnce(async () => {
      seen.push((await readIntakeConfig(root)).outputDir);
      throw Object.assign(new Error('Busy'), { code: 'EBUSY' });
    }).mockImplementation(actual.rename);
    expect((await writeIntakeConfig(root, config('updated'))).outputDir).toBe('updated');
    expect(seen).toEqual(['original', 'original']);
    expect(await readdir(root)).toEqual(['intake.config.json']);
  });

  it('bounds lock retries, preserves the old file, cleans scratch files and allows a later save', async () => {
    await writeIntakeConfig(root, config('original'));
    vi.mocked(rename).mockClear().mockRejectedValue(Object.assign(new Error('Still locked'), { code: 'EACCES' }));
    await expect(writeIntakeConfig(root, config('rejected'))).rejects.toThrow('Still locked');
    expect(rename).toHaveBeenCalledTimes(6);
    expect((await readIntakeConfig(root)).outputDir).toBe('original');
    expect(await readdir(root)).toEqual(['intake.config.json']);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockImplementation(actual.rename);
    expect((await writeIntakeConfig(root, config('recovered'))).outputDir).toBe('recovered');
  });
});
