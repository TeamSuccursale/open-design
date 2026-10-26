import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocumentWorkspaceBootstrap } from '@open-design/contracts';
import { ProjectDocumentsStore, readProjectDocumentsSnapshot } from '../../src/services/project-documents.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let root: string;
let dataRoot: string;
let store: ProjectDocumentsStore;
const bootstrap = async (input: ProjectDocumentWorkspaceBootstrap) => ({ workspaceProjectId: input.workspaceProjectId ?? `workspace-${input.documentId}`, conversationId: `chat-${input.documentId}` });
const names = async () => (await readProjectDocumentsSnapshot(dataRoot, 'parent')).map((document) => document.name);
const registry = async () => path.join(await realpath(dataRoot), 'project-documents', createHash('sha256').update('parent').digest('hex'));
const isRegistry = (target: unknown) => path.basename(String(target)) === 'registry.json';
const locked = (code: string, message: string) => Object.assign(new Error(message), { code });
beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockReset().mockImplementation(actual.rename);
  root = await mkdtemp(path.join(tmpdir(), 'melillo-documents-atomic-'));
  const projectRoot = path.join(root, 'project'); dataRoot = path.join(root, 'private');
  await mkdir(projectRoot); await mkdir(dataRoot);
  store = new ProjectDocumentsStore({ dataRoot, projectId: 'parent', projectRoot });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('atomic project document registry writes', () => {
  it('retries a transient Windows destination lock instead of failing the save', async () => {
    const { document } = await store.create({ name: 'Relazione B', kind: 'document' }, bootstrap);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const seen: string[][] = [];
    let locks = 1;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (isRegistry(to) && locks-- > 0) {
        seen.push(await names());
        throw locked('EPERM', 'EPERM: operation not permitted, rename');
      }
      return actual.rename(from, to);
    });
    expect((await store.update(document.id, { name: 'Relazione B — tavole' }, bootstrap)).document.name).toBe('Relazione B — tavole');
    expect(seen).toEqual([['Relazione B']]);
    expect(await names()).toEqual(['Relazione B — tavole']);
    expect((await readdir(await registry())).sort()).toEqual(['links', 'registry.json']);
  });

  it('bounds lock retries, keeps the previous registry and leaves no scratch file behind', async () => {
    const { document } = await store.create({ name: 'Relazione B', kind: 'document' }, bootstrap);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockClear().mockImplementation(async (from, to) => {
      if (isRegistry(to)) throw locked('EACCES', 'Still locked');
      return actual.rename(from, to);
    });
    await expect(store.update(document.id, { name: 'Relazione B — tavole' }, bootstrap)).rejects.toThrow('Still locked');
    expect(vi.mocked(rename).mock.calls.filter(([, to]) => isRegistry(to))).toHaveLength(6);
    expect(await names()).toEqual(['Relazione B']);
    expect((await readdir(await registry())).sort()).toEqual(['links', 'registry.json']);
  });
});
