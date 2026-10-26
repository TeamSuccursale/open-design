import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blockoutComparisonFilePath, createBlockoutDocument, type ProjectMetadata, type ProjectDocumentWorkspaceBootstrap } from '@open-design/contracts';
import { blockoutHandoffDisplayName, loadBlockoutContext, prepareBlockoutContextFiles, renderFrozenBlockoutContext } from '../../src/services/blockout-context.js';
import { readBlockoutWorkspace, saveBlockoutWorkspace, saveBlockoutWorkspaceStartingPoint } from '../../src/services/blockout-workspaces.js';
import { ProjectDocumentsStore } from '../../src/services/project-documents.js';
import type { BlockoutDesignRunTarget } from '../../src/services/blockout-design.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'melillo-blockout-context-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe('private saved blockout brief', () => {
  it('uses a bounded human Blockout name, with a neutral fallback instead of a JSON filename', () => {
    expect(blockoutHandoffDisplayName('Relazione tecnica')).toBe('Blockout · Relazione tecnica');
    expect(blockoutHandoffDisplayName(' \n\t ')).toBe('Blockout');
    expect(blockoutHandoffDisplayName('Report\nB')).toBe('Blockout · Report B');
    expect(blockoutHandoffDisplayName('x'.repeat(300))).toHaveLength(251);
  });
  it('does not select an old collection-wide snapshot, even when it is malformed', async () => {
    expect(await loadBlockoutContext(root)).toContain('No saved Blockout editing target');
    await mkdir(path.join(root, 'blockout')); await writeFile(path.join(root, 'blockout/starting-point.json'), '{broken');
    expect(await loadBlockoutContext(root)).toContain('No saved Blockout editing target');
    expect(await readFile(path.join(root, 'blockout/starting-point.json'), 'utf8')).toBe('{broken');
  });
  it('freezes answered page expectations without public JSON attachments', async () => {
    const doc = createBlockoutDocument(); doc.variants[0]!.pages[0]!.expectation = 'Preserve the engineer’s source drawing.';
    doc.answers.push({ formId: 'hierarchy', target: { pageId: 'page-1' }, answers: { hierarchy: 'image_first' }, answeredAt: '2026-10-23T12:07:10Z' });
    const saved = await saveBlockoutWorkspace(root, doc.documentId, { document: doc, baseRaw: null });
    const files = await prepareBlockoutContextFiles(root, [], doc.documentId);
    expect(files).toHaveLength(1); expect(files[0]).toMatch(/^blockout\/\.context\/[a-f0-9]+\.txt$/);
    expect(await prepareBlockoutContextFiles(root, [], doc.documentId)).toEqual(files);
    const frozen = [{ mediaType: 'text/plain', content: await readFile(path.join(root, files[0]!)) }];
    expect(renderFrozenBlockoutContext(frozen)).toContain('image_first');
    expect(renderFrozenBlockoutContext(frozen)).toContain('Preserve the engineer');
    doc.variants[0]!.pages[0]!.expectation = 'Changed after the run began';
    await saveBlockoutWorkspace(root, doc.documentId, { document: doc, baseRaw: saved.raw });
    expect(renderFrozenBlockoutContext(frozen)).not.toContain('Changed after the run began');
  });
  it('resolves the editing conversation’s own workspace instead of the global last-selected document', async () => {
    const first = createBlockoutDocument(); first.documentId = 'report'; first.title = 'Report A4';
    first.variants[0]!.pages[0]!.expectation = 'REPORT ONLY';
    const second = createBlockoutDocument(); second.documentId = 'drawings'; second.title = 'Drawings A3';
    second.variants[0]!.pages[0]!.expectation = 'DRAWINGS ONLY';
    await saveBlockoutWorkspace(root, 'report', { document: first, baseRaw: null, startingPoint: true });
    await saveBlockoutWorkspace(root, 'drawings', { document: second, baseRaw: null });
    const scoped = await loadBlockoutContext(root, [], 'drawings');
    expect(scoped).toContain('DRAWINGS ONLY'); expect(scoped).not.toContain('REPORT ONLY');
    expect(await loadBlockoutContext(root)).not.toContain('REPORT ONLY');
    expect(await loadBlockoutContext(root, [], 'missing')).toBe('');
    const files = await prepareBlockoutContextFiles(root, [], 'drawings');
    const frozen = renderFrozenBlockoutContext([{ mediaType: 'text/plain', content: await readFile(path.join(root, files[0]!)) }]);
    expect(frozen).toContain('DRAWINGS ONLY'); expect(frozen).not.toContain('REPORT ONLY');
  });

  it('uses the latest selected local proposal for an exact comparison target and ignores referenced files as targets', async () => {
    const document = createBlockoutDocument(); document.title = 'Normal report';
    document.variants[0]!.pages[0]!.feedback = 'STALE BASE';
    document.variants.push({ ...structuredClone(document.variants[0]!), id: 'edited', label: 'Edited selected proposal' });
    document.selectedVariantId = 'edited'; document.variants[1]!.pages[0]!.feedback = 'CURRENT SAVED FEEDBACK';
    await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: null, startingPoint: true });
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'blockout-context-registry-'));
    try {
      const scope = { projectId: 'normal', dataRoot, projectsRoot: path.dirname(root), editTargetFile: blockoutComparisonFilePath(document), getProject: (id: string) => id === 'normal' ? { id, metadata: { baseDir: root } } : null };
      const context = await loadBlockoutContext(root, [], undefined, scope);
      expect(context).toContain('CURRENT SAVED FEEDBACK'); expect(context).not.toContain('STALE BASE');
      expect(context).toContain('"workspaceProjectId":"normal"');
      expect(context).toContain('append-alternatives');
      const { editTargetFile: _target, ...unbound } = scope;
      const referencesOnly = await loadBlockoutContext(root, [blockoutComparisonFilePath(document)], undefined, unbound);
      expect(referencesOnly).toContain('No saved Blockout editing target'); expect(referencesOnly).not.toContain('CURRENT SAVED FEEDBACK');
    } finally { await rm(dataRoot, { recursive: true, force: true }); }
  });
});

async function collectionFixture(linked = false) {
  const projectRoot = path.join(root, 'parent'), dataRoot = path.join(root, 'private'), external = path.join(root, 'external');
  await Promise.all([mkdir(projectRoot), mkdir(dataRoot), mkdir(external)]);
  const projects = new Map<string, { id: string; metadata: Partial<ProjectMetadata> }>([['parent', { id: 'parent', metadata: { baseDir: projectRoot } }]]);
  const store = new ProjectDocumentsStore({ dataRoot, projectId: 'parent', projectRoot });
  const bootstrap = async (input: ProjectDocumentWorkspaceBootstrap) => {
    const id = `child-${input.documentId}`;
    projects.set(id, { id, metadata: { baseDir: input.workingDirectory, collectionProjectId: 'parent', collectionDocumentId: input.documentId } });
    return { workspaceProjectId: id };
  };
  const record = (await store.create({ name: 'Fast report', kind: 'document', ...(linked ? { location: { mode: 'link-existing' as const, path: external, authorized: true as const } } : {}) }, bootstrap)).document;
  const document = createBlockoutDocument(); document.documentId = record.id; document.title = record.name;
  document.variants[0]!.pages[0]!.feedback = 'LATEST FAST FEEDBACK';
  const saved = await saveBlockoutWorkspace(record.workingDirectory, record.id, { document, baseRaw: null });
  const entryFile = blockoutComparisonFilePath(document); await store.synchronize(record.id, { blockoutDocumentId: record.id, entryFile });
  const handoff = await saveBlockoutWorkspaceStartingPoint(record.workingDirectory, record.id, { document, baseRaw: saved.raw, requestId: 'fast-request',
    operation: { type: 'append-alternatives', count: 1, instruction: 'One alternative from the saved blocks' } });
  const scope = { projectId: 'parent', dataRoot, projectsRoot: path.join(dataRoot, 'projects'), getProject: (id: string) => projects.get(id) };
  return { projectRoot, record, document, handoff, scope, projects };
}

describe('registered child Blockout owner context', () => {
  it('emits exact design authority only after resolving an attached child design handoff', async () => {
    const test = await collectionFixture(), targets: BlockoutDesignRunTarget[] = [];
    const current = await readBlockoutWorkspace(test.record.workingDirectory, test.record.id);
    current.document!.approval = { variantId: 'brief', acceptedAt: '2026-10-26T10:00:00Z' };
    const approved = await saveBlockoutWorkspace(test.record.workingDirectory, test.record.id, { document: current.document, baseRaw: current.raw });
    const handoff = await saveBlockoutWorkspaceStartingPoint(test.record.workingDirectory, test.record.id,
      { document: approved.document, baseRaw: approved.raw, requestId: 'design-child', action: 'develop-design' });
    const packet = `documents/${test.record.id}/${handoff.path}`;
    const scope = { ...test.scope, authorize: async () => true, onDesignHandoff: (target: BlockoutDesignRunTarget) => { targets.push(target); } };
    await loadBlockoutContext(test.projectRoot, [packet], undefined, scope);
    expect(targets).toEqual([{ projectId: test.record.workspaceProjectId, documentId: test.record.id, handoffId: 'design-child',
      handoffSha256: createHash('sha256').update(await readFile(path.join(test.record.workingDirectory, handoff.path), 'utf8')).digest('hex') }]);
    targets.length = 0;
    await loadBlockoutContext(test.projectRoot, [`documents/${test.record.id}/${test.handoff.path}`], undefined, scope);
    expect(targets).toEqual([]);
    await expect(loadBlockoutContext(test.projectRoot, [packet], undefined, { ...scope, authorize: async () => false })).rejects.toThrow('not authorized');
    expect(targets).toEqual([]);
  });
  it.each([false, true])('resolves exact nested edit target and immutable packet for a %s linked document without relying on parent file existence', async (linked) => {
    const test = await collectionFixture(linked), authorized: string[] = [];
    const names: Array<[string, string]> = [];
    const scope = { ...test.scope, authorize: async (id: string) => { authorized.push(id); return true; }, onHandoff: (file: string, title: string) => { names.push([file, title]); } };
    const target = `documents/${test.record.id}/${blockoutComparisonFilePath(test.document)}`;
    const context = await loadBlockoutContext(test.projectRoot, [], undefined, { ...scope, editTargetFile: target });
    expect(context).toContain('LATEST FAST FEEDBACK'); expect(context).toContain(`"workspaceProjectId":"${test.record.workspaceProjectId}"`);
    expect(authorized).toContain(test.record.workspaceProjectId);
    const packet = `documents/${test.record.id}/${test.handoff.path}`;
    const files = await prepareBlockoutContextFiles(test.projectRoot, [packet], undefined, scope);
    const frozen = renderFrozenBlockoutContext([{ mediaType: 'text/plain', content: await readFile(path.join(test.projectRoot, files[0]!)) }]);
    expect(frozen).toContain('fast-request'); expect(frozen).toContain('One alternative from the saved blocks');
    expect(frozen).toContain(`"workspaceProjectId":"${test.record.workspaceProjectId}"`);
    expect(frozen).toContain('"count": 1'); expect(files).not.toContain(packet);
    expect(names).toEqual([[packet, 'Fast report']]);
    const current = await readBlockoutWorkspace(test.record.workingDirectory, test.record.id);
    current.document!.variants[0]!.pages[0]!.feedback = 'EDITED AFTER FREEZE';
    await saveBlockoutWorkspace(test.record.workingDirectory, test.record.id, { document: current.document, baseRaw: current.raw });
    expect(frozen).not.toContain('EDITED AFTER FREEZE');
  });

  it('rejects denied child ownership, mismatched packet identity and another named conversation', async () => {
    const test = await collectionFixture();
    const packet = `documents/${test.record.id}/${test.handoff.path}`;
    const names: string[] = [];
    await expect(loadBlockoutContext(test.projectRoot, [packet], undefined, { ...test.scope, authorize: async () => false, onHandoff: (_file, title) => { names.push(title); } })).rejects.toThrow('not authorized');
    expect(names).toEqual([]);
    await expect(loadBlockoutContext(test.projectRoot, [packet], 'another-document', test.scope)).rejects.toThrow('another document conversation');
    await expect(loadBlockoutContext(test.projectRoot, [`documents/not-registered/${test.handoff.path}`], undefined, test.scope)).rejects.toThrow('no authorized registered owner');
    test.projects.get(test.record.workspaceProjectId)!.metadata.collectionDocumentId = 'different-record';
    await expect(loadBlockoutContext(test.projectRoot, [packet], undefined, test.scope)).rejects.toThrow('ownership mismatch');
  });
});
