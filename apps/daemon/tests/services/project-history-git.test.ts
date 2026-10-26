import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectHistoryGit } from '../../src/services/project-history-git.js';
import { historyTree } from '../../src/services/project-history-files.js';

let base: string | undefined;
afterEach(async () => { if (base) await rm(base, { recursive: true, force: true }); base = undefined; });

describe('private project history Git', () => {
  it('stores objects under a data folder deeper than the Windows path limit', async () => {
    base = await mkdtemp(path.join(tmpdir(), 'melillo-history-long-'));
    // A packaged or worktree data root can sit deep enough that objects/xx/<62 hex> passes 260 characters.
    // Git itself refuses a Git directory near 237 characters even with long paths, so stay below that.
    let root = base;
    while (root.length < 150) root = path.join(root, 'cartella-progetto');
    root = path.join(root, 'x'.repeat(184 - root.length));
    const git = new ProjectHistoryGit(root);
    await git.initialize();
    const hash = await git.blob(Buffer.from('pagina 1'));
    expect(path.join(git.directory, 'objects', hash.slice(0, 2), hash.slice(2)).length).toBeGreaterThan(260);
    expect(await git.run(['cat-file', 'blob', hash])).toBe('pagina 1');
  });
  it('rebuilds only the trees on a changed path, since every save captures the whole project', async () => {
    base = await mkdtemp(path.join(tmpdir(), 'melillo-history-trees-'));
    const git = new ProjectHistoryGit(base);
    await git.initialize();
    const file = async (name: string, text: string) => ({ path: name, hash: await git.blob(Buffer.from(text)), size: text.length, mode: 0o644 });
    const files = [await file('blockouts/relazione/page-1.blockout.json', '1'), await file('blockouts/tavole/page-1.blockout.json', '2'), await file('intake/fonte.txt', '3'), await file('note.md', '4')];
    const first = await historyTree(git, files);
    const run = vi.spyOn(git, 'run');
    const changed = [files[0]!, await file('blockouts/tavole/page-1.blockout.json', '2 bis'), files[2]!, files[3]!];
    const second = await historyTree(git, changed);
    // tavole, blockouts and the root: relazione and intake are unchanged.
    expect(run.mock.calls.filter(([args]) => args[0] === 'mktree')).toHaveLength(3);
    expect(second).not.toBe(first);
    expect(await historyTree(git, files)).toBe(first);
    expect((await git.run(['cat-file', '-t', first])).trim()).toBe('tree');
  });
  it.runIf(process.platform === 'win32')('explains a data folder too deep for Git instead of passing on its raw error', async () => {
    base = await mkdtemp(path.join(tmpdir(), 'melillo-history-deep-'));
    let root = base;
    while (root.length < 230) root = path.join(root, 'cartella-progetto');
    const git = new ProjectHistoryGit(root);
    const failure = await git.initialize().then(() => git.blob(Buffer.from('pagina 1'))).then(() => null, (error: unknown) => error as { code?: string; statusCode?: number; message: string });
    expect(failure).toMatchObject({ code: 'HISTORY_PATH_TOO_LONG', statusCode: 503 });
    expect(failure?.message).toContain('cartella dati');
    expect(failure?.message).not.toMatch(/fatal|GIT_DIR/);
  });
});
