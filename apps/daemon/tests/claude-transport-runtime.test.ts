import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../src/server.js';

describe('Claude transport recovery through HTTP and native child processes', () => {
  let started: { url: string; server: Server; shutdown?: () => Promise<void> | void } | undefined;
  let fixtureDir: string | undefined;
  const oldEnv = { ...process.env };
  afterEach(async () => {
    await started?.shutdown?.();
    if (started?.server) await new Promise<void>((resolve) => started!.server.close(() => resolve()));
    if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  });

  async function setup(mode: 'silent' | 'hook') {
    process.env.OD_NEXT_STRATEGY_ROLLOUT = 'off';
    process.env.OD_CHAT_RUN_FIRST_OUTPUT_TIMEOUT_MS = '3000';
    process.env.OD_CHAT_RUN_INACTIVITY_TIMEOUT_MS = '30000';
    process.env.OD_CHAT_RUN_INACTIVITY_KILL_GRACE_MS = '200';
    fixtureDir = await mkdtemp(path.join(tmpdir(), 'od-claude-transport-'));
    const script = path.join(fixtureDir, 'fixture.cjs');
    const log = path.join(fixtureDir, 'launches.jsonl');
    const body = `
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('Claude Code 2.1.296'); process.exit(0); }
if (args.includes('--help')) { console.log('--effort --add-dir'); process.exit(0); }
if (args.includes('auth')) { console.log(JSON.stringify({loggedIn:true})); process.exit(0); }
if (!args.includes('--input-format')) { console.error('unknown option'); process.exit(1); }
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args})+'\\n');
if (${JSON.stringify(mode)} === 'silent' && args[args.indexOf('--input-format')+1] === 'stream-json') {
  setTimeout(() => process.exit(1), 60000);
} else {
  let input='';
  const answer=()=>{
    if (${JSON.stringify(mode)} === 'silent') fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({inputLength:input.length, hasLastRequest:input.includes('LAST_REQUEST_MUST_SURVIVE_é_漢字')})+'\\n');
    console.log(JSON.stringify({type:'assistant', message:{id:'msg-'+Date.now(),content:[{type:'text',text:'TRANSPORT_OK'}],stop_reason:'end_turn'}}));
    console.log(JSON.stringify({type:'result',is_error:false,result:'TRANSPORT_OK',duration_ms:1}));
    if (${JSON.stringify(mode)} === 'hook') setInterval(()=>{},1000);
    else setTimeout(()=>process.exit(0),20);
  };
  process.stdin.setEncoding('utf8');
  if (${JSON.stringify(mode)} === 'hook') { process.stdin.once('data',answer); }
  else { process.stdin.on('data',chunk=>input+=chunk); process.stdin.on('end',answer); }
}
`;
    await writeFile(script, body);
    const bin = path.join(fixtureDir, process.platform === 'win32' ? 'claude-fixture.cmd' : 'claude-fixture');
    await writeFile(bin, process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${script.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 });
    started = await startServer({ port: 0, returnServer: true }) as NonNullable<typeof started>;
    const url = started.url;
    const config = await fetch(`${url}/api/app-config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: 'claude', agentCliEnv: { claude: { CLAUDE_BIN: bin } }, telemetry: { metrics: false, content: false, artifactManifest: false } }) });
    expect(config.status).toBe(200);
    return { url, log };
  }

  async function run(url: string, message: string) {
    const project = await fetch(`${url}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: randomUUID(), name: 'Claude transport fixture', metadata: { kind: 'prototype' }, skipDiscoveryBrief: true }) });
    const p = await project.json() as { id?: string; project?: { id?: string }; conversationId?: string };
    const response = await fetch(`${url}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: p.id ?? p.project?.id, conversationId: p.conversationId, assistantMessageId: randomUUID(), clientRequestId: randomUUID(), agentId: 'claude', message, currentPrompt: message }) });
    expect(response.status).toBe(202);
    const { runId } = await response.json() as { runId: string };
    const events = await fetch(`${url}/api/runs/${runId}/events`, { signal: AbortSignal.timeout(60000) });
    const stream = await events.text();
    const status = await fetch(`${url}/api/runs/${runId}`).then(r => r.json()) as { status: string };
    return { status, stream };
  }

  it('retries a silent start once with the complete large prompt on file-backed stdin', async () => {
    const { url, log } = await setup('silent');
    const marker = 'LAST_REQUEST_MUST_SURVIVE_é_漢字';
    const { status, stream } = await run(url, 'test '.repeat(50000) + marker);
    expect(status.status).toBe('succeeded');
    expect(stream).toContain('TRANSPORT_OK');
    expect(stream).toContain('claude_input_transport_recovery');
    const launches = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(launches.filter(row => row.args)).toHaveLength(2);
    expect(launches.find(row => row.inputLength)?.inputLength).toBeGreaterThan(250000);
    expect(launches.find(row => row.inputLength)?.hasLastRequest).toBe(true);
    expect(launches.filter(row => row.args).map(row => row.args[row.args.indexOf('--input-format')+1])).toEqual(['stream-json', 'text']);
  }, 90000);

  it('finishes a successful native result even when a SessionEnd hook never exits', async () => {
    const { url } = await setup('hook');
    const began = Date.now();
    const { status, stream } = await run(url, 'Reply briefly.');
    expect(status.status).toBe('succeeded');
    expect(stream).toContain('TRANSPORT_OK');
    expect(Date.now() - began).toBeLessThan(26000);
  }, 30000);
});
