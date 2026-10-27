import { execFile } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const daemonRoot = fileURLToPath(new URL('..', import.meta.url));
const cliEntry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

// On Windows, forcing process.exit while libuv still has close callbacks or thread-pool work pending aborts Node
// ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c") with exit code 127, so a
// command that printed its result looked failed to every script and agent that checks the exit code. A result of a
// few hundred kilobytes, such as the project list on a PC with real projects, is enough to leave the stdout write
// pending.
describe('od exits cleanly after a successful command', () => {
  let server: http.Server;
  let daemonUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/projects') {
        const projects = Array.from({ length: 400 }, (_, i) => ({ id: `p${i}`, name: 'Passerelle', description: 'x'.repeat(600) }));
        res.end(JSON.stringify({ projects }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'not found' } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    daemonUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('returns exit code 0 with the output intact', async () => {
    const runs = await Promise.all([0, 1, 2].map(() =>
      execFileAsync(process.execPath, ['--import', 'tsx', cliEntry, 'project', 'list', '--json', '--daemon-url', daemonUrl], {
        cwd: daemonRoot,
        env: { ...process.env },
      }).then(
        (result) => ({ code: 0, output: `${result.stdout}${result.stderr}` }),
        (error: { code?: number; stdout?: string; stderr?: string }) => ({ code: error.code, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }),
      )));
    for (const run of runs) {
      expect(run.output).not.toContain('Assertion failed');
      expect(run.code).toBe(0);
      expect(run.output).toContain('"Passerelle"');
    }
  }, 120_000);
});
