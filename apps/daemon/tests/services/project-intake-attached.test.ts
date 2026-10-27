// Images the engineer attached in the chat enter the gallery on their own;
// images the agent produced stay out unless someone attaches them.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectIntakeService } from '../../src/services/project-intake.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'melillo-intake-attached-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function service() {
  return new ProjectIntakeService({
    normalizeImage: async (_source, output) => { await writeFile(output, 'png bytes'); return { width: 800, height: 600 }; },
    analyze: async () => ({ title: 'Immagine', kind: 'image', description: 'Una immagine.', tags: [], tableData: null }),
  });
}

async function settled(intake: ProjectIntakeService) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const catalog = await intake.catalog(root);
    if (catalog.documents.every((document) => document.status === 'ready' || document.status === 'failed')) return catalog;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('intake did not settle');
}

describe('attached images in the gallery', () => {
  it('takes in attached images that are missing, skipping deleted files, and records when each was added', async () => {
    await writeFile(path.join(root, 'foto.png'), 'one');
    await writeFile(path.join(root, 'pianta.jpg'), 'two');
    const intake = service();
    await intake.start(root, { paths: ['foto.png'] });
    await settled(intake);
    await intake.start(root, { attached: true }, ['foto.png', 'cancellata.png', 'pianta.jpg']);
    const catalog = await settled(intake);
    expect(catalog.documents.map((document) => document.sourcePath).sort()).toEqual(['foto.png', 'pianta.jpg']);
    for (const document of catalog.documents) expect(Date.parse(document.addedAt ?? '')).not.toBeNaN();
  });

  it('does nothing, without an error, when every attached image is already in the gallery', async () => {
    await writeFile(path.join(root, 'foto.png'), 'one');
    const intake = service();
    await intake.start(root, { paths: ['foto.png'] });
    const before = await settled(intake);
    const after = await intake.start(root, { attached: true }, ['foto.png']);
    expect(after.documents).toEqual(before.documents);
  });

  it('a folder scan takes in attached images but not the images the agent produced', async () => {
    await writeFile(path.join(root, 'foto.png'), 'attached');
    await writeFile(path.join(root, 'render-proposta.png'), 'agent output');
    const intake = service();
    await intake.start(root, {}, ['foto.png']);
    const catalog = await settled(intake);
    expect(catalog.documents.map((document) => document.sourcePath)).toEqual(['foto.png']);
  });
});
