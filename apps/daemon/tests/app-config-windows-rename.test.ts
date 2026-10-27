import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// On Windows a rename over a file another process holds open fails with EPERM or EBUSY. The data root of the
// team PCs held 29 app-config.json.*.tmp files after four days: each one a settings save that failed.
const failures = vi.hoisted(() => ({ remaining: 0, code: 'EPERM' }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (failures.remaining > 0 && to.endsWith('app-config.json')) {
        failures.remaining -= 1;
        throw Object.assign(new Error(`${failures.code}: operation not permitted, rename`), { code: failures.code });
      }
      return actual.rename(from, to);
    },
  };
});

const { writeAppConfig } = await import('../src/app-config.js');
const roots: string[] = [];
afterEach(async () => { failures.remaining = 0; for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function dataDir() { const root = await mkdtemp(path.join(tmpdir(), 'od-app-config-rename-')); roots.push(root); return root; }

describe('app config writes on Windows', () => {
  it('saves through a brief sharing violation instead of failing the settings save', async () => {
    const dir = await dataDir();
    failures.remaining = 2; failures.code = 'EBUSY';
    await writeAppConfig(dir, { onboardingCompleted: true });
    expect(JSON.parse(await readFile(path.join(dir, 'app-config.json'), 'utf8')).onboardingCompleted).toBe(true);
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('leaves no temporary file behind when the rename keeps failing', async () => {
    const dir = await dataDir();
    failures.remaining = 1_000; failures.code = 'EPERM';
    await expect(writeAppConfig(dir, { onboardingCompleted: true })).rejects.toMatchObject({ code: 'EPERM' });
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
