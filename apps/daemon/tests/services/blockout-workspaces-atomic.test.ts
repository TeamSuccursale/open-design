import { mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listBlockoutWorkspaces, saveBlockoutCatalog } from '../../src/services/blockout-workspaces.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let root: string;
const catalog = (title: string) => ({ version: 1, documents: [{ id: 'document-1', title: 'Relazione B' }, { id: 'document-2', title }] });
beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockReset().mockImplementation(actual.rename);
  root = await mkdtemp(path.join(tmpdir(), 'melillo-blockout-atomic-'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('atomic Blockout workspace writes', () => {
  it('retries a transient Windows destination lock instead of failing the save', async () => {
    await saveBlockoutCatalog(root, catalog('Fascicolo grafico B'));
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const seen: string[] = [];
    vi.mocked(rename).mockImplementationOnce(async () => {
      seen.push((await listBlockoutWorkspaces(root)).documents[1]!.title);
      throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
    }).mockImplementation(actual.rename);
    await saveBlockoutCatalog(root, catalog('Fascicolo grafico B — tavole'));
    expect(seen).toEqual(['Fascicolo grafico B']);
    expect((await listBlockoutWorkspaces(root)).documents[1]!.title).toBe('Fascicolo grafico B — tavole');
    expect(await readdir(path.join(root, 'blockouts'))).toEqual(['.documents.json']);
  });

  it('bounds lock retries, keeps the previous file and leaves no scratch file behind', async () => {
    await saveBlockoutCatalog(root, catalog('Fascicolo grafico B'));
    vi.mocked(rename).mockClear().mockRejectedValue(Object.assign(new Error('Still locked'), { code: 'EACCES' }));
    await expect(saveBlockoutCatalog(root, catalog('rejected'))).rejects.toThrow('Still locked');
    expect(rename).toHaveBeenCalledTimes(6);
    expect((await listBlockoutWorkspaces(root)).documents[1]!.title).toBe('Fascicolo grafico B');
    expect(await readdir(path.join(root, 'blockouts'))).toEqual(['.documents.json']);
  });
});
