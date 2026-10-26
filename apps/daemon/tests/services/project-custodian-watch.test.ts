import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, utimes } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { ProjectMetadata } from '@open-design/contracts';
import { ProjectCustodianJournal } from '../../src/services/project-custodian-journal.js';
import { ProjectCustodianWatch, scanCustodianManifest, type CustodianManifestEntry, type CustodianManifest, type CustodianWorkRequest } from '../../src/services/project-custodian-watch.js';
const temporary: string[] = [], watches: ProjectCustodianWatch[] = [];
const metadata = { kind: 'other' } as ProjectMetadata;
const entry = (name: string, hash = 'a', kind: 'document' | 'image' = 'document'): CustodianManifestEntry => ({ path: name, size: 3, mtimeMs: 1, hash, kind });
async function setup() { const root = await mkdtemp(path.join(tmpdir(), 'custodian-watch-')); temporary.push(root); return { root, journal: new ProjectCustodianJournal(root) }; }
afterEach(async () => { for (const watch of watches.splice(0)) watch.close(); vi.useRealTimers(); await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
describe('active project custodian coordinator', () => {
  it('indexes initial sources once, gates images on fresh persisted consent, and resumes after consent', async () => {
    const { root, journal } = await setup(); let consent = false;
    const text = vi.fn(async () => undefined), images = vi.fn(async () => undefined), readConsent = vi.fn(async () => consent);
    const watch = new ProjectCustodianWatch({ journal, enqueueText: text, enqueueImages: images, imageConsent: readConsent,
      scan: async () => ({ entries: [entry('one.pdf')], gaps: [] }) }); watches.push(watch);
    await watch.activate({ projectId: 'p', root, metadata, active: true }); await watch.waitForIdle('p');
    expect(text).toHaveBeenCalledTimes(1); expect(images).not.toHaveBeenCalled(); expect(watch.status('p').phase).toBe('partial');
    await watch.check('p'); await watch.waitForIdle('p'); expect(text).toHaveBeenCalledTimes(1);
    consent = true; await watch.check('p'); await watch.waitForIdle('p'); expect(images).toHaveBeenCalledTimes(1);
    expect(watch.status('p').phase).toBe('idle'); expect(watch.status('p').pendingDomains).toEqual([]);
    expect((await journal.read('p')).events.map((event) => event.type)).toContain('index-completed');
  });
  it('coalesces changes arriving during running work into a followup batch without duplicate starts', async () => {
    const { root, journal } = await setup(); let entries = [entry('one.pdf')]; let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const text = vi.fn().mockImplementationOnce(() => blocked).mockResolvedValue(undefined);
    const watch = new ProjectCustodianWatch({ journal, enqueueText: text, enqueueImages: async () => undefined, imageConsent: async () => true,
      scan: async () => ({ entries, gaps: [] }) }); watches.push(watch);
    await watch.activate({ projectId: 'p', root, metadata, active: true });
    // Await the start signal rather than sleeping for disk-based journal writes.
    while (text.mock.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));
    entries = [entry('one.pdf', 'b'), entry('two.pdf')]; await watch.check('p'); await watch.check('p');
    expect(text).toHaveBeenCalledTimes(1); release(); await watch.waitForIdle('p');
    expect(text).toHaveBeenCalledTimes(2); expect(text.mock.calls[1]![0].changedPaths).toEqual(['one.pdf', 'two.pdf']);
    expect(watch.status('p').phase).toBe('idle');
  });
  it('polls only during the active lease and resumes when the visible project renews it', async () => {
    vi.useFakeTimers(); const { root, journal } = await setup(); let now = 0, hash = 'a';
    const scan = vi.fn(async () => ({ entries: [entry('one.pdf', hash)], gaps: [] }));
    const text = vi.fn(async () => undefined), images = vi.fn(async () => undefined);
    const watch = new ProjectCustodianWatch({ journal, scan, enqueueText: text, enqueueImages: images, imageConsent: async () => true, now: () => now, pollMs: 30, leaseMs: 90 }); watches.push(watch);
    await watch.activate({ projectId: 'p', root, metadata, active: true }); await watch.waitForIdle('p'); expect(scan).toHaveBeenCalledTimes(1);
    now = 30; await vi.advanceTimersByTimeAsync(30); await watch.waitForIdle('p'); expect(scan).toHaveBeenCalledTimes(2);
    hash = 'b'; now = 90; await vi.advanceTimersByTimeAsync(60); await watch.waitForIdle('p'); expect(scan).toHaveBeenCalledTimes(2); expect(text).toHaveBeenCalledTimes(1);
    await watch.activate({ projectId: 'p', root, metadata, active: true }); await watch.waitForIdle('p'); expect(text).toHaveBeenCalledTimes(2);
    watch.deactivate('p'); now = 100; await vi.advanceTimersByTimeAsync(30); expect(scan).toHaveBeenCalledTimes(3);
  });
  it('lets an already running text job finish after lease expiry without starting images', async () => {
    const { root, journal } = await setup(); let now = 0, release!: () => void;
    const started = new Promise<void>((resolve) => { release = resolve; });
    const images = vi.fn(async () => undefined), text = vi.fn(async () => { await started; });
    const watch = new ProjectCustodianWatch({ journal, enqueueText: text, enqueueImages: images, imageConsent: async () => true, now: () => now, leaseMs: 90,
      scan: async () => ({ entries: [entry('one.pdf')], gaps: [] }) }); watches.push(watch);
    await watch.activate({ projectId: 'p', root, metadata, active: true });
    while (text.mock.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));
    now = 90; release(); await watch.waitForIdle('p'); expect(text).toHaveBeenCalledTimes(1); expect(images).not.toHaveBeenCalled();
    expect(watch.status('p').phase).toBe('partial'); expect(watch.status('p').pendingDomains).toEqual(['images']);
    await watch.activate({ projectId: 'p', root, metadata, active: true }); await watch.waitForIdle('p'); expect(images).toHaveBeenCalledTimes(1);
  });
  it('does not treat missing entries from a bounded scan as deletions', async () => {
    const { root, journal } = await setup(); let manifest: CustodianManifest = { entries: [entry('one.pdf')], gaps: [] };
    const text = vi.fn(async (_request: CustodianWorkRequest) => undefined);
    const watch = new ProjectCustodianWatch({ journal, enqueueText: text, enqueueImages: async () => undefined, imageConsent: async () => true,
      scan: async () => manifest }); watches.push(watch);
    await watch.activate({ projectId: 'p', root, metadata, active: true }); await watch.waitForIdle('p');
    manifest = { entries: [], gaps: ['Source access blocked.'] }; await watch.check('p'); await watch.waitForIdle('p');
    expect(text).toHaveBeenCalledTimes(1); expect(watch.status('p').phase).toBe('partial');
    manifest = { entries: [], gaps: [] }; await watch.check('p'); await watch.waitForIdle('p');
    expect(text).toHaveBeenCalledTimes(2); expect(text.mock.calls[1]![0].changedPaths).toEqual(['one.pdf']);
  });
  it('retains partial job coverage and failed queues without labeling the project complete', async () => {
    const { root, journal } = await setup(); let now = 0; const text = vi.fn().mockRejectedValueOnce(new Error('reader unavailable')).mockResolvedValue({ partial: true, message: '20 of 25 pages read' });
    const watch = new ProjectCustodianWatch({ journal, enqueueText: text, enqueueImages: async () => undefined, imageConsent: async () => true, now: () => now,
      scan: async () => ({ entries: [entry('one.pdf')], gaps: [] }) }); watches.push(watch);
    await watch.activate({ projectId: 'p', root, metadata, active: true }); await watch.waitForIdle('p'); expect(watch.status('p').phase).toBe('failed'); expect(watch.status('p').pendingDomains).toContain('text');
    await watch.check('p'); await watch.waitForIdle('p'); expect(text).toHaveBeenCalledTimes(1);
    now = 30_000; await watch.check('p'); await watch.waitForIdle('p'); expect(watch.status('p').phase).toBe('partial'); expect(text).toHaveBeenCalledTimes(2);
    await watch.check('p'); await watch.waitForIdle('p'); expect(watch.status('p').phase).toBe('partial');
  });
  it('reuses successful domain hashes after restart and keeps plain text out of image work', async () => {
    const { root, journal } = await setup(); const text = vi.fn(async () => undefined), images = vi.fn(async () => undefined);
    const options = { journal, enqueueText: text, enqueueImages: images, imageConsent: async () => true,
      scan: async () => ({ entries: [entry('one.pdf'), entry('notes.txt')], gaps: [] }) };
    const first = new ProjectCustodianWatch(options); watches.push(first);
    await first.activate({ projectId: 'p', root, metadata, active: true }); await first.waitForIdle('p'); first.close();
    const next = new ProjectCustodianWatch(options); watches.push(next);
    await next.activate({ projectId: 'p', root, metadata, active: true }); await next.waitForIdle('p');
    expect(text).toHaveBeenCalledTimes(1); expect(images).toHaveBeenCalledTimes(1);
    expect((images.mock.calls as unknown as [CustodianWorkRequest][])[0]![0].changedPaths).toEqual(['one.pdf']);
    expect(next.status('p').phase).toBe('idle');
  });
});
describe('bounded source manifest', () => {
  it('ignores generated/hidden paths, respects custom output exclusion, and hashes same-size edits', async () => {
    const { root } = await setup();
    for (const directory of ['sources', 'designs', 'blockout', 'output', 'exports', 'intake-assets', '.hidden', 'node_modules', 'custom-results']) {
      await mkdir(path.join(root, directory)); await writeFile(path.join(root, directory, 'one.pdf'), directory);
    }
    await writeFile(path.join(root, 'sources', 'photo.png'), 'photo'); await writeFile(path.join(root, 'sources', 'drawing.svg'), '<svg/>');
    const exclusions = [path.join(root, 'custom-results')]; const first = await scanCustodianManifest([root], [], exclusions);
    expect(first.gaps).toEqual([]); expect(first.entries.map((source) => path.basename(source.path))).toEqual(['one.pdf', 'photo.png']);
    const file = path.join(root, 'sources', 'one.pdf'); await writeFile(file, 'changed'); await utimes(file, new Date(10000), new Date(10000));
    const next = await scanCustodianManifest([root], first.entries, exclusions); expect(next.entries[0]!.size).toBe(first.entries[0]!.size); expect(next.entries[0]!.hash).not.toBe(first.entries[0]!.hash);
  });
  it('reports scan bounds instead of claiming complete coverage', async () => {
    const { root } = await setup(); let directory = root;
    for (let i = 0; i < 7; i++) { directory = path.join(directory, 'nested'); await mkdir(directory); }
    await writeFile(path.join(directory, 'deep.pdf'), 'deep');
    const result: CustodianManifest = await scanCustodianManifest([root]); expect(result.entries).toEqual([]); expect(result.gaps.join(' ')).toContain('Depth limit');
    const refused = await scanCustodianManifest([path.parse(root).root]); expect(refused.gaps.join(' ')).toContain('Disallowed source root');
  });
});
