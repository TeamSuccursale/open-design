import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { blockoutPageFiles, createBlockoutDocument, createBlockoutPage } from '@open-design/contracts';
import { listFiles } from '../../src/projects.js';
import { saveBlockoutWorkspace } from '../../src/services/blockout-workspaces.js';
import { visibleBlockoutFiles } from '../../src/services/blockout-visible-files.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const projects = await mkdtemp(path.join(tmpdir(), 'blockout-visible-')); roots.push(projects);
  const root = path.join(projects, 'project-1'); await mkdir(root);
  return { root, list: () => listFiles(projects, 'project-1') };
}

describe('setup seed visibility in the shared project file listing', () => {
  it('keeps design bookkeeping out of the file panel without hiding unrelated JSON', async () => {
    const files = ['blockouts/report/design/state.json', 'documents/report/blockouts/report/design/revisions/one/page.html', 'settings.json'].map((name) => ({ name, size: 0 }));
    expect((await visibleBlockoutFiles('unused', files)).map((file) => file.name)).toEqual(['settings.json']);
  });
  it('keeps the 8 A4 + 4 A3 page seeds recoverable without presenting thirteen premature Blockout files', async () => {
    const { root, list } = await fixture();
    for (const [documentId, count] of [['document-1', 8], ['graphics', 4]] as const) {
      const document = createBlockoutDocument(); document.documentId = documentId;
      document.variants[0]!.pages = Array.from({ length: count }, (_, index) => ({
        ...createBlockoutPage(`page-${index + 1}`, `Pagina ${index + 1}`),
        ...(documentId === 'graphics' ? { widthMm: 420, heightMm: 297 } : {}),
      }));
      await saveBlockoutWorkspace(root, documentId, { document, baseRaw: null });
      expect(JSON.parse(await readFile(path.join(root, blockoutPageFiles(document)[0]!.path), 'utf8')).type).toBe('blockout-page');
    }
    await writeFile(path.join(root, 'instructions.txt'), 'User source');
    expect((await list()).map((file) => file.name)).toEqual(['instructions.txt']);
    expect(JSON.parse(await readFile(path.join(root, 'blockout/layout.json'), 'utf8')).variants[0].pages).toHaveLength(8);
  });

  it('reveals a real structural proposal as soon as its first block is saved', async () => {
    const { root, list } = await fixture(), document = createBlockoutDocument();
    const seed = await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: null });
    document.variants[0]!.pages[0]!.blocks.push({ id: 'body', label: 'Body text', kind: 'text',
      box: { x: 10, y: 10, width: 80, height: 70, rotation: 0 }, images: [], references: [],
      expectation: 'Written technical explanation', feedback: '', flexibility: 'guided', lockRatio: false });
    await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: seed.raw });
    expect((await list()).map((file) => file.name)).toEqual(expect.arrayContaining(['blockout/layout.json', 'blockouts/document-1/page-1.blockout.json']));
  });

  it('preserves independently changed page files and unrelated JSON next to an empty seed', async () => {
    const { root, list } = await fixture(), document = createBlockoutDocument();
    await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: null });
    const page = blockoutPageFiles(document)[0]!;
    await writeFile(path.join(root, page.path), page.content.replace('"feedback": ""', '"feedback": "User edit"'));
    await writeFile(path.join(root, 'blockouts/document-1/user-notes.json'), '{}');
    expect((await list()).map((file) => file.name)).toEqual(expect.arrayContaining([page.path, 'blockouts/document-1/user-notes.json']));
  });

  it.each(['legacy', 'selected', 'feedback', 'alternative'] as const)('keeps %s empty layouts available', async (mode) => {
    const { root, list } = await fixture(), document = createBlockoutDocument();
    if (mode === 'legacy') delete document.planningStage;
    if (mode === 'selected') document.selectedVariantId = 'brief';
    if (mode === 'feedback') document.variants[0]!.pages[0]!.feedback = 'Keep this page empty';
    if (mode === 'alternative') { document.variants[0]!.id = 'proposal-one'; document.activeVariantId = 'proposal-one'; }
    await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: null });
    expect((await list()).map((file) => file.name)).toContain('blockout/layout.json');
  });

  it('leaves malformed or missing canonical layouts visible instead of hiding recoverable work', async () => {
    const { root, list } = await fixture();
    await mkdir(path.join(root, 'blockout')); await writeFile(path.join(root, 'blockout/layout.json'), '{');
    expect((await list()).map((file) => file.name)).toEqual(['blockout/layout.json']);
  });
});
