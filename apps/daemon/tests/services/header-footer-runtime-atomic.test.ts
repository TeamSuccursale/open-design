import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeaderFooterBinding, ProjectDocument } from '@open-design/contracts';
import { closeDatabase, insertProject, openDatabase } from '../../src/db.js';
import { HeaderFooterRuntime } from '../../src/services/header-footer-runtime.js';
import { ProjectDocumentsRuntime } from '../../src/services/project-documents-runtime.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let root: string;
let runtime: HeaderFooterRuntime;
let document: ProjectDocument;
const previous = '{"version":1,"applied":"previous manifest"}\n';
const folder = () => path.join(document.workingDirectory, 'header-footer', document.id);
const manifest = () => readFile(path.join(folder(), 'applied.json'), 'utf8');
const binding = (): HeaderFooterBinding => ({ documentId: document.id, setId: null, followUpdates: false, header: false, footer: false, showOnCover: false,
  version: 1, appliedRevision: null, snapshot: null, status: 'disabled', updatedAt: '2026-10-26T10:00:00Z' });
const isManifest = (target: unknown) => path.basename(String(target)) === 'applied.json';
const locked = (code: string, message: string) => Object.assign(new Error(message), { code });
beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockReset().mockImplementation(actual.rename);
  root = await mkdtemp(path.join(tmpdir(), 'melillo-header-footer-runtime-atomic-'));
  const dataRoot = path.join(root, 'private'), projectRoot = path.join(root, 'project'), projectsRoot = path.join(dataRoot, 'projects');
  await mkdir(projectRoot); await mkdir(projectsRoot, { recursive: true });
  const db = openDatabase(root, { dataDir: dataRoot }); insertProject(db, { id: 'parent', name: 'Antro', metadata: { baseDir: projectRoot, kind: 'other' }, createdAt: 1, updatedAt: 1 });
  const documents = new ProjectDocumentsRuntime({ db, dataRoot, projectsRoot });
  runtime = new HeaderFooterRuntime({ db, dataRoot, projectsRoot, documents });
  document = (await (await documents.store('parent', projectRoot)).create({ name: 'Relazione B', kind: 'document' }, documents.bootstrapWorkspace)).document;
  await mkdir(folder(), { recursive: true }); await writeFile(path.join(folder(), 'applied.json'), previous);
});
afterEach(async () => { closeDatabase(); await rm(root, { recursive: true, force: true }); });

describe('atomic applied header/footer writes', () => {
  it('retries a transient Windows destination lock instead of leaving the binding pending', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const seen: string[] = [];
    let locks = 1;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (isManifest(to) && locks-- > 0) {
        seen.push(await manifest());
        throw locked('EPERM', 'EPERM: operation not permitted, rename');
      }
      return actual.rename(from, to);
    });
    await runtime.materialize(document, binding(), null);
    expect(seen).toEqual([previous]);
    expect(JSON.parse(await manifest())).toEqual({ version: 1, documentId: document.id, applied: null });
    expect(await readdir(folder())).toEqual(['applied.json']);
  });

  it('bounds lock retries, keeps the previous manifest and leaves no scratch file behind', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockClear().mockImplementation(async (from, to) => {
      if (isManifest(to)) throw locked('EACCES', 'Still locked');
      return actual.rename(from, to);
    });
    await expect(runtime.materialize(document, binding(), null)).rejects.toThrow('Still locked');
    expect(vi.mocked(rename).mock.calls.filter(([, to]) => isManifest(to))).toHaveLength(6);
    expect(await manifest()).toBe(previous);
    expect(await readdir(folder())).toEqual(['applied.json']);
  });
});
