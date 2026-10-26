import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectDocumentsStore, readProjectDocumentsSnapshot } from '../../src/services/project-documents.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'od-documents-readonly-')); roots.push(root);
  const projectRoot = path.join(root, 'project'), dataRoot = path.join(root, 'runtime'), linked = path.join(root, 'external');
  await Promise.all([fs.mkdir(projectRoot), fs.mkdir(dataRoot), fs.mkdir(linked)]);
  const store = new ProjectDocumentsStore({ projectId: 'collection', projectRoot, dataRoot });
  const record = (await store.create({ name: 'Linked report', kind: 'document', location: { mode: 'link-existing', path: linked, authorized: true } },
    async (input) => ({ workspaceProjectId: `workspace-${input.documentId}`, conversationId: 'conversation' }))).document;
  const registryRoot = path.join(dataRoot, 'project-documents', (await fs.readdir(path.join(dataRoot, 'project-documents')))[0]!);
  return { root, projectRoot, dataRoot, store, record, registryRoot, registryFile: path.join(registryRoot, 'registry.json') };
}

describe('read-only document registry snapshot', () => {
  it('does not create a missing data root or seed a registry', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'od-documents-missing-')); roots.push(root);
    const dataRoot = path.join(root, 'absent');
    expect(await readProjectDocumentsSnapshot(dataRoot, 'collection')).toEqual([]);
    await expect(fs.stat(dataRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await fs.mkdir(dataRoot);
    expect(await readProjectDocumentsSnapshot(dataRoot, 'collection')).toEqual([]);
    expect(await fs.readdir(dataRoot)).toEqual([]);
  });

  it('reads persisted records without rewriting the registry or repairing a linked alias', async () => {
    const test = await fixture();
    await fs.unlink(test.record.aliasPath!);
    const before = await fs.readFile(test.registryFile, 'utf8'), info = await fs.stat(test.registryFile);
    expect(await readProjectDocumentsSnapshot(test.dataRoot, 'collection')).toEqual([expect.objectContaining({ id: test.record.id, workspaceProjectId: test.record.workspaceProjectId })]);
    expect(await fs.readFile(test.registryFile, 'utf8')).toBe(before);
    expect((await fs.stat(test.registryFile)).mtimeMs).toBe(info.mtimeMs);
    await expect(fs.lstat(test.record.aliasPath!)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains the existing registry ownership/parser checks', async () => {
    const test = await fixture(), registry = JSON.parse(await fs.readFile(test.registryFile, 'utf8'));
    registry.documents[0].projectId = 'other-collection';
    await fs.writeFile(test.registryFile, JSON.stringify(registry));
    await expect(readProjectDocumentsSnapshot(test.dataRoot, 'collection')).rejects.toThrow('Invalid document registry ownership');
  });

  it('does not follow a replaced registry directory through a junction or symlink', async () => {
    const test = await fixture(), outside = path.join(test.root, 'outside-registry');
    await fs.rename(test.registryRoot, outside);
    await fs.symlink(outside, test.registryRoot, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(readProjectDocumentsSnapshot(test.dataRoot, 'collection')).rejects.toThrow();
  });
});
