import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlockoutDocument } from '@open-design/contracts';
import { readBlockoutDesignState, recordBlockoutDesign, type BlockoutDesignRun } from '../../src/services/blockout-design.js';
import { saveBlockoutWorkspace, saveBlockoutWorkspaceStartingPoint } from '../../src/services/blockout-workspaces.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let root: string;
let run: BlockoutDesignRun;
const document = createBlockoutDocument(); document.title = 'Relazione B';
document.approval = { variantId: 'brief', acceptedAt: '2026-10-26T10:00:00Z' };
document.variants[0]!.pages[0]!.blocks = [{ id: 'body', label: 'Testo', kind: 'text', box: { x: 10, y: 10, width: 80, height: 60, rotation: 0 }, images: [], references: [], lockRatio: false, expectation: '', feedback: '', flexibility: 'guided' }];
const design = () => path.join(root, 'blockouts', document.documentId, 'design');
const stored = async () => JSON.parse(await readFile(path.join(design(), 'state.json'), 'utf8')) as { applied: unknown; pending: { status: string }[] };
const getRun = (id: string) => id === 'run' ? run : undefined;
const reconcile = () => readBlockoutDesignState(root, document.documentId, 'project', getRun);
const isState = (target: unknown) => path.basename(String(target)) === 'state.json';
const scratch = async () => (await readdir(design(), { recursive: true })).filter((file) => file.endsWith('.tmp'));
const locked = (code: string, message: string) => Object.assign(new Error(message), { code });
beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockReset().mockImplementation(actual.rename);
  root = await mkdtemp(path.join(tmpdir(), 'melillo-design-atomic-'));
  const saved = await saveBlockoutWorkspace(root, document.documentId, { document, baseRaw: null });
  const request = await saveBlockoutWorkspaceStartingPoint(root, document.documentId, { document: saved.document, baseRaw: saved.raw, requestId: 'initial', action: 'develop-design' });
  await writeFile(path.join(root, 'report.html'), `<html><body><article data-blockout-document-id="${document.documentId}" data-blockout-page-id="page-1"><p data-blockout-id="body">Testo</p></article></body></html>`);
  run = { projectId: 'project', status: 'running' };
  await recordBlockoutDesign(root, document.documentId, 'project', { handoffId: request.handoff.id, runId: 'run', entryFile: 'report.html',
    pages: [{ pageId: 'page-1', filePath: 'report.html', widthPx: 794, heightPx: 1123, blocks: [{ blockId: 'body', box: { x: 12, y: 13, width: 76, height: 63, rotation: 0 } }] }] }, getRun);
  run = { projectId: 'project', status: 'succeeded', deliverableValid: true };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('atomic Blockout design state writes', () => {
  it('retries a transient Windows destination lock instead of failing the reconciliation', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const seen: string[] = [];
    let locks = 1;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (isState(to) && locks-- > 0) {
        seen.push((await stored()).pending[0]!.status);
        throw locked('EPERM', 'EPERM: operation not permitted, rename');
      }
      return actual.rename(from, to);
    });
    expect((await reconcile()).applied).not.toBeNull();
    expect(seen).toEqual(['pending']);
    expect((await stored()).pending[0]!.status).toBe('applied');
    expect(await scratch()).toEqual([]);
  });

  it('bounds lock retries, keeps the previous state and leaves no scratch file behind', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockClear().mockImplementation(async (from, to) => {
      if (isState(to)) throw locked('EACCES', 'Still locked');
      return actual.rename(from, to);
    });
    await expect(reconcile()).rejects.toThrow('Still locked');
    expect(vi.mocked(rename).mock.calls.filter(([, to]) => isState(to))).toHaveLength(6);
    expect(await stored()).toMatchObject({ applied: null, pending: [{ status: 'pending' }] });
    expect(await scratch()).toEqual([]);
  });
});
