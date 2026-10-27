import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectHistoryGit } from '../../src/services/project-history-git.js';
import { ProjectHistoryStore } from '../../src/services/project-history.js';

// Confirming a brief seeds 17 Blockout files and then saves the setup a few times before the Blockout
// request goes out. Each save started one Git process per new file and per folder on the changed paths,
// about 75 ms each on Windows: the 17-file seed alone took 2.6 s and the request reached the chat seconds late.
const roots: string[] = [], stores: ProjectHistoryStore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close().catch(() => undefined);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function write(root: string, relative: string, text: string) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), text);
}

it('saves the Blockout seed and each later save with four git processes, whatever the number of files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'melillo-history-processes-')); roots.push(root);
  const projectRoot = path.join(root, 'project'), dataRoot = path.join(root, 'private');
  await mkdir(dataRoot);
  await write(projectRoot, 'intake-assets/catalog.json', '{}');
  await write(projectRoot, 'header-footer/document-1/applied.json', '{}');
  const store = new ProjectHistoryStore({ projectId: 'test-project', projectRoot, dataRoot }); stores.push(store);
  await store.initialize();

  const command = vi.spyOn(ProjectHistoryGit.prototype as unknown as { command(args: string[]): Promise<Buffer> }, 'command');
  const seed = [...Array.from({ length: 14 }, (_, index) => `blockouts/document-${index % 2 + 1}/page-${index + 1}.blockout.json`),
    'blockout/brief.md', 'blockout/layout.json', 'blockout/starting-point.json'];
  for (const file of seed) await write(projectRoot, file, JSON.stringify({ file }));
  await store.capture(seed);
  expect(command.mock.calls.map(([args]) => args[0])).toEqual(['hash-object', 'mktree', 'hash-object', 'update-ref']);

  command.mockClear();
  const setup = '.melillodesign/projects/test-project/document-setup.json';
  await write(projectRoot, setup, '{"status":"confirmed"}');
  await store.capture([setup]);
  // The manifest written by the previous save is not read back from Git.
  expect(command.mock.calls.map(([args]) => args[0])).toEqual(['hash-object', 'mktree', 'hash-object', 'update-ref']);

  const timeline = await store.list();
  expect(timeline.entries[0]!.changedPaths).toEqual([setup]);
  expect(timeline.entries[1]!.changedPaths).toEqual([...seed].sort());
  expect((await store.version(timeline.entries[0]!.id)).files.map((file) => file.path)).toContain('blockouts/document-2/page-14.blockout.json');
});
