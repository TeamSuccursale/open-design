import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { PROJECT_HISTORY_POLICY } from '@open-design/contracts';
import { eligibleHistoryPath, ProjectHistoryStore } from '../../src/services/project-history.js';

const run = promisify(execFile), roots: string[] = [], stores: ProjectHistoryStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close().catch(() => undefined); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'melillo-history-')); roots.push(root);
  const projectRoot = path.join(root, 'project'), dataRoot = path.join(root, 'private');
  await mkdir(projectRoot); await mkdir(dataRoot);
  let time = Date.parse('2026-10-24T10:00:00Z');
  const create = () => { const store = new ProjectHistoryStore({ projectId: 'test-project', projectRoot, dataRoot, now: () => time }); stores.push(store); return store; };
  return { root, projectRoot, dataRoot, create, advance: (ms: number) => { time += ms; } };
}
async function names(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(dir: string, prefix = '') { for (const item of await readdir(dir, { withFileTypes: true })) { const name = prefix ? `${prefix}/${item.name}` : item.name; if (item.isDirectory()) await visit(path.join(dir, item.name), name); else result.push(name); } }
  await visit(root); return result.sort();
}
async function hashes(root: string) { const files = await names(root); return Object.fromEntries(await Promise.all(files.map(async (name) => [name, createHash('sha256').update(await readFile(path.join(root, name))).digest('hex')]))); }

describe('Private project recovery history', () => {
  it('captures a no-Git project including binaries and ignored deliverables without creating a project repository', async () => {
    const f = await fixture();
    await writeFile(path.join(f.projectRoot, '.gitignore'), '*.pdf\nbuild/\n');
    await writeFile(path.join(f.projectRoot, 'drawing.pdf'), Buffer.from([0, 1, 2, 255]));
    await mkdir(path.join(f.projectRoot, 'build')); await writeFile(path.join(f.projectRoot, 'build/final.html'), 'Delivery');
    await mkdir(path.join(f.projectRoot, 'node_modules')); await writeFile(path.join(f.projectRoot, 'node_modules/cache'), 'Ignored');
    const store = f.create(); await store.initialize();
    const timeline = await store.list();
    expect(timeline.entries).toHaveLength(1); expect(timeline.entries[0]!.kind).toBe('save');
    const version = await store.version(timeline.status.revision!);
    expect(version.files.map((file) => file.path)).toEqual(['.gitignore', 'build/final.html', 'drawing.pdf']);
    expect(version.files.find((file) => file.path === 'drawing.pdf')!.size).toBe(4);
    expect(await names(f.projectRoot)).not.toContain('.git/HEAD');
    expect(timeline.status.dirty).toBe(false);
    expect(eligibleHistoryPath('.git/config')).toBe(false); expect(eligibleHistoryPath('nested/.git')).toBe(false);
    expect(eligibleHistoryPath('.file-versions/old.html')).toBe(false);
    expect(eligibleHistoryPath('.tmp/cache')).toBe(false);
    expect(eligibleHistoryPath('layout.json.12345678-1234-1234-1234-123456789abc.tmp')).toBe(false);
  });

  it('leaves an existing dirty repository HEAD, index, config, hooks and Git files byte-for-byte unchanged', async () => {
    const f = await fixture();
    await run('git', ['init', f.projectRoot]);
    await writeFile(path.join(f.projectRoot, 'report.md'), 'Before');
    await run('git', ['-C', f.projectRoot, 'add', 'report.md']);
    await run('git', ['-C', f.projectRoot, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial']);
    await writeFile(path.join(f.projectRoot, 'report.md'), 'Staged'); await run('git', ['-C', f.projectRoot, 'add', 'report.md']);
    await writeFile(path.join(f.projectRoot, 'report.md'), 'Dirty unstaged');
    const before = await hashes(path.join(f.projectRoot, '.git'));
    const store = f.create(); await store.initialize();
    const baseline = (await store.list()).status.revision!;
    await writeFile(path.join(f.projectRoot, 'report.md'), 'Later'); await store.capture(['report.md']);
    await store.checkpoint('manual', 'Work', 'Changed a report');
    const revision = (await store.list()).status.revision!;
    await store.restore({ entryId: baseline, baseRevision: revision });
    expect(await readFile(path.join(f.projectRoot, 'report.md'), 'utf8')).toBe('Dirty unstaged');
    expect(await hashes(path.join(f.projectRoot, '.git'))).toEqual(before);
  });

  it('restores binary changes, renames, deletions and current-only files with a recoverable safety entry', async () => {
    const f = await fixture(); await writeFile(path.join(f.projectRoot, 'binary.pdf'), Buffer.from([0, 20, 255])); await writeFile(path.join(f.projectRoot, 'old.txt'), 'original');
    const store = f.create(); await store.initialize(); const baseline = (await store.list()).status.revision!;
    await rename(path.join(f.projectRoot, 'old.txt'), path.join(f.projectRoot, 'renamed.txt'));
    await writeFile(path.join(f.projectRoot, 'binary.pdf'), Buffer.from([0, 50, 90, 255])); await writeFile(path.join(f.projectRoot, 'added.txt'), 'new');
    await store.capture(); const changed = (await store.list()).status.revision!;
    const difference = await store.compare(baseline, changed);
    expect(difference.changes.map((file) => `${file.kind}:${file.path}`)).toEqual(['added:added.txt', 'modified:binary.pdf', 'deleted:old.txt', 'added:renamed.txt']);
    expect(difference.changes.find((file) => file.path === 'binary.pdf')!.binary).toBe(true);
    const restored = await store.restore({ entryId: baseline, baseRevision: changed });
    expect(await names(f.projectRoot)).toEqual(['binary.pdf', 'old.txt']);
    expect(await readFile(path.join(f.projectRoot, 'binary.pdf'))).toEqual(Buffer.from([0, 20, 255]));
    const safety = await store.version(restored.safetyEntryId); expect(safety.entry.reason).toBe('before-restore');
    await store.restore({ entryId: restored.safetyEntryId, baseRevision: restored.entry.id });
    expect(await names(f.projectRoot)).toEqual(['added.txt', 'binary.pdf', 'renamed.txt']);
    expect(await readFile(path.join(f.projectRoot, 'binary.pdf'))).toEqual(Buffer.from([0, 50, 90, 255]));
  });

  it('fences unobserved external changes and supports explicit restore-to-absence', async () => {
    const f = await fixture(); await writeFile(path.join(f.projectRoot, 'report.txt'), 'one');
    const store = f.create(); await store.initialize(); const baseline = (await store.list()).status.revision!;
    await writeFile(path.join(f.projectRoot, 'report.txt'), 'external change');
    await expect(store.restore({ entryId: baseline, baseRevision: baseline })).rejects.toMatchObject({ statusCode: 409 });
    expect(await readFile(path.join(f.projectRoot, 'report.txt'), 'utf8')).toBe('external change');
    await writeFile(path.join(f.projectRoot, 'new.txt'), 'new'); await store.capture(['new.txt']);
    const latest = (await store.list()).status.revision!;
    const restored = await store.restore({ entryId: baseline, paths: ['new.txt'], baseRevision: latest });
    expect(restored.restoredPaths).toEqual(['new.txt']);
    expect(await readFile(path.join(f.projectRoot, 'report.txt'), 'utf8')).toBe('external change');
    await expect(store.restore({ entryId: baseline, paths: ['absent.txt'], baseRevision: restored.entry.id })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('groups active work at 45 minutes and idle work once at 10 minutes, with independent 30-minute review', async () => {
    const f = await fixture(); await writeFile(path.join(f.projectRoot, 'report.txt'), 'one');
    const store = f.create(); await store.initialize(); await store.activity('agent-start');
    await writeFile(path.join(f.projectRoot, 'report.txt'), 'two'); await store.capture(['report.txt']);
    f.advance(PROJECT_HISTORY_POLICY.workCommitMs - 1); await store.tick();
    expect((await store.list()).entries.filter((entry) => entry.kind === 'commit')).toHaveLength(0);
    f.advance(1); await store.tick(); expect((await store.list()).entries.filter((entry) => entry.reason === 'work')).toHaveLength(1);
    expect((await store.list()).entries.find((entry) => entry.reason === 'work')!.changedPaths).toEqual(['report.txt']);
    await store.activity('agent-end', 'Prepared the report layout.');
    await writeFile(path.join(f.projectRoot, 'report.txt'), 'three'); await store.capture(['report.txt']);
    f.advance(PROJECT_HISTORY_POLICY.idleCommitMs); await store.tick();
    const first = await store.list(); expect(first.entries.filter((entry) => entry.reason === 'idle')).toHaveLength(1);
    expect(first.entries.find((entry) => entry.reason === 'idle')!.summary).toContain('Prepared the report layout.');
    expect(first.status.organizationReview).toBeNull();
    f.advance(PROJECT_HISTORY_POLICY.idleReviewMs - PROJECT_HISTORY_POLICY.idleCommitMs); await store.tick();
    const review = (await store.list()).status.organizationReview!; expect(review.reason).toBe('idle');
    f.advance(PROJECT_HISTORY_POLICY.idleReviewMs); await store.tick();
    expect((await store.list()).status.organizationReview!.id).toBe(review.id);
    expect((await store.list()).entries.filter((entry) => entry.reason === 'idle')).toHaveLength(1);
  });

  it('does not turn ten minutes of inactivity into active work', async () => {
    const f = await fixture(); await writeFile(path.join(f.projectRoot, 'report.txt'), 'one');
    const store = f.create(); await store.initialize(); await store.activity('user');
    await writeFile(path.join(f.projectRoot, 'report.txt'), 'two'); await store.capture();
    const lastActivity = (await store.list()).status.lastActivityAt;
    f.advance(9 * 60_000); await store.tick();
    expect((await store.list()).status.activeWorkMs).toBe(60_000);
    expect(await store.capture()).toBeNull();
    expect((await store.list()).status.lastActivityAt).toBe(lastActivity);
    f.advance(60_000); await store.tick();
    expect((await store.list()).entries[0]!.reason).toBe('idle');
    expect((await store.list()).entries.filter((entry) => entry.reason === 'work')).toHaveLength(0);
  });

  it('reviews once after two hours of active agent work without empty checkpoints or file moves', async () => {
    const f = await fixture(); await writeFile(path.join(f.projectRoot, 'report.txt'), 'one');
    const store = f.create(); await store.initialize(); await store.activity('agent-start');
    await writeFile(path.join(f.projectRoot, 'report.txt'), 'two'); await store.capture();
    const before = await hashes(f.projectRoot);
    f.advance(PROJECT_HISTORY_POLICY.workReviewMs); await store.tick();
    const first = await store.list(), review = first.status.organizationReview!;
    expect(review.reason).toBe('work'); expect(first.entries.filter((entry) => entry.kind === 'commit')).toHaveLength(1);
    expect(await store.checkpoint('manual')).toBeNull();
    f.advance(PROJECT_HISTORY_POLICY.workReviewMs); await store.tick();
    expect((await store.list()).status.organizationReview!.id).toBe(review.id);
    expect((await store.list()).entries.filter((entry) => entry.kind === 'commit')).toHaveLength(1);
    expect(await hashes(f.projectRoot)).toEqual(before);
  });

  it('persists accumulated clocks across restart without counting downtime and rearms after new work', async () => {
    const f = await fixture(); await writeFile(path.join(f.projectRoot, 'report.txt'), 'one');
    const first = f.create(); await first.initialize(); await first.activity('agent-start');
    await writeFile(path.join(f.projectRoot, 'report.txt'), 'two'); await first.capture();
    f.advance(20 * 60_000); await first.tick(); await first.close();
    f.advance(10 * 60 * 60_000);
    const second = f.create(); await second.initialize(); await second.activity('agent-start');
    f.advance(25 * 60_000); await second.tick();
    expect((await second.list()).entries.filter((entry) => entry.reason === 'work')).toHaveLength(1);
    await second.activity('agent-end'); await writeFile(path.join(f.projectRoot, 'report.txt'), 'three'); await second.capture();
    f.advance(PROJECT_HISTORY_POLICY.idleCommitMs); await second.tick();
    await writeFile(path.join(f.projectRoot, 'report.txt'), 'four'); await second.capture();
    f.advance(PROJECT_HISTORY_POLICY.idleCommitMs); await second.tick();
    expect((await second.list()).entries.filter((entry) => entry.reason === 'idle')).toHaveLength(2);
  });

  it('keeps organization read-only, protects originals and referenced assets, and avoids timestamp-based obsolescence', async () => {
    const f = await fixture();
    await mkdir(path.join(f.projectRoot, 'originali')); await writeFile(path.join(f.projectRoot, 'originali/old.pdf'), 'Original');
    await writeFile(path.join(f.projectRoot, 'AGENTS.md'), 'Rules'); await writeFile(path.join(f.projectRoot, 'asset-old.svg'), '<svg/>');
    await writeFile(path.join(f.projectRoot, 'index.html'), '<img src="asset-old.svg">'); await writeFile(path.join(f.projectRoot, 'proposal-old.html'), 'Possible old generated variant');
    const before = await hashes(f.projectRoot), store = f.create(); await store.initialize();
    const review = await store.organization('review');
    expect(review!.protectedPaths).toEqual(expect.arrayContaining(['originali/old.pdf', 'AGENTS.md', 'asset-old.svg']));
    expect(review!.candidates.map((item) => item.path)).toContain('proposal-old.html');
    expect(await hashes(f.projectRoot)).toEqual(before);
    expect((await store.organization('acknowledge', review!.id))!.status).toBe('acknowledged');
  });

  it('rejects traversal, excluded Git paths, linked files and an in-project private store', async () => {
    const f = await fixture(); await writeFile(path.join(f.projectRoot, 'report.txt'), 'one');
    const store = f.create(); await store.initialize(); const baseline = (await store.list()).status.revision!;
    for (const name of ['../outside.txt', '.git/config', 'C:\\outside.txt', 'folder/../../file']) await expect(store.restore({ entryId: baseline, paths: [name], baseRevision: baseline })).rejects.toMatchObject({ statusCode: 400 });
    const outside = path.join(f.root, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(f.projectRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(await store.capture()).toBeNull();
    await expect(store.capture(['linked'])).rejects.toThrow('linked paths');
    await expect(store.restore({ entryId: baseline, paths: ['linked/secret.txt'], baseRevision: baseline })).rejects.toMatchObject({ statusCode: 400 });
    expect(await readFile(path.join(outside, 'secret.txt'), 'utf8')).toBe('secret');
    const unsafe = new ProjectHistoryStore({ projectId: 'unsafe', projectRoot: f.projectRoot, dataRoot: f.projectRoot }); stores.push(unsafe);
    await expect(unsafe.initialize()).rejects.toThrow('outside the selected project');
  });

  it('records interrupted restores and can recover the pre-restore state when an old object is damaged', async () => {
    const f = await fixture(); await writeFile(path.join(f.projectRoot, 'binary.pdf'), Buffer.from([0, 1, 2]));
    const store = f.create(); await store.initialize();
    const baseline = (await store.list()).status.revision!, oldHash = (await store.version(baseline)).files[0]!.hash;
    await writeFile(path.join(f.projectRoot, 'binary.pdf'), Buffer.from([0, 9, 8])); await writeFile(path.join(f.projectRoot, 'current-only.txt'), 'Keep this recovery copy'); await store.capture();
    const current = (await store.list()).status.revision!;
    const historyKey = (await readdir(path.join(f.dataRoot, 'project-history')))[0]!;
    const damaged = path.join(f.dataRoot, 'project-history', historyKey, 'objects.git/objects', oldHash.slice(0, 2), oldHash.slice(2));
    await chmod(damaged, 0o600); await writeFile(damaged, 'damaged object');
    await expect(store.restore({ entryId: baseline, baseRevision: current })).rejects.toThrow('safety snapshot');
    const interrupted = await store.list(), safety = interrupted.entries.find((entry) => entry.reason === 'before-restore')!;
    expect(safety).toBeDefined(); expect(interrupted.entries[0]!.reason).toBe('restore');
    expect((await names(f.projectRoot)).some((name) => name.includes('melillo-restore'))).toBe(false);
    await store.restore({ entryId: safety.id, baseRevision: interrupted.status.revision! });
    expect(await readFile(path.join(f.projectRoot, 'binary.pdf'))).toEqual(Buffer.from([0, 9, 8]));
    expect(await readFile(path.join(f.projectRoot, 'current-only.txt'), 'utf8')).toBe('Keep this recovery copy');
  });

  it('handles file/directory transitions and refuses a restore that would replace nested Git data', async () => {
    const f = await fixture(); await writeFile(path.join(f.projectRoot, 'slot'), 'A file');
    const store = f.create(); await store.initialize(); const baseline = (await store.list()).status.revision!;
    await rm(path.join(f.projectRoot, 'slot')); await mkdir(path.join(f.projectRoot, 'slot')); await writeFile(path.join(f.projectRoot, 'slot/child.txt'), 'A child'); await store.capture();
    const later = (await store.list()).status.revision!;
    const restored = await store.restore({ entryId: baseline, baseRevision: later });
    expect(await readFile(path.join(f.projectRoot, 'slot'), 'utf8')).toBe('A file');
    await store.restore({ entryId: later, baseRevision: restored.entry.id });
    expect(await readFile(path.join(f.projectRoot, 'slot/child.txt'), 'utf8')).toBe('A child');
    await mkdir(path.join(f.projectRoot, 'slot/.git')); await writeFile(path.join(f.projectRoot, 'slot/.git/HEAD'), 'protected');
    const current = (await store.list()).status.revision!;
    await expect(store.restore({ entryId: baseline, baseRevision: current })).rejects.toThrow('protected project data');
    expect(await readFile(path.join(f.projectRoot, 'slot/child.txt'), 'utf8')).toBe('A child');
    expect(await readFile(path.join(f.projectRoot, 'slot/.git/HEAD'), 'utf8')).toBe('protected');
  });

  it('paginates older commits and saves with an exclusive stable cursor when new saves arrive', async () => {
    const f = await fixture(); await writeFile(path.join(f.projectRoot, 'report.txt'), 'zero');
    const store = f.create(); await store.initialize(); const baseline = (await store.list()).status.revision!;
    await writeFile(path.join(f.projectRoot, 'report.txt'), 'one'); const one = await store.capture();
    await writeFile(path.join(f.projectRoot, 'report.txt'), 'two'); const two = await store.capture();
    const commit = await store.checkpoint('manual');
    await writeFile(path.join(f.projectRoot, 'report.txt'), 'three'); const three = await store.capture();
    const first = await store.list(2); expect(first.entries.map((entry) => entry.id)).toEqual([three!.id, commit!.id]); expect(first.nextCursor).toBe(commit!.id);
    await writeFile(path.join(f.projectRoot, 'report.txt'), 'four'); await store.capture();
    const second = await store.list(2, first.nextCursor!); expect(second.entries.map((entry) => entry.id)).toEqual([two!.id, one!.id]);
    const last = await store.list(2, second.nextCursor!); expect(last.entries.map((entry) => entry.id)).toEqual([baseline]); expect(last.nextCursor).toBeNull();
    await expect(store.list(2, 'invalid-cursor')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('recovers immutable entries after damaged clock metadata and reports unavailable Git without touching project files', async () => {
    const f = await fixture(); await writeFile(path.join(f.projectRoot, 'report.txt'), 'one');
    const first = f.create(); await first.initialize();
    await writeFile(path.join(f.projectRoot, 'report.txt'), 'two'); const saved = await first.capture(); await first.close();
    const key = (await readdir(path.join(f.dataRoot, 'project-history')))[0]!;
    await writeFile(path.join(f.dataRoot, 'project-history', key, 'state.json'), '{interrupted');
    const second = f.create(); await second.initialize();
    expect((await second.list()).status.revision).toBe(saved!.id);
    expect((await second.list()).status.dirty).toBe(true);
    expect(await readFile(path.join(f.projectRoot, 'report.txt'), 'utf8')).toBe('two');
    const other = await fixture(), before = await hashes(other.projectRoot), unavailable = other.create(), previousPath = process.env.PATH;
    try {
      process.env.PATH = other.dataRoot;
      await expect(unavailable.initialize()).rejects.toThrow('Git unavailable');
      expect((await unavailable.list()).status.state).toBe('error');
      expect(await hashes(other.projectRoot)).toEqual(before);
    } finally { if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; }
    await unavailable.initialize(); expect((await unavailable.list()).status.state).toBe('ready');
  });

  it('bounds text comparisons without treating a truncated UTF-8 character as binary data', async () => {
    const f = await fixture(), source = `${'a'.repeat(63_998)}😀more text`;
    await writeFile(path.join(f.projectRoot, 'report.txt'), source);
    const store = f.create(); await store.initialize(); const baseline = (await store.list()).status.revision!;
    await writeFile(path.join(f.projectRoot, 'report.txt'), `${source}\nChanged`);
    const difference = await store.compare(baseline);
    expect(difference.toId).toBeNull();
    expect(difference.changes[0]).toMatchObject({ binary: false, truncated: true });
    expect(difference.changes[0]!.beforeText).not.toContain('\ufffd');
    expect(difference.changes[0]!.beforeText!.length).toBeLessThanOrEqual(64_000);
  });
});
