import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSourceBuildInfo } from '../src/app-version.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function checkout(): { root: string; git: (...args: string[]) => string } {
  const root = mkdtempSync(path.join(tmpdir(), 'od-build-info-'));
  roots.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  writeFileSync(path.join(root, 'file.txt'), 'one\n');
  git('add', 'file.txt');
  git('commit', '-q', '-m', 'one');
  return { root, git };
}

describe('readSourceBuildInfo', () => {
  // A screenshot of Settings must be enough to know which build a test report concerns.
  it('names the commit and the round tag the checkout is on', async () => {
    const { root, git } = checkout();
    git('tag', 'team-r1');
    expect(await readSourceBuildInfo(root)).toEqual({ commit: git('rev-parse', '--short=8', 'HEAD'), tag: 'team-r1', localChanges: false });
  });

  it('gives no tag between rounds and reports edited tracked files', async () => {
    const { root, git } = checkout();
    git('tag', 'team-r1');
    writeFileSync(path.join(root, 'file.txt'), 'two\n');
    git('commit', '-q', '-am', 'two');
    writeFileSync(path.join(root, 'file.txt'), 'three\n');
    expect(await readSourceBuildInfo(root)).toEqual({ commit: git('rev-parse', '--short=8', 'HEAD'), tag: null, localChanges: true });
  });

  it('is null outside a git checkout, as in a packaged app', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'od-build-info-plain-'));
    roots.push(root);
    expect(await readSourceBuildInfo(root)).toBeNull();
  });
});
