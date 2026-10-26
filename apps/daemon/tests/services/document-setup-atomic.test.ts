import { mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCUMENT_SETUP_PATH, type DocumentSetupIntent } from '@open-design/contracts';
import { readDocumentSetup, saveDocumentSetupIntent } from '../../src/services/document-setup.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let root: string;
const intent: DocumentSetupIntent = { kind: 'tender-offer', subtype: 'Offerta tecnica servizi di ingegneria', purpose: 'Presentare le esperienze', contextRoots: [], imageIntakeConsent: false, imageIntakeDecision: 'declined' };
const purpose = async () => (await readDocumentSetup(root))!.intent.purpose;
const folder = () => path.dirname(path.join(root, DOCUMENT_SETUP_PATH));
const isSetup = (target: unknown) => path.basename(String(target)) === path.basename(DOCUMENT_SETUP_PATH);
const locked = (code: string, message: string) => Object.assign(new Error(message), { code });
beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockReset().mockImplementation(actual.rename);
  root = await mkdtemp(path.join(tmpdir(), 'melillo-setup-atomic-'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('atomic document setup writes', () => {
  it('retries a transient Windows destination lock instead of failing the save', async () => {
    await saveDocumentSetupIntent(root, intent);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const seen: string[] = [];
    let locks = 1;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (isSetup(to) && locks-- > 0) {
        seen.push(await purpose());
        throw locked('EPERM', 'EPERM: operation not permitted, rename');
      }
      return actual.rename(from, to);
    });
    expect((await saveDocumentSetupIntent(root, { purpose: 'Presentare il gruppo di lavoro' })).intent.purpose).toBe('Presentare il gruppo di lavoro');
    expect(seen).toEqual(['Presentare le esperienze']);
    expect(await purpose()).toBe('Presentare il gruppo di lavoro');
    expect(await readdir(folder())).toEqual([path.basename(DOCUMENT_SETUP_PATH)]);
  });

  it('bounds lock retries, keeps the previous setup and leaves no scratch file behind', async () => {
    await saveDocumentSetupIntent(root, intent);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockClear().mockImplementation(async (from, to) => {
      if (isSetup(to)) throw locked('EACCES', 'Still locked');
      return actual.rename(from, to);
    });
    await expect(saveDocumentSetupIntent(root, { purpose: 'Presentare il gruppo di lavoro' })).rejects.toThrow('Still locked');
    expect(vi.mocked(rename).mock.calls.filter(([, to]) => isSetup(to))).toHaveLength(6);
    expect(await purpose()).toBe('Presentare le esperienze');
    expect(await readdir(folder())).toEqual([path.basename(DOCUMENT_SETUP_PATH)]);
  });
});
