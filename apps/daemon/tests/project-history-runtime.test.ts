import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import chokidar from 'chokidar';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectHistoryRuntime } from '../src/services/project-history-runtime.js';
import { withProjectHistoryMutation } from '../src/project-history-observer.js';
import { writeProjectFile, renameProjectFile, deleteProjectFile } from '../src/projects.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it('keeps files unchanged while background preparation blocks restore and can recover when it finishes', async () => {
  const f = await fixture(), file = path.join(f.projectRoot, 'report.md');
  let busy = true;
  await writeFile(file, 'first');
  const runtime = f.create(async () => { if (busy) throw Object.assign(new Error('Preparing images'), { statusCode: 409 }); });
  const store = await runtime.store('p', f.projectRoot), initial = (await store.list()).status.revision!;
  await withProjectHistoryMutation({ root: f.projectRoot, projectId: 'p', paths: ['report.md'] }, () => writeFile(file, 'second'));
  const current = (await store.list()).status.revision!;
  await expect(runtime.restore('p', f.projectRoot, { entryId: initial, baseRevision: current })).rejects.toMatchObject({ statusCode: 409, code: 'HISTORY_BACKGROUND_RUNNING' });
  expect(await readFile(file, 'utf8')).toBe('second');
  busy = false;
  await runtime.restore('p', f.projectRoot, { entryId: initial, baseRevision: current });
  expect(await readFile(file, 'utf8')).toBe('first');
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'history-runtime-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, 'project'), dataRoot = path.join(root, 'data');
  await mkdir(projectRoot); await mkdir(dataRoot);
  const errors: unknown[] = [];
  const create = (beforeRestore?: () => Promise<void>) => {
    const runtime = new ProjectHistoryRuntime({ dataRoot, projectsRoot: root, resolveProject: id => id === 'p' ? { root: projectRoot } : null, isAgentRunning: () => false, ...(beforeRestore ? { beforeRestore } : {}), onError: error => errors.push(error), intervalMs: 60_000 });
    cleanup.push(() => runtime.close()); return runtime;
  };
  return { root, projectRoot, dataRoot, errors, create };
}
it('awaits snapshots before and after app mutations, preserving an externally changed preimage', async () => {
  const f = await fixture(), file = path.join(f.projectRoot, 'report.md');
  await writeFile(file, 'initial'); const runtime = f.create(), store = await runtime.store('p', f.projectRoot);
  const initial = (await store.list()).status.revision!;
  await writeFile(file, 'external before app');
  const result = await withProjectHistoryMutation({ root: f.projectRoot, projectId: 'p', paths: ['report.md'] }, async () => {
    const before = (await store.list()).status.revision!;
    expect((await store.compare(initial, before)).changes[0]?.afterText).toBe('external before app');
    await writeFile(file, 'app result'); return 'saved';
  });
  expect(result).toBe('saved');
  const after = (await store.list()).status.revision!;
  expect((await store.compare(initial, after)).changes[0]?.afterText).toBe('app result');
  expect(f.errors).toEqual([]);
});
it('retains recovery snapshots when an app write partially succeeds and then rejects', async () => {
  const f = await fixture(), file = path.join(f.projectRoot, 'report.md'); await writeFile(file, 'original');
  const runtime = f.create(), store = await runtime.store('p', f.projectRoot), before = (await store.list()).status.revision!;
  await expect(withProjectHistoryMutation({ root: f.projectRoot, projectId: 'p', paths: ['report.md'] }, async () => { await writeFile(file, 'partial output'); throw new Error('write interrupted'); })).rejects.toThrow('write interrupted');
  const after = (await store.list()).status.revision!;
  expect(after).not.toBe(before); expect((await store.compare(before, after)).changes[0]?.afterText).toBe('partial output');
  await store.restore({ entryId: before, baseRevision: after }); expect(await readFile(file, 'utf8')).toBe('original');
});
it('captures stable external writes through the watcher without UI activity', async () => {
  const f = await fixture(), file = path.join(f.projectRoot, 'external.md'); await writeFile(file, 'before');
  const runtime = f.create(), store = await runtime.store('p', f.projectRoot), before = (await store.list()).status.revision!;
  await writeFile(file, 'first chunk'); await writeFile(file, 'stable CLI output');
  await vi.waitFor(async () => { const current = (await store.list()).status.revision!; expect(current).not.toBe(before); expect((await store.compare(before, current)).changes[0]?.afterText).toBe('stable CLI output'); }, { timeout: 8_000, interval: 100 });
  expect(f.errors).toEqual([]);
});
it.each(['EBUSY', 'EPERM'])('falls back from a startup %s watch error and keeps acknowledged saves recoverable', async (code) => {
  vi.stubEnv('OD_WATCHER_USE_POLLING', undefined); vi.stubEnv('CHOKIDAR_USEPOLLING', undefined);
  const unavailable = Object.assign(new EventEmitter(), { close: vi.fn(async () => undefined) });
  const watch = vi.spyOn(chokidar, 'watch').mockImplementationOnce(() => {
    queueMicrotask(() => unavailable.emit('error', Object.assign(new Error('Transient Windows watch lock'), { code })));
    return unavailable as unknown as ReturnType<typeof chokidar.watch>;
  });
  const f = await fixture(), file = path.join(f.projectRoot, 'report.md'); await writeFile(file, 'before');
  const runtime = f.create(), store = await runtime.store('p', f.projectRoot), before = (await store.list()).status.revision!;
  expect(watch).toHaveBeenCalledTimes(2);
  expect(watch.mock.calls[1]?.[1]).toMatchObject({ usePolling: true, interval: 1_000, binaryInterval: 1_000 });
  expect(watch.mock.results[1]?.value.options.usePolling).toBe(true);
  expect(unavailable.close).toHaveBeenCalledOnce();
  const result = await withProjectHistoryMutation({ root: f.projectRoot, projectId: 'p', paths: ['report.md'] }, async () => { await writeFile(file, 'acknowledged save'); return 'saved'; });
  expect(result).toBe('saved');
  const saved = (await store.list()).status.revision!;
  expect((await store.compare(before, saved)).changes[0]?.afterText).toBe('acknowledged save');
  await writeFile(file, 'external CLI output');
  await vi.waitFor(async () => {
    const current = (await store.list()).status.revision!;
    expect((await store.compare(saved, current)).changes[0]?.afterText).toBe('external CLI output');
  }, { timeout: 8_000, interval: 100 });
  const current = (await store.list()).status.revision!;
  await runtime.restore('p', f.projectRoot, { entryId: saved, baseRevision: current });
  expect(await readFile(file, 'utf8')).toBe('acknowledged save');
  expect(watch).toHaveBeenCalledTimes(2);
});
it('reconciles changes during a runtime watch handoff without another native retry', async () => {
  vi.stubEnv('OD_WATCHER_USE_POLLING', undefined); vi.stubEnv('CHOKIDAR_USEPOLLING', undefined);
  const native = Object.assign(new EventEmitter(), { close: vi.fn(async () => undefined) });
  const watch = vi.spyOn(chokidar, 'watch').mockImplementationOnce(() => {
    queueMicrotask(() => native.emit('ready'));
    return native as unknown as ReturnType<typeof chokidar.watch>;
  });
  const f = await fixture(), file = path.join(f.projectRoot, 'report.md'); await writeFile(file, 'before');
  const runtime = f.create(), store = await runtime.store('p', f.projectRoot), before = (await store.list()).status.revision!;
  await writeFile(file, 'written while native watcher failed');
  native.emit('error', Object.assign(new Error('Transient Windows watch lock'), { code: 'EBUSY' }));
  await vi.waitFor(async () => {
    const current = (await store.list()).status.revision!;
    expect((await store.compare(before, current)).changes[0]?.afterText).toBe('written while native watcher failed');
  }, { timeout: 8_000, interval: 100 });
  expect(watch).toHaveBeenCalledTimes(2); expect(native.close).toHaveBeenCalledOnce();
  await runtime.close();
});
it('does not repeatedly restart a failing polling fallback or acknowledge an unprotected app save', async () => {
  vi.stubEnv('OD_WATCHER_USE_POLLING', undefined); vi.stubEnv('CHOKIDAR_USEPOLLING', undefined);
  const unavailable = () => Object.assign(new EventEmitter(), { close: vi.fn(async () => undefined) });
  const native = unavailable(), polling = unavailable();
  const watch = vi.spyOn(chokidar, 'watch');
  for (const source of [native, polling]) watch.mockImplementationOnce(() => {
    queueMicrotask(() => source.emit('error', Object.assign(new Error('Persistent Windows permission failure'), { code: 'EPERM' })));
    return source as unknown as ReturnType<typeof chokidar.watch>;
  });
  const f = await fixture(), file = path.join(f.projectRoot, 'report.md'); await writeFile(file, 'before');
  const runtime = f.create(), write = vi.fn(async () => { await writeFile(file, 'should not be acknowledged'); return 'saved'; });
  await expect(withProjectHistoryMutation({ root: f.projectRoot, projectId: 'p', paths: ['report.md'] }, write)).rejects.toThrow('Persistent Windows permission failure');
  expect(write).not.toHaveBeenCalled(); expect(await readFile(file, 'utf8')).toBe('before');
  expect(watch).toHaveBeenCalledTimes(2); expect(native.close).toHaveBeenCalledOnce(); expect(polling.close).toHaveBeenCalledOnce();
  await runtime.close();
});
it('durably captures actual imported-project write, rename and delete promises and recovers binary bytes', async () => {
  const f = await fixture(), runtime = f.create(), metadata = { baseDir: f.projectRoot };
  const store = await runtime.store('p', f.projectRoot);
  const bytes = Buffer.from([0, 255, 17, 128, 0, 42]);
  await writeProjectFile(f.root, 'p', 'drawing.bin', bytes, {}, metadata);
  const written = (await store.list()).status.revision!;
  expect((await store.version(written)).files.map(file => file.path)).toEqual(['drawing.bin']);
  await renameProjectFile(f.root, 'p', 'drawing.bin', 'renamed.bin', metadata);
  const renamed = (await store.list()).status.revision!;
  expect(renamed).not.toBe(written);
  expect((await store.version(renamed)).files.map(file => file.path)).toEqual(['renamed.bin']);
  await deleteProjectFile(f.root, 'p', 'renamed.bin', metadata);
  const deleted = (await store.list()).status.revision!;
  expect(deleted).not.toBe(renamed); expect((await store.version(deleted)).files).toEqual([]);
  await store.restore({ entryId: written, baseRevision: deleted });
  expect(await readFile(path.join(f.projectRoot, 'drawing.bin'))).toEqual(bytes);
});
it('reopens registered projects and reconciles offline writes while excluding a prepared symlink', async () => {
  const f = await fixture(), file = path.join(f.projectRoot, 'report.md'), outside = path.join(f.root, 'outside');
  await mkdir(outside); await writeFile(path.join(outside, 'private.md'), 'outside content');
  await symlink(outside, path.join(f.projectRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(file, 'before shutdown'); const runtime = f.create(); await runtime.start();
  const store = await runtime.store('p', f.projectRoot), before = (await store.list()).status.revision!;
  expect((await store.version(before)).files.map(item => item.path)).toEqual(['report.md']);
  await runtime.close(); await writeFile(file, 'offline change');
  const restarted = f.create(); await restarted.start(); const reopened = await restarted.store('p', f.projectRoot), after = (await reopened.list()).status.revision!;
  expect((await reopened.compare(before, after)).changes[0]?.afterText).toBe('offline change');
  expect((await reopened.version(after)).files.map(item => item.path)).toEqual(['report.md']); expect(f.errors).toEqual([]);
});
