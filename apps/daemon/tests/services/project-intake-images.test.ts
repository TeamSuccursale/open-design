// An image added to the chat enters the project gallery whole, as one asset the
// chat can later attach by its own path.
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatIntakeAttachmentContext } from '@open-design/contracts';
import { ProjectIntakeService } from '../../src/services/project-intake.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'melillo-intake-image-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function settled(service: ProjectIntakeService) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const catalog = await service.catalog(root);
    if (catalog.documents.every((document) => document.status === 'ready' || document.status === 'failed')) return catalog;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('intake did not settle');
}

describe('single images in the gallery', () => {
  it('turns an added image into one described asset without splitting it into pages', async () => {
    await mkdir(path.join(root, 'rilievo'));
    await writeFile(path.join(root, 'rilievo/facciata.jpg'), 'jpeg bytes');
    const prompts: string[] = [];
    const service = new ProjectIntakeService({
      normalizeImage: async (_source, output) => { await writeFile(output, 'png bytes'); return { width: 1200, height: 800 }; },
      analyze: async (_image, prompt) => {
        prompts.push(prompt);
        return { title: 'Facciata nord', kind: 'image', description: 'Fotografia della facciata nord.', tags: ['facciata', 'north elevation'], tableData: null };
      },
    });
    await service.start(root, { paths: ['rilievo/facciata.jpg'] });
    const catalog = await settled(service);
    expect(catalog.documents).toHaveLength(1);
    expect(catalog.documents[0]).toMatchObject({ status: 'ready', pageCount: 1, completedPages: 1, indexedPages: [1], sourcePath: 'rilievo/facciata.jpg' });
    expect(catalog.assets).toHaveLength(1);
    const [asset] = catalog.assets;
    expect(asset).toMatchObject({ kind: 'image', title: 'Facciata nord', status: 'ready', sourcePath: 'rilievo/facciata.jpg', width: 1200, height: 800, box: [0, 0, 1000, 1000] });
    expect(await readFile(path.join(root, asset!.imagePath), 'utf8')).toBe('png bytes');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('added to the project on its own');
    expect(formatIntakeAttachmentContext(catalog.assets, ['rilievo/facciata.jpg'])).toContain('Facciata nord');
  });

  it('recognizes the same image added twice', async () => {
    const bytes = 'same image', id = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
    await writeFile(path.join(root, 'foto.png'), bytes); await mkdir(path.join(root, 'intake-assets'));
    await writeFile(path.join(root, 'intake-assets/catalog.json'), JSON.stringify({ version: 1, documents: [{ id, sourcePath: 'foto.png', name: 'foto.png', status: 'ready', pageCount: 1, completedPages: 1, indexedPages: [1] }], assets: [] }));
    const result = await new ProjectIntakeService({ analyze: async () => { throw new Error('must not analyze again'); } }).start(root, { paths: ['foto.png'] });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({ status: 'ready' });
  });

  it('still refuses other files', async () => {
    await writeFile(path.join(root, 'note.txt'), 'text');
    await expect(new ProjectIntakeService().start(root, { paths: ['note.txt'] })).rejects.toThrow('PDF documents or images');
  });
});
