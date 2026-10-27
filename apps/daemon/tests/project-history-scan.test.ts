import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectHistoryGit } from '../src/services/project-history-git.js';
import { scanHistoryFiles } from '../src/services/project-history-files.js';

// On Windows each `git hash-object` costs 40–55 ms, and a project of 110 files took 4.4 s to rescan while
// holding the project's history lock. A rescan runs at daemon start, at every agent end and on watcher overflow.
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function project() {
  const root = await mkdtemp(path.join(tmpdir(), 'history-scan-')); roots.push(root);
  const files = path.join(root, 'project'), store = path.join(root, 'store');
  await mkdir(path.join(files, 'intake-assets'), { recursive: true });
  await writeFile(path.join(files, 'empty.txt'), '');
  await writeFile(path.join(files, 'notes.txt'), 'riga uno\r\nriga due — accentata è\n');
  await writeFile(path.join(files, 'intake-assets', 'page.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255, 254, 0]));
  for (let index = 0; index < 8; index += 1) await writeFile(path.join(files, 'intake-assets', `asset-${index}.json`), JSON.stringify({ index }));
  const git = new ProjectHistoryGit(store); await git.initialize();
  return { files, git };
}

it('rescans unchanged files without starting git, with the same object ids git gives', async () => {
  const { files, git } = await project();
  const first = await scanHistoryFiles(files, git);
  const blob = vi.spyOn(git, 'blob');
  expect(await scanHistoryFiles(files, git, undefined, first)).toEqual(first);
  expect(blob).not.toHaveBeenCalled();
});

it('writes every new file with one git process, also on the first snapshot of a project', async () => {
  const { files, git } = await project();
  const run = vi.spyOn(git, 'run');
  const first = await scanHistoryFiles(files, git);
  expect(run.mock.calls.filter(([args]) => args[0] === 'hash-object')).toHaveLength(1);
  run.mockRestore();
  expect(first.find((file) => file.path === 'notes.txt')!.hash).toBe(await git.blob(Buffer.from('riga uno\r\nriga due — accentata è\n')));
  for (const file of first) expect((await git.run(['cat-file', '-s', file.hash])).trim()).toBe(String(file.size));
});

it('stores a file on its own when it changed after the check and before git read it', async () => {
  const { files, git } = await project();
  const original = git.blobs.bind(git);
  vi.spyOn(git, 'blobs').mockImplementationOnce(async (paths) => {
    await writeFile(path.join(files, 'notes.txt'), 'cambiato durante il salvataggio\n');
    return original(paths);
  });
  const blob = vi.spyOn(git, 'blob');
  const scanned = await scanHistoryFiles(files, git);
  expect(blob).toHaveBeenCalledOnce();
  expect(scanned.find((file) => file.path === 'notes.txt')!.hash).toBe(await git.blob(Buffer.from('cambiato durante il salvataggio\n')));
  expect(scanned).toEqual(await scanHistoryFiles(files, git));
});

it('stores only the files whose content changed', async () => {
  const { files, git } = await project();
  const first = await scanHistoryFiles(files, git);
  await writeFile(path.join(files, 'notes.txt'), 'testo nuovo\n');
  const blobs = vi.spyOn(git, 'blobs');
  const second = await scanHistoryFiles(files, git, undefined, first);
  expect(blobs).toHaveBeenCalledOnce();
  expect(blobs.mock.calls[0]![0]).toEqual([path.join(files, 'notes.txt')]);
  expect(second).toEqual(await scanHistoryFiles(files, git));
  expect(second.find((file) => file.path === 'notes.txt')!.hash).not.toBe(first.find((file) => file.path === 'notes.txt')!.hash);
});
