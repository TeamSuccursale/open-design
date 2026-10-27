// A run asks the `--help` probe whether the installed Claude Code takes
// `--effort`. A probe that cannot read the help (a timeout while the machine
// is busy, a transient spawn error) knows nothing about the CLI, so it must
// not be remembered as "no flags": that answer used to stick until the daemon
// restarted, failing every Claude Code run that set an effort level.
import { afterEach, test } from 'vitest';
import { existsSync } from 'node:fs';
import { agentCapabilities } from '../../src/runtimes/capabilities.js';
import { detectAgent, ensureDetectedRuntimeCapabilities } from '../../src/runtimes/detection.js';
import { AGENT_DEFS } from '../../src/runtimes/registry.js';
import { assert, chmodSync, join, mkdtempSync, rmSync, tmpdir, writeFileSync } from './helpers/test-helpers.js';

const dirs: string[] = [];

afterEach(() => {
  agentCapabilities.delete('claude');
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fake `claude` whose `-p --help` fails until the test creates `help-ok`. */
function fakeClaude(): { bin: string; helpOk: string } {
  const dir = mkdtempSync(join(tmpdir(), 'od-claude-capability-'));
  dirs.push(dir);
  const helpOk = join(dir, 'help-ok');
  if (process.platform === 'win32') {
    const bin = join(dir, 'claude.cmd');
    writeFileSync(bin, [
      '@echo off',
      'if "%~1"=="--version" echo 2.1.296 Claude Code& exit /b 0',
      'if "%~2"=="--help" goto help',
      'exit /b 0',
      ':help',
      'if not exist "%~dp0help-ok" exit /b 1',
      'echo   --effort LEVEL  --include-partial-messages  --add-dir',
      'exit /b 0',
      '',
    ].join('\r\n'));
    return { bin, helpOk };
  }
  const bin = join(dir, 'claude');
  writeFileSync(bin, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "2.1.296 (Claude Code)"; exit 0; fi',
    'if [ "$2" = "--help" ]; then',
    `  [ -f "${helpOk}" ] || exit 1`,
    '  echo "  --effort <level>  --include-partial-messages  --add-dir"; exit 0',
    'fi',
    'exit 0',
    '',
  ].join('\n'));
  chmodSync(bin, 0o755);
  return { bin, helpOk };
}

test('a Claude Code help probe that fails is not remembered, so the next run probes again', async () => {
  const { bin, helpOk } = fakeClaude();
  const env = { CLAUDE_BIN: bin };

  const unread = await ensureDetectedRuntimeCapabilities('claude', env);
  assert.notEqual(unread?.effort, true);

  writeFileSync(helpOk, '');
  assert.ok(existsSync(helpOk));
  const read = await ensureDetectedRuntimeCapabilities('claude', env);
  assert.equal(read?.effort, true);
  assert.equal(agentCapabilities.get('claude')?.effort, true);
});

test('a failed help probe during agent detection keeps the flags an earlier probe read', async () => {
  const { bin, helpOk } = fakeClaude();
  const env = { CLAUDE_BIN: bin };
  writeFileSync(helpOk, '');
  assert.equal((await ensureDetectedRuntimeCapabilities('claude', env))?.effort, true);

  rmSync(helpOk);
  const claude = AGENT_DEFS.find((def) => def.id === 'claude')!;
  await detectAgent(claude, env);

  assert.equal(agentCapabilities.get('claude')?.effort, true);
  assert.equal((await ensureDetectedRuntimeCapabilities('claude', env))?.effort, true);
});
