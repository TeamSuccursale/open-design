import { rename } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Atomically replace `target` with `temporary`. Windows readers and antivirus may briefly
 * lock the destination; the previous valid file stays in place while the rename is retried.
 * The caller owns `temporary` and removes it when the replacement rejects.
 */
export async function replaceFileAtomically(temporary: string, target: string): Promise<void> {
  const backoff = [25, 50, 100, 200, 400];
  for (let attempt = 0; ; attempt += 1) {
    try { await rename(temporary, target); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt >= backoff.length) throw error;
      await delay(backoff[attempt]);
    }
  }
}
