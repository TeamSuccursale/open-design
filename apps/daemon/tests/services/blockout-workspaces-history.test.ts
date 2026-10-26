import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { BLOCKOUT_BRIEF_PATH, BLOCKOUT_DOCUMENTS_PATH, BLOCKOUT_START_PATH, blockoutPageFiles, blockoutWorkspacePath, createBlockoutDocument, createBlockoutPage, type BlockoutDocument } from '@open-design/contracts';
import { installProjectHistoryObserver, type ProjectHistoryMutation } from '../../src/project-history-observer.js';
import { listBlockoutWorkspaces, readBlockoutWorkspace, saveBlockoutWorkspace, seedBlockoutWorkspaces } from '../../src/services/blockout-workspaces.js';

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

describe('Blockout saves in project history', () => {
  // Each history mutation captures the project before and after with Git; one per file made a
  // two-document brief confirmation take about 13 s on Windows.
  it('records a whole save, pages included, as one history mutation', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'melillo-blockout-history-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const mutations: ProjectHistoryMutation[] = [];
    cleanup.push(installProjectHistoryObserver(async (mutation, write) => { mutations.push(mutation); return write(); }));
    const base = createBlockoutDocument();
    const document: BlockoutDocument = { ...base, documentId: 'relazione', title: 'Relazione B',
      variants: [{ ...base.variants[0]!, pages: ['page-1', 'page-2', 'page-3'].map((id, index) => createBlockoutPage(id, `Pagina ${index + 1}`)) }] };

    await saveBlockoutWorkspace(root, 'relazione', { document, baseRaw: null, startingPoint: true });

    expect(mutations).toHaveLength(1);
    const written = [...blockoutPageFiles(document).map((file) => file.path), BLOCKOUT_DOCUMENTS_PATH, BLOCKOUT_BRIEF_PATH, blockoutWorkspacePath('relazione')];
    expect(mutations[0]!.paths).toEqual(expect.arrayContaining(written));
    expect(JSON.parse(await readFile(path.join(root, blockoutWorkspacePath('relazione')), 'utf8'))).toMatchObject({ documentId: 'relazione', title: 'Relazione B' });
  });

  it('seeds every missing document of a confirmed brief in one mutation and leaves existing ones alone', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'melillo-blockout-seed-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const report: BlockoutDocument = { ...createBlockoutDocument(), documentId: 'relazione', title: 'Relazione B' };
    const plates: BlockoutDocument = { ...createBlockoutDocument(), documentId: 'tavole', title: 'Fascicolo grafico B' };
    const mutations: ProjectHistoryMutation[] = [];
    cleanup.push(installProjectHistoryObserver(async (mutation, write) => { mutations.push(mutation); return write(); }));

    await seedBlockoutWorkspaces(root, [report, plates]);
    expect(mutations).toHaveLength(1);
    // A new multi-output catalog lists only its own outputs, not an inferred document-1.
    expect(await listBlockoutWorkspaces(root)).toEqual({ version: 1, documents: [{ id: 'relazione', title: 'Relazione B' }, { id: 'tavole', title: 'Fascicolo grafico B' }] });
    expect(JSON.parse(await readFile(path.join(root, BLOCKOUT_START_PATH), 'utf8'))).toMatchObject({ documentId: 'relazione' });

    const edited = await readBlockoutWorkspace(root, 'tavole');
    await saveBlockoutWorkspace(root, 'tavole', { document: { ...edited.document!, title: 'Tavole riviste' }, baseRaw: edited.raw });
    mutations.length = 0;
    await seedBlockoutWorkspaces(root, [report, plates]);
    expect(mutations).toHaveLength(0);
    expect((await readBlockoutWorkspace(root, 'tavole')).document?.title).toBe('Tavole riviste');
  });
});
