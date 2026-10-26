import { mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeaderFooterStore, type HeaderFooterStoreOptions } from '../../src/services/header-footer.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let root: string;
let options: HeaderFooterStoreOptions;
const isLibrary = (target: unknown) => path.basename(String(target)) === 'library.json';
const locked = (code: string, message: string) => Object.assign(new Error(message), { code });
async function registry(store: HeaderFooterStore) { return path.dirname(await store.assetDirectory()); }
async function draftName(store: HeaderFooterStore) {
  return (JSON.parse(await readFile(path.join(await registry(store), 'library.json'), 'utf8')) as { sets: { draft: { name: string } }[] }).sets[0]!.draft.name;
}
beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockReset().mockImplementation(actual.rename);
  root = await mkdtemp(path.join(tmpdir(), 'melillo-header-footer-atomic-'));
  const projectRoot = path.join(root, 'project'), dataRoot = path.join(root, 'private');
  await mkdir(projectRoot); await mkdir(dataRoot);
  options = { dataRoot, projectRoot, projectId: 'parent', documents: async () => [] };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('atomic header/footer library writes', () => {
  it('retries a transient Windows destination lock instead of failing the save', async () => {
    const store = new HeaderFooterStore(options), created = await store.create({ name: 'Studio' });
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const seen: string[] = [];
    let locks = 1;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (isLibrary(to) && locks-- > 0) {
        seen.push(await draftName(store));
        throw locked('EPERM', 'EPERM: operation not permitted, rename');
      }
      return actual.rename(from, to);
    });
    await store.saveDraft(created.set.id, { expectedDraftVersion: 1, draft: { ...created.set.draft, name: 'Studio Antro' } });
    expect(seen).toEqual(['Studio']);
    expect((await new HeaderFooterStore(options).list()).sets[0]!.draft.name).toBe('Studio Antro');
    expect((await readdir(await registry(store))).sort()).toEqual(['assets', 'library.json', 'recovery', 'revisions']);
  });

  it('bounds lock retries, keeps the previous library and leaves no scratch file behind', async () => {
    const store = new HeaderFooterStore(options), created = await store.create({ name: 'Studio' });
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockClear().mockImplementation(async (from, to) => {
      if (isLibrary(to)) throw locked('EACCES', 'Still locked');
      return actual.rename(from, to);
    });
    await expect(store.saveDraft(created.set.id, { expectedDraftVersion: 1, draft: { ...created.set.draft, name: 'Studio Antro' } })).rejects.toThrow('Still locked');
    expect(vi.mocked(rename).mock.calls.filter(([, to]) => isLibrary(to))).toHaveLength(6);
    expect(await draftName(store)).toBe('Studio');
    expect((await readdir(await registry(store))).sort()).toEqual(['assets', 'library.json', 'recovery', 'revisions']);
  });
});
