import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectCustodianJournal } from '../../src/services/project-custodian-journal.js';

const temporary: string[] = [];
async function setup() { const root = await mkdtemp(path.join(tmpdir(), 'custodian-journal-')); temporary.push(root); return { root, journal: new ProjectCustodianJournal(root, () => 0) }; }
afterEach(async () => { await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
describe('project custodian journal', () => {
  it('requires the resolved absolute daemon data root', () => { expect(() => new ProjectCustodianJournal('relative')).toThrow('absolute'); });
  it('serializes concurrent writers across service instances and verifies ordered ancestry', async () => {
    const { root, journal } = await setup(); const other = new ProjectCustodianJournal(root, () => 1);
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? other : journal).append('project', { domain: 'text', type: 'query', summary: `query ${i}` })));
    const history = await journal.read('project'); expect(history.verified).toBe(true); expect(history.events).toHaveLength(20);
    expect(history.events.map((event) => event.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(history.events[0]!.parentRevision).toBeNull(); expect(history.events[19]!.parentRevision).toBe(history.events[18]!.revision);
    expect((await other.read('project')).revision).toBe(history.revision);
  });
  it('bounds the UI tail without discarding old events', async () => {
    const { journal } = await setup();
    for (let i = 0; i < 102; i++) await journal.append('project', { domain: 'images', type: 'gap', summary: String(i) });
    const history = await journal.read('project', { limit: 10000 }); expect(history.events).toHaveLength(100); expect(history.events[0]!.seq).toBe(3);
    expect((await journal.read('project', { limit: 2 })).events.map((event) => event.seq)).toEqual([101, 102]);
  });
  it('detects modified entries and refuses subsequent writes', async () => {
    const { root, journal } = await setup(); await journal.append('project', { domain: 'project', type: 'sources-changed', summary: 'original' });
    const [key] = await readdir(path.join(root, 'project-custodians')); const file = path.join(root, 'project-custodians', key!, 'journal', '000000000001.json');
    const changed = JSON.parse(await readFile(file, 'utf8')); changed.summary = 'tampered'; await writeFile(file, JSON.stringify(changed));
    await expect(journal.read('project')).rejects.toThrow('integrity');
    await expect(journal.append('project', { domain: 'text', type: 'query', summary: 'later' })).rejects.toThrow('integrity');
  });
  it('detects deletion of the last event through its independent head', async () => {
    const { root, journal } = await setup(); await journal.append('project', { domain: 'project', type: 'sources-changed', summary: 'original' });
    const [key] = await readdir(path.join(root, 'project-custodians')); await rm(path.join(root, 'project-custodians', key!, 'journal', '000000000001.json'));
    await expect(journal.read('project')).rejects.toThrow('head integrity');
  });
  it('keeps index snapshots immutable, source order stable, and query events out of index revisions', async () => {
    const { journal } = await setup(); const one = await journal.snapshot('project', { domain: 'text', sources: ['b', 'a'], index: { findings: [1], coverage: { full: true } } });
    await journal.append('project', { domain: 'text', type: 'query', summary: 'A local lookup' });
    const unchanged = await journal.snapshot('project', { domain: 'text', sources: ['b', 'a'], index: { coverage: { full: true }, findings: [1] } });
    expect(unchanged.revision).toBe(one.revision);
    const two = await journal.snapshot('project', { domain: 'text', sources: ['a', 'b'], index: { findings: [1] } });
    expect(two.parentRevision).toBe(one.revision); const history = await journal.snapshots('project', 'text');
    expect(history.map((entry) => entry.revision)).toEqual([two.revision, one.revision]); expect(history[1]!.sources).toEqual(['b', 'a']);
    expect(await journal.snapshots('project', 'images')).toEqual([]);
  });
});
