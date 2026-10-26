import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { ProjectIntakeService } from '../src/services/project-intake.js';
import { BlockoutMaterialsService } from '../src/services/blockout-materials.js';
import { installProjectHistoryObserver } from '../src/project-history-observer.js';
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), 'history-cache-')); cleanups.push(() => rm(root, { recursive: true, force: true })); await mkdir(path.join(root, 'intake-assets')); return root; }
it('invalidates intake catalog cache before history replacement without starting analysis', async () => {
  const root = await fixture(), file = path.join(root, 'intake-assets/catalog.json'), service = new ProjectIntakeService();
  await writeFile(file, JSON.stringify({ version: 1, documents: [], assets: [] }));
  expect((await service.catalog(root)).documents).toEqual([]);
  await service.prepareHistoryRestore(root);
  await writeFile(file, JSON.stringify({ version: 1, documents: [{ id: 'restored', status: 'ready' }], assets: [] }));
  expect((await service.catalog(root)).documents[0]?.id).toBe('restored');
});
it('refuses cache invalidation while an intake settings save is pending, then permits it', async () => {
  const root = await fixture(), service = new ProjectIntakeService();
  let unblock!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { unblock = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  cleanups.push(installProjectHistoryObserver(async (_mutation, write) => { entered(); await blocked; return write(); }));
  const saving = service.configure(root, { version: 1, sourceDirs: [], outputDir: 'intake-assets' });
  await started;
  try { await expect(service.prepareHistoryRestore(root)).rejects.toMatchObject({ statusCode: 409 }); }
  finally { unblock(); await saving; }
  await expect(service.prepareHistoryRestore(root)).resolves.toBeUndefined();
});
it('invalidates persisted material inventory cache without triggering extraction', async () => {
  const root = await fixture(), folder = path.join(root, 'blockout/.context'); await mkdir(folder, { recursive: true });
  const service = new BlockoutMaterialsService({ dataDir: path.join(root, 'private') });
  const inventory = { version: 1, projectId: 'p', revision: 'a'.repeat(64), status: 'ready', sources: { processed: 0, total: 0, entries: [] }, items: [], gaps: [], createdAt: '2026-10-24T10:00:00Z', updatedAt: '2026-10-24T10:00:00Z' };
  const file = path.join(folder, `materials-${createHash('sha256').update('p').digest('hex').slice(0, 24)}.json`);
  await writeFile(file, JSON.stringify({ inventory, signature: 'first' }));
  const first = await service.read(root, 'p');
  expect(first).not.toBeNull();
  await service.prepareHistoryRestore(root, 'p');
  await writeFile(file, JSON.stringify({ inventory: { ...inventory, revision: 'b'.repeat(64) }, signature: 'restored' }));
  expect((await service.read(root, 'p'))?.revision).toBe('b'.repeat(64));
});
