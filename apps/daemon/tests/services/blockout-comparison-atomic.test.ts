import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assessBlockoutStructure, createBlockoutDocument } from '@open-design/contracts';
import { blockoutComparisonPath, saveStructuralBlockoutComparison } from '../../src/services/blockout-comparison.js';
import { readBlockoutWorkspace, saveBlockoutWorkspace } from '../../src/services/blockout-workspaces.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let root: string;
const document = createBlockoutDocument(); document.title = 'Relazione B';
const relative = blockoutComparisonPath(document);
const comparison = () => readFile(path.join(root, relative), 'utf8');
const isComparison = (target: unknown) => path.basename(String(target)) === 'blockout-comparison.html';
const locked = (code: string, message: string) => Object.assign(new Error(message), { code });
async function publish(label: string): Promise<string | null> {
  const { raw } = await readBlockoutWorkspace(root, document.documentId);
  const next = structuredClone(document); next.variants[0]!.label = label;
  const saved = await saveBlockoutWorkspace(root, document.documentId, { document: next, baseRaw: raw });
  const assessment = assessBlockoutStructure(saved.document!, { documentRevision: createHash('sha256').update(JSON.stringify(saved.document)).digest('hex') });
  return saveStructuralBlockoutComparison(root, saved.document!, saved.raw!, assessment);
}
beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockReset().mockImplementation(actual.rename);
  root = await mkdtemp(path.join(tmpdir(), 'melillo-comparison-atomic-'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('atomic Blockout comparison writes', () => {
  it('retries a transient Windows destination lock instead of failing the publication', async () => {
    await publish('Proposta A');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const seen: boolean[] = [];
    let locks = 1;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (isComparison(to) && locks-- > 0) {
        seen.push((await comparison()).includes('Proposta A'));
        throw locked('EPERM', 'EPERM: operation not permitted, rename');
      }
      return actual.rename(from, to);
    });
    expect(await publish('Proposta B')).toBe(relative);
    expect(seen).toEqual([true]);
    expect(await comparison()).toContain('Proposta B');
    expect(await readdir(path.dirname(path.join(root, relative)))).toEqual(['blockout-comparison.html']);
  });

  it('bounds lock retries, keeps the previous comparison and leaves no scratch file behind', async () => {
    await publish('Proposta A');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockClear().mockImplementation(async (from, to) => {
      if (isComparison(to)) throw locked('EACCES', 'Still locked');
      return actual.rename(from, to);
    });
    await expect(publish('Proposta B')).rejects.toThrow('Still locked');
    expect(vi.mocked(rename).mock.calls.filter(([, to]) => isComparison(to))).toHaveLength(6);
    expect(await comparison()).toContain('Proposta A');
    expect(await readdir(path.dirname(path.join(root, relative)))).toEqual(['blockout-comparison.html']);
  });
});
