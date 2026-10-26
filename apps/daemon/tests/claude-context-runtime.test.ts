import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isProcessAlive } from '@open-design/platform';

import { startServer } from '../src/server.js';
import { toolTokenRegistry } from '../src/tool-tokens.js';

type StartedServer = { url: string; server: Server; shutdown?: () => Promise<void> | void };
type RunStatus = { id: string; status: string; errorCode: string | null; eventsLogPath: string; retryAttemptCount?: number };
type RunEvent = { event: string; data: Record<string, unknown> };
type Invocation = { args: string[]; prompt: string; sessionId: string; compact: boolean; pid: number; toolGrantStatus: number | null };
type Mode = 'success' | 'compact-fails' | 'compact-waits' | 'repeated-overflow';
const SEED_REQUEST = 'FIRST_REQUEST_MUST_NOT_REPLAY_26b';
const SEED_REPLY = 'FIRST_REPLY_MUST_NOT_REPLAY_82f';
const LATEST_REQUEST = 'LATEST_REQUEST_AFTER_OVERFLOW_4c9';

describe('Claude context recovery through HTTP and native child processes', () => {
  const envKeys = ['OD_NEXT_STRATEGY_ROLLOUT', 'OD_CHAT_RUN_INACTIVITY_TIMEOUT_MS',
    'OD_CHAT_RUN_FIRST_OUTPUT_TIMEOUT_MS', 'OD_CHAT_RUN_INACTIVITY_KILL_GRACE_MS',
    'POSTHOG_KEY', 'POSTHOG_HOST', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY',
    'LANGFUSE_BASE_URL', 'OPEN_DESIGN_TELEMETRY_RELAY_URL'];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  let started: StartedServer | null = null;
  let fixtureDir: string | null = null;

  beforeEach(() => {
    for (const key of envKeys) delete process.env[key];
    process.env.OD_NEXT_STRATEGY_ROLLOUT = 'off';
    process.env.OD_CHAT_RUN_INACTIVITY_TIMEOUT_MS = '10000';
    process.env.OD_CHAT_RUN_FIRST_OUTPUT_TIMEOUT_MS = '10000';
    process.env.OD_CHAT_RUN_INACTIVITY_KILL_GRACE_MS = '200';
  });

  afterEach(async () => {
    await Promise.resolve(started?.shutdown?.());
    if (started?.server) await new Promise<void>((resolve) => started!.server.close(() => resolve()));
    started = null;
    if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
    fixtureDir = null;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  async function setup(mode: Mode): Promise<{ url: string; log: string; projectId: string; conversationId: string }> {
    fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'od-claude-context-'));
    const { bin, log } = await writeFixture(fixtureDir, mode);
    started = await startServer({ port: 0, returnServer: true }) as StartedServer;
    const response = await fetch(`${started.url}/api/app-config`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'claude', agentCliEnv: { claude: { CLAUDE_BIN: bin } },
        telemetry: { metrics: false, content: false, artifactManifest: false }, privacyDecisionAt: Date.now() }),
    });
    expect(response.status).toBe(200);
    const projectId = `claude_context_${randomUUID()}`;
    const projectResponse = await fetch(`${started.url}/api/projects`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: 'Claude context recovery regression', metadata: { kind: 'prototype' }, skipDiscoveryBrief: true }),
    });
    expect(projectResponse.status).toBe(200);
    const project = await projectResponse.json() as { conversationId: string };
    return { url: started.url, log, projectId, conversationId: project.conversationId };
  }

  it('compacts once, retries only the latest request in the same session, and emits no intermediate error', async () => {
    const context = await setup('success');
    expect((await waitForRun(context.url, await sendRun(context, SEED_REQUEST))).status).toBe('succeeded');
    const run = await waitForRun(context.url, await sendRun(context, LATEST_REQUEST));
    expect(run.status).toBe('succeeded');
    const events = await readEvents(run.eventsLogPath);
    expect(events.filter((event) => event.event === 'error')).toEqual([]);
    expect(events.filter((event) => event.event === 'end')).toHaveLength(1);
    expect(events.filter((event) => event.event === 'run_retry_attempted')).toHaveLength(1);
    expect(events.filter((event) => event.event === 'diagnostic' && event.data.type === 'claude_context_recovery')
      .map((event) => event.data.status)).toEqual(['compacting', 'compacted']);
    expect(events.some((event) => event.event === 'agent' && event.data.type === 'text_delta' && event.data.delta === 'CONTEXT_RECOVERED')).toBe(true);
    const launches = await readInvocations(context.log);
    expect(launches).toHaveLength(4);
    const [seed, overflow, compact, retried] = launches as [Invocation, Invocation, Invocation, Invocation];
    expect(seed.args).toContain('--session-id');
    expect(overflow.args).toContain('--resume');
    expect(compact.compact).toBe(true);
    expect(compact.prompt).toBe('/compact\n');
    expect(retried.args).toContain('--resume');
    expect(new Set(launches.map((launch) => launch.sessionId)).size).toBe(1);
    expect(seed.toolGrantStatus).toBe(200);
    expect(overflow.toolGrantStatus).toBe(200);
    // The failed physical attempt's capability is revoked before compaction;
    // the latest-turn restart must mint its own working capability.
    expect([401, 403]).toContain(compact.toolGrantStatus);
    expect(retried.toolGrantStatus).toBe(200);
    expect(toolTokenRegistry.activeRunTokenCount(run.id)).toBe(0);
    for (const launch of [overflow, retried]) {
      expect(launch.prompt).toContain(LATEST_REQUEST);
      expect(launch.prompt).not.toContain(SEED_REQUEST);
      expect(launch.prompt).not.toContain(SEED_REPLY);
    }
    expect(compact.args).toEqual(expect.arrayContaining(['--tools=', '--strict-mcp-config', '--permission-mode', 'dontAsk']));
  // The first isolated server seeds the bundled plugin catalogue. Keep that
  // cold-start cost separate from waitForRun's bounded 15-second run deadline.
  }, 60_000);

  it('preserves the context error when compaction is rejected and does not retry', async () => {
    const context = await setup('compact-fails');
    expect((await waitForRun(context.url, await sendRun(context, SEED_REQUEST))).status).toBe('succeeded');
    const run = await waitForRun(context.url, await sendRun(context, LATEST_REQUEST));
    expect(run.status).toBe('failed');
    expect(run.errorCode).toBe('AGENT_PROMPT_TOO_LARGE');
    const launches = await readInvocations(context.log);
    expect(launches).toHaveLength(3);
    expect(launches.filter((launch) => launch.compact)).toHaveLength(1);
    const events = await readEvents(run.eventsLogPath);
    expect(events.filter((event) => event.event === 'error')).toHaveLength(1);
    expect(events.filter((event) => event.event === 'run_retry_attempted')).toHaveLength(0);
    expect(events.filter((event) => event.event === 'end')).toHaveLength(1);
    expect(toolTokenRegistry.activeRunTokenCount(run.id)).toBe(0);
  }, 25_000);

  it('stops after a second context overflow instead of compacting or replaying again', async () => {
    const context = await setup('repeated-overflow');
    expect((await waitForRun(context.url, await sendRun(context, SEED_REQUEST))).status).toBe('succeeded');
    const run = await waitForRun(context.url, await sendRun(context, LATEST_REQUEST));
    expect(run.status).toBe('failed');
    expect(run.errorCode).toBe('AGENT_PROMPT_TOO_LARGE');
    const launches = await readInvocations(context.log);
    expect(launches).toHaveLength(4);
    expect(launches.filter((launch) => launch.compact)).toHaveLength(1);
    const events = await readEvents(run.eventsLogPath);
    expect(events.filter((event) => event.event === 'run_retry_attempted')).toHaveLength(1);
    expect(events.filter((event) => event.event === 'end')).toHaveLength(1);
    expect(toolTokenRegistry.activeRunTokenCount(run.id)).toBe(0);
  }, 25_000);

  it('Stop owns the compact child and prevents the deferred latest-turn replay', async () => {
    const context = await setup('compact-waits');
    expect((await waitForRun(context.url, await sendRun(context, SEED_REQUEST))).status).toBe('succeeded');
    const runId = await sendRun(context, LATEST_REQUEST);
    const deadline = Date.now() + 10000;
    let compact: Invocation | undefined;
    while (Date.now() < deadline) {
      compact = (await readInvocations(context.log)).find((launch) => launch.compact);
      if (compact) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(compact).toBeDefined();
    const cancel = await fetch(`${context.url}/api/runs/${runId}/cancel`, { method: 'POST' });
    expect(cancel.status).toBe(200);
    const run = await waitForRun(context.url, runId);
    expect(run.status).toBe('canceled');
    // Wait beyond the cancel poll so a deferred replay cannot hide behind the
    // already-terminal HTTP status.
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(await readInvocations(context.log)).toHaveLength(3);
    expect(isProcessAlive(compact!.pid)).toBe(false);
    expect(toolTokenRegistry.activeRunTokenCount(run.id)).toBe(0);
    const events = await readEvents(run.eventsLogPath);
    expect(events.filter((event) => event.event === 'run_retry_attempted')).toHaveLength(0);
    expect(events.filter((event) => event.event === 'end')).toHaveLength(1);
  }, 25_000);
});

async function sendRun(context: { url: string; projectId: string; conversationId: string }, message: string): Promise<string> {
  const response = await fetch(`${context.url}/api/runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: context.projectId, conversationId: context.conversationId,
      assistantMessageId: randomUUID(), clientRequestId: randomUUID(), agentId: 'claude',
      model: 'claude-opus-5-5', reasoning: 'medium', message, currentPrompt: message }),
  });
  expect(response.status).toBe(202);
  return (await response.json() as { runId: string }).runId;
}

async function waitForRun(url: string, id: string): Promise<RunStatus> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const response = await fetch(`${url}/api/runs/${id}`);
    expect(response.status).toBe(200);
    const run = await response.json() as RunStatus;
    if (['succeeded', 'failed', 'canceled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Context recovery run ${id} did not finish.`);
}

async function readEvents(file: string): Promise<RunEvent[]> {
  return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as RunEvent);
}

async function readInvocations(file: string): Promise<Invocation[]> {
  let raw: string;
  try { raw = await readFile(file, 'utf8'); } catch { return []; }
  return raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Invocation);
}

async function writeFixture(dir: string, mode: Mode): Promise<{ bin: string; log: string }> {
  const source = path.join(dir, 'claude-context-fixture.cjs');
  const log = path.join(dir, 'launches.jsonl');
  const state = path.join(dir, 'compacted');
  await writeFile(source, `
const fs=require('node:fs');
const args=process.argv.slice(2);
const emit=frame=>fs.writeSync(1,JSON.stringify(frame)+'\\n');
if(args.includes('--version')){console.log('Claude Code 2.1.296-context-test');process.exit(0);}
if(args.includes('--help')){console.log('Usage: claude -p --include-partial-messages --add-dir --effort');process.exit(0);}
if(args.includes('auth')){console.log(JSON.stringify({loggedIn:true,authMethod:'test'}));process.exit(0);}
const display=args.indexOf('--thinking-display');
if(display>=0&&args[display+1]!=='summarized'){console.error('Invalid --thinking-display');process.exit(1);}
if(!args.includes('--input-format')){console.error('Unknown option');process.exit(1);}
const value=flag=>args[args.indexOf(flag)+1];
const resume=args.includes('--resume');
const sessionId=value(resume?'--resume':'--session-id');
let buffer='';let started=false;
setTimeout(()=>process.exit(9),20000).unref();
async function start(raw){
 if(started)return;started=true;
 let prompt=raw;
 if(value('--input-format')==='stream-json'){
  const frame=JSON.parse(raw.trim().split('\\n')[0]);
  const content=frame.message?.content;
  prompt=typeof content==='string'?content:Array.isArray(content)?content.filter(b=>b.type==='text').map(b=>b.text).join(''):'';
 }
 const compact=prompt.trim()==='/compact';
 let toolGrantStatus=null;
 try {
  const response=await fetch(process.env.OD_DAEMON_URL+'/api/tools/connectors/list',{
   headers:{authorization:'Bearer '+process.env.OD_TOOL_TOKEN},signal:AbortSignal.timeout(3000)
  });
  toolGrantStatus=response.status;await response.arrayBuffer();
 } catch {}
 fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args,prompt,sessionId,compact,pid:process.pid,toolGrantStatus})+'\\n');
 emit({type:'system',subtype:'init',model:'claude-opus-5-5',session_id:sessionId});
 if(compact){
  if(${JSON.stringify(mode)}==='compact-waits'){setInterval(()=>{},1000);return;}
  if(${JSON.stringify(mode)}==='compact-fails'){
   emit({type:'result',subtype:'error_during_execution',is_error:true,errors:['PreCompact hook blocked compaction'],session_id:sessionId});
   setTimeout(()=>process.exit(1),30);return;
  }
  fs.writeFileSync(${JSON.stringify(state)},'yes');
  emit({type:'system',subtype:'compact_boundary',session_id:sessionId,compact_metadata:{trigger:'manual',pre_tokens:180000,post_tokens:1500}});
  emit({type:'result',subtype:'success',is_error:false,result:'Compacted',session_id:sessionId});
  setTimeout(()=>process.exit(0),30);return;
 }
 if(resume&&(!fs.existsSync(${JSON.stringify(state)})||${JSON.stringify(mode)}==='repeated-overflow')){
  emit({type:'result',subtype:'error_during_execution',is_error:true,result:'Prompt is too long',session_id:sessionId});
  setTimeout(()=>process.exit(1),30);return;
 }
 const text=resume?'CONTEXT_RECOVERED':${JSON.stringify(SEED_REPLY)};
 emit({type:'assistant',parent_tool_use_id:null,message:{id:'context-'+Date.now(),role:'assistant',content:[{type:'text',text}],stop_reason:'end_turn'}});
 emit({type:'result',subtype:'success',is_error:false,result:text,stop_reason:'end_turn',session_id:sessionId,usage:{input_tokens:10,output_tokens:3}});
 setTimeout(()=>process.exit(0),30);
}
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{buffer+=chunk;if(value('--input-format')==='stream-json'&&buffer.includes('\\n'))start(buffer);});
process.stdin.on('end',()=>start(buffer));
process.stdin.resume();
`, 'utf8');
  const bin = path.join(dir, process.platform === 'win32' ? 'claude-context.cmd' : 'claude-context');
  await writeFile(bin, process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "${source}" %*\r\n`
    : `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${source.replace(/'/g, "'\\''")}' "$@"\n`, 'utf8');
  if (process.platform !== 'win32') await chmod(bin, 0o755);
  return { bin, log };
}
