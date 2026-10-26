import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BLOCKOUT_DOCUMENTS_PATH, blockoutComparisonFilePath, blockoutWorkspacePath, createBlockoutDocument, type ProjectMetadata } from '@open-design/contracts';
import { validateRunDeliverable } from '../src/run-deliverable-validation.js';
import { saveBlockoutWorkspace } from '../src/services/blockout-workspaces.js';
import { ProjectDocumentsStore, readProjectDocumentsSnapshot } from '../src/services/project-documents.js';
import { finalizeSuccessfulRunDeliverable } from '../src/artifacts/successful-run-deliverable-finalization.js';
import { diffRunArtifacts, snapshotProjectArtifacts } from '../src/run-artifact-fs.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function fixture(count = 1) {
  const projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'od-fast-blockout-delivery-'));
  roots.push(projectsRoot);
  const projectId = 'project-1', root = path.join(projectsRoot, projectId);
  await fs.mkdir(root);
  // A prior unrelated output must neither be accepted as this run's work nor
  // prevent delivery of a registered document in a Fast working chat.
  await fs.writeFile(path.join(root, 'other.html'), '<main>Previous unrelated output</main>');
  const documents = [];
  for (let index = 1; index <= count; index++) {
    const document = createBlockoutDocument();
    document.documentId = `document-${index}`; document.title = `Report ${index}`;
    await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: null });
    const entry = blockoutComparisonFilePath(document);
    await fs.mkdir(path.dirname(path.join(root, entry)), { recursive: true });
    await fs.writeFile(path.join(root, entry), '<main>Saved blockout comparison</main>');
    documents.push({ document, entry });
  }
  const projectMetadata = { kind: 'other' as const, projectMode: 'fast' as const };
  return { root, documents, input: { projectsRoot, projectId, projectMetadata,
    runStatus: 'succeeded' as const, artifactCount: count, touchedPaths: documents.map((item) => item.entry) } };
}

describe('Fast working-chat blockout delivery', () => {
  it('recognizes a current saved comparison among auxiliary artifacts without changing project metadata', async () => {
    const test = await fixture();
    await fs.mkdir(path.join(test.root, 'header-footer'));
    await fs.writeFile(path.join(test.root, 'header-footer', 'preview.html'), '<main>Band preview</main>');
    const metadata = structuredClone(test.input.projectMetadata);
    await expect(validateRunDeliverable({ ...test.input, artifactCount: 2,
      touchedPaths: [...test.input.touchedPaths, 'header-footer/preview.html'] }))
      .resolves.toMatchObject({ valid: true, validation: 'valid', entryFile: test.documents[0]!.entry, artifactKind: 'html' });
    expect(test.input.projectMetadata).toEqual(metadata);
  });

  it('checks both documents when one run delivers their separate comparisons', async () => {
    const test = await fixture(2);
    await expect(validateRunDeliverable(test.input)).resolves.toMatchObject({ valid: true, entryFile: test.documents[0]!.entry });
    await fs.unlink(path.join(test.root, test.documents[1]!.entry));
    await expect(validateRunDeliverable(test.input)).resolves.toMatchObject({ valid: false, validation: 'entry_missing' });
  });

  it('does not count an old comparison or an unregistered HTML file', async () => {
    const test = await fixture();
    await fs.writeFile(path.join(test.root, 'unregistered.html'), '<main>Unregistered</main>');
    for (const touchedPaths of [[], ['unregistered.html'], ['../outside.html']]) {
      expect((await validateRunDeliverable({ ...test.input, touchedPaths })).valid).toBe(false);
    }
  });

  it('retains an explicit project entry and keeps ordinary non-Fast validation strict', async () => {
    const test = await fixture();
    await expect(validateRunDeliverable({ ...test.input, projectMetadata: { ...test.input.projectMetadata, entryFile: 'missing.html' } }))
      .resolves.toMatchObject({ valid: false, validation: 'entry_missing' });
    expect((await validateRunDeliverable({ ...test.input, projectMetadata: { kind: 'other' } })).valid).toBe(false);
  });

  it('requires a succeeded run with current artifact evidence', async () => {
    const test = await fixture();
    await expect(validateRunDeliverable({ ...test.input, artifactCount: 0 })).resolves.toMatchObject({ valid: false, validation: 'no_artifact' });
    for (const runStatus of ['failed', 'canceled'] as const) {
      await expect(validateRunDeliverable({ ...test.input, runStatus })).resolves.toMatchObject({ valid: false, validation: 'not_succeeded' });
    }
  });

  it('does not infer a saved workspace from a comparison filename alone', async () => {
    const test = await fixture();
    await fs.writeFile(path.join(test.root, blockoutWorkspacePath(test.documents[0]!.document.documentId)), '{}');
    expect((await validateRunDeliverable(test.input)).valid).toBe(false);
  });

  it('rejects a comparison symlink outside the project', async () => {
    const test = await fixture(), target = path.join(test.root, test.documents[0]!.entry);
    const outside = path.join(test.input.projectsRoot, 'outside');
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, path.basename(target)), '<main>Outside project</main>');
    await fs.rename(path.dirname(target), `${path.dirname(target)}-original`);
    await fs.symlink(outside, path.dirname(target), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await validateRunDeliverable(test.input)).valid).toBe(false);
  });
});

async function registeredFixture(options: { count?: number; external?: boolean; shared?: boolean; normal?: boolean; legacy?: boolean } = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'od-fast-child-delivery-')); roots.push(temporary);
  const projectsRoot = path.join(temporary, 'projects'), dataRoot = path.join(temporary, 'runtime'), projectId = 'collection';
  const root = path.join(projectsRoot, projectId); await fs.mkdir(root, { recursive: true }); await fs.mkdir(dataRoot);
  await fs.writeFile(path.join(root, 'other.html'), '<main>Unrelated collection artifact</main>');
  const metadata: ProjectMetadata = { kind: 'other', ...(!options.normal ? { projectMode: 'fast' as const } : {}) };
  const projects = new Map<string, { id: string; metadata: ProjectMetadata }>([[projectId, { id: projectId, metadata }]]);
  const store = new ProjectDocumentsStore({ dataRoot, projectId, projectRoot: root });
  const documents = [];
  for (let index = 1; index <= (options.count ?? 1); index++) {
    const external = path.join(temporary, `external-${index}`); if (options.external) await fs.mkdir(external);
    const record = (await store.create({ name: `Registered report ${index}`, kind: 'document',
      ...(options.external || options.shared || options.legacy ? { location: { mode: 'link-existing' as const, path: options.shared || options.legacy ? root : external, authorized: true as const } } : {}) },
    async (input) => {
      if (options.legacy) return { workspaceProjectId: projectId, conversationId: `chat-${input.documentId}` };
      const id = `workspace-${input.documentId}`;
      projects.set(id, { id, metadata: { kind: 'other', ...(!options.normal ? { projectMode: 'fast' as const } : {}), baseDir: input.workingDirectory,
        collectionProjectId: projectId, collectionDocumentId: input.documentId } });
      return { workspaceProjectId: id, conversationId: `chat-${input.documentId}` };
    })).document;
    const document = createBlockoutDocument(); document.documentId = record.id; document.title = record.name;
    await saveBlockoutWorkspace(record.workingDirectory, record.id, { document, baseRaw: null });
    const entry = blockoutComparisonFilePath(document);
    await fs.mkdir(path.dirname(path.join(record.workingDirectory, entry)), { recursive: true });
    await fs.writeFile(path.join(record.workingDirectory, entry), '<main>Registered comparison</main>');
    await store.synchronize(record.id, { blockoutDocumentId: record.id, entryFile: entry });
    documents.push({ record, document, entry, alias: `documents/${record.id}/${entry}` });
  }
  const documentScope = { dataRoot, getProject: (id: string) => projects.get(id) };
  const input = { projectsRoot, projectId, projectMetadata: metadata, documentScope,
    runStatus: 'succeeded' as const, artifactCount: documents.length, touchedPaths: documents.map((item) => item.alias) };
  const registryFile = path.join(dataRoot, 'project-documents', (await fs.readdir(path.join(dataRoot, 'project-documents')))[0]!, 'registry.json');
  return { temporary, root, dataRoot, projectsRoot, projectId, projects, store, documents, input, registryFile };
}

describe('registered child Fast Blockout delivery', () => {
  it.each([false, true])('accepts the real absolute native diff under the authoritative run root (Normal=%s)', async (normal) => {
    const test = await registeredFixture({ normal, legacy: normal }), item = test.documents[0]!;
    const before = snapshotProjectArtifacts(test.root);
    await fs.appendFile(path.join(item.record.workingDirectory, item.entry), '<!-- current run -->');
    const diff = diffRunArtifacts(before, snapshotProjectArtifacts(test.root));
    expect(diff.touchedPaths).toEqual([path.join(item.record.workingDirectory, item.entry)]);
    await expect(validateRunDeliverable({ ...test.input, artifactCount: diff.touched, touchedPaths: diff.touchedPaths }))
      .resolves.toMatchObject({ valid: true, entryFile: normal ? item.entry : item.alias });
  });

  it('does not convert an outside absolute native path into a registered alias', async () => {
    const test = await registeredFixture({ external: true }), item = test.documents[0]!;
    await expect(validateRunDeliverable({ ...test.input, touchedPaths: [path.join(item.record.workingDirectory, item.entry)] }))
      .resolves.toMatchObject({ valid: false });
  });
  it('recognizes the Normal registered canonical output alongside supporting header/footer files', async () => {
    const test = await registeredFixture({ normal: true, legacy: true }), item = test.documents[0]!;
    await expect(validateRunDeliverable({ ...test.input, touchedPaths: [item.entry, 'header-footer/document-1/preview.html'] }))
      .resolves.toMatchObject({ valid: true, entryFile: item.entry, artifactKind: 'html' });
    await expect(validateRunDeliverable({ ...test.input, touchedPaths: ['header-footer/document-1/preview.html'] }))
      .resolves.toMatchObject({ valid: false });
  });

  it('requires a persisted registry association for Normal canonical comparisons', async () => {
    const test = await fixture();
    const dataRoot = path.join(test.input.projectsRoot, 'runtime');
    await expect(validateRunDeliverable({ ...test.input, projectMetadata: { kind: 'other' },
      documentScope: { dataRoot, getProject: (id: string) => ({ id, metadata: { kind: 'other' } }) } }))
      .resolves.toMatchObject({ valid: false });
    await expect(fs.stat(dataRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('also validates registered child aliases in Normal projects under the same owner checks', async () => {
    const test = await registeredFixture({ normal: true });
    await expect(validateRunDeliverable(test.input)).resolves.toMatchObject({ valid: true, entryFile: test.documents[0]!.alias });
  });

  it.each([false, true])('uses the same registered owner scope during physical-run finalization (Normal=%s)', async (normal) => {
    const test = await registeredFixture({ normal, legacy: normal }), item = test.documents[0]!;
    const touched = normal ? item.entry : item.alias;
    const before = await fs.readFile(path.join(item.record.workingDirectory, item.entry), 'utf8');
    await expect(finalizeSuccessfulRunDeliverable({ ...test.input, touchedPaths: [touched], processTreeQuiescent: true }))
      .resolves.toMatchObject({ deliverable: { valid: true, entryFile: touched, artifactKind: 'html' } });
    expect(await fs.readFile(path.join(item.record.workingDirectory, item.entry), 'utf8')).toBe(before);
  });

  it('recognizes the exact nested child path observed in a parent run, without registry mutations', async () => {
    const test = await registeredFixture(), item = test.documents[0]!;
    const registryBefore = await fs.readdir(path.join(test.dataRoot, 'project-documents'), { recursive: true });
    const snapshotsBefore = await readProjectDocumentsSnapshot(test.dataRoot, test.projectId);
    const contentBefore = await fs.readFile(test.registryFile, 'utf8'), mtimeBefore = (await fs.stat(test.registryFile)).mtimeMs;
    await expect(validateRunDeliverable(test.input)).resolves.toMatchObject({ valid: true, entryFile: item.alias, artifactKind: 'html' });
    expect(await readProjectDocumentsSnapshot(test.dataRoot, test.projectId)).toEqual(snapshotsBefore);
    expect(await fs.readdir(path.join(test.dataRoot, 'project-documents'), { recursive: true })).toEqual(registryBefore);
    expect(await fs.readFile(test.registryFile, 'utf8')).toBe(contentBefore);
    expect((await fs.stat(test.registryFile)).mtimeMs).toBe(mtimeBefore);
  });

  it('validates original unaliased paths in the owning child and in a registered shared root', async () => {
    const test = await registeredFixture(), item = test.documents[0]!, owner = test.projects.get(item.record.workspaceProjectId)!;
    await expect(validateRunDeliverable({ ...test.input, projectId: owner.id, projectMetadata: owner.metadata, touchedPaths: [item.entry] }))
      .resolves.toMatchObject({ valid: true, entryFile: item.entry });
    const shared = await registeredFixture({ shared: true }), sharedItem = shared.documents[0]!;
    await expect(validateRunDeliverable({ ...shared.input, touchedPaths: [sharedItem.entry] })).resolves.toMatchObject({ valid: true, entryFile: sharedItem.entry });
  });

  it('retains a registered original comparison path after the saved document title changes', async () => {
    const test = await registeredFixture(), item = test.documents[0]!;
    const target = path.join(item.record.workingDirectory, blockoutWorkspacePath(item.record.id));
    const raw = await fs.readFile(target, 'utf8');
    await saveBlockoutWorkspace(item.record.workingDirectory, item.record.id, { document: { ...item.document, title: 'Renamed report' }, baseRaw: raw });
    await expect(validateRunDeliverable(test.input)).resolves.toMatchObject({ valid: true, entryFile: item.alias });
  });

  it('checks every current child comparison and rejects a missing one', async () => {
    const test = await registeredFixture({ count: 2 });
    expect((await validateRunDeliverable(test.input)).valid).toBe(true);
    const missing = test.documents[1]!; await fs.unlink(path.join(missing.record.workingDirectory, missing.entry));
    await expect(validateRunDeliverable(test.input)).resolves.toMatchObject({ valid: false, validation: 'entry_missing' });
  });

  it.each(['workspace missing', 'catalog missing', 'catalog omits owner', 'workspace malformed'] as const)('does not let a valid sibling hide a delivered registered child with %s', async (problem) => {
    const test = await registeredFixture({ count: 2 }), broken = test.documents[1]!;
    if (problem === 'workspace missing') await fs.unlink(path.join(broken.record.workingDirectory, blockoutWorkspacePath(broken.record.id)));
    if (problem === 'workspace malformed') await fs.writeFile(path.join(broken.record.workingDirectory, blockoutWorkspacePath(broken.record.id)), '{}');
    if (problem === 'catalog missing') await fs.unlink(path.join(broken.record.workingDirectory, BLOCKOUT_DOCUMENTS_PATH));
    if (problem === 'catalog omits owner') await fs.writeFile(path.join(broken.record.workingDirectory, BLOCKOUT_DOCUMENTS_PATH), JSON.stringify({ version: 1, documents: [] }));
    await expect(validateRunDeliverable(test.input)).resolves.toMatchObject({ valid: false, validation: 'entry_missing', entryFile: broken.alias });
    // Unrelated supporting output under that same alias is not a delivery
    // claim for its registered entry and cannot break the good sibling.
    await expect(validateRunDeliverable({ ...test.input, touchedPaths: [test.documents[0]!.alias, `documents/${broken.record.id}/header-footer/preview.html`] }))
      .resolves.toMatchObject({ valid: true, entryFile: test.documents[0]!.alias });
  });

  it('requires exact current touched evidence, not stale output or a sibling path under the wrong alias', async () => {
    const test = await registeredFixture({ count: 2 }), first = test.documents[0]!, second = test.documents[1]!;
    for (const touchedPaths of [[], ['header-footer/preview.html'], [`documents/${first.record.id}/${second.entry}`], [`documents/unknown/${first.entry}`], [`documents/${first.record.id}/../${first.entry}`], [path.join(test.temporary, 'outside', first.entry)]]) {
      expect((await validateRunDeliverable({ ...test.input, touchedPaths })).valid).toBe(false);
    }
    const owner = test.projects.get(first.record.workspaceProjectId)!;
    expect((await validateRunDeliverable({ ...test.input, projectId: owner.id, projectMetadata: owner.metadata,
      touchedPaths: [second.entry] })).valid).toBe(false);
  });

  it('rejects archived records and changed child ownership metadata', async () => {
    const test = await registeredFixture(), item = test.documents[0]!, owner = test.projects.get(item.record.workspaceProjectId)!;
    owner.metadata.collectionProjectId = 'other-collection';
    expect((await validateRunDeliverable(test.input)).valid).toBe(false);
    owner.metadata.collectionProjectId = test.projectId; owner.metadata.collectionDocumentId = 'sibling';
    expect((await validateRunDeliverable(test.input)).valid).toBe(false);
    owner.metadata.collectionDocumentId = item.record.id;
    await test.store.update(item.record.id, { archived: true });
    expect((await validateRunDeliverable(test.input)).valid).toBe(false);
  });

  it('keeps both parent and child explicit entry precedence', async () => {
    const test = await registeredFixture(), item = test.documents[0]!, owner = test.projects.get(item.record.workspaceProjectId)!;
    await expect(validateRunDeliverable({ ...test.input, projectMetadata: { ...test.input.projectMetadata, entryFile: 'missing.html' } }))
      .resolves.toMatchObject({ valid: false, validation: 'entry_missing' });
    owner.metadata.entryFile = 'missing.html';
    await expect(validateRunDeliverable(test.input)).resolves.toMatchObject({ valid: false, validation: 'entry_missing' });
    owner.metadata.entryFile = 'index.html'; await fs.writeFile(path.join(item.record.workingDirectory, 'index.html'), '<main>Untouched entry</main>');
    await expect(validateRunDeliverable(test.input)).resolves.toMatchObject({ valid: false, validation: 'entry_not_touched' });
  });

  it('honors an imported owning project root outside the parent without accepting a fabricated parent alias', async () => {
    const test = await registeredFixture({ external: true }), item = test.documents[0]!, owner = test.projects.get(item.record.workspaceProjectId)!;
    expect((await validateRunDeliverable(test.input)).valid).toBe(false);
    await expect(validateRunDeliverable({ ...test.input, projectId: owner.id, projectMetadata: owner.metadata, touchedPaths: [item.entry] }))
      .resolves.toMatchObject({ valid: true, entryFile: item.entry });
    owner.metadata.baseDir = test.root;
    expect((await validateRunDeliverable(test.input)).valid).toBe(false);
  });

  it('validates an imported owner without repairing its missing registry link or changing registry metadata', async () => {
    const test = await registeredFixture({ external: true }), item = test.documents[0]!, owner = test.projects.get(item.record.workspaceProjectId)!;
    await fs.unlink(item.record.aliasPath!);
    const content = await fs.readFile(test.registryFile, 'utf8'), mtime = (await fs.stat(test.registryFile)).mtimeMs;
    await expect(validateRunDeliverable({ ...test.input, projectId: owner.id, projectMetadata: owner.metadata, touchedPaths: [item.entry] }))
      .resolves.toMatchObject({ valid: true });
    expect(await fs.readFile(test.registryFile, 'utf8')).toBe(content); expect((await fs.stat(test.registryFile)).mtimeMs).toBe(mtime);
    await expect(fs.lstat(item.record.aliasPath!)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a changed registered directory and nested comparison symlink escapes', async () => {
    const test = await registeredFixture(), item = test.documents[0]!;
    const outside = path.join(test.temporary, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'blockout-comparison.html'), '<main>Outside</main>');
    await fs.rename(path.dirname(path.join(item.record.workingDirectory, item.entry)), `${path.dirname(path.join(item.record.workingDirectory, item.entry))}-original`);
    await fs.symlink(outside, path.dirname(path.join(item.record.workingDirectory, item.entry)), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await validateRunDeliverable(test.input)).valid).toBe(false);
    const replaced = await registeredFixture(), replacedItem = replaced.documents[0]!;
    await fs.rename(replacedItem.record.workingDirectory, `${replacedItem.record.workingDirectory}-original`);
    await fs.symlink(outside, replacedItem.record.workingDirectory, process.platform === 'win32' ? 'junction' : 'dir');
    expect((await validateRunDeliverable(replaced.input)).valid).toBe(false);
  });
});
