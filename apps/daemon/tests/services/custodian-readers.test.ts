import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { claudeCustodianRunner, codexCustodianArgs, custodianPrompt, custodianReaders, CLAUDE_CUSTODIAN_OUTPUT_SCHEMA, CLAUDE_CUSTODIAN_READER,
  CODEX_CUSTODIAN_READER } from '../../src/services/custodian-readers.js';
import type { CustodianWorkerRequest } from '../../src/services/project-custodians.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function dataDirWith(config?: unknown) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'custodian-readers-')); roots.push(dataDir);
  if (config) await writeFile(path.join(dataDir, 'app-config.json'), JSON.stringify(config));
  return dataDir;
}
const savedKey = (value: string) => ({ agentCliEnv: { claude: { ANTHROPIC_API_KEY: value } }, agentCliEnvIntent: { claude: { apiKeyOverride: true } } });
const request = (images: string[] = []): CustodianWorkerRequest => ({ domain: images.length ? 'images' : 'text', question: 'Quante pagine A3?',
  ledger: { version: 1, snapshotRevision: 'rev', textStatus: 'complete', imagesStatus: 'indexed', imageConsent: true, gaps: [], sources: [] },
  evidence: [{ sourceId: 's1', title: 'Disciplinare', pages: [37], text: 'B: 4 pagine A3' }], images, imageAssetIds: images.map((_, index) => `asset-${index}`), runDir: '' });
const message = (text: string, stop_reason = 'end_turn') => ({ stop_reason, stop_details: null, content: [{ type: 'text', text }] });

describe('custodian readers', () => {
  it('reads documents through the Claude API first when a key is saved for Claude Code, keeping Codex as the fallback', async () => {
    const readers = await custodianReaders(await dataDirWith(savedKey('sk-ant-saved')), {});
    expect(readers.map((reader) => reader.name)).toEqual(['claude-api', 'codex']);
    expect(readers[0]).toMatchObject({ model: 'claude-opus-5-5', effort: CLAUDE_CUSTODIAN_READER.effort });
  });
  it('uses the daemon environment key when Settings holds none, and Codex alone without any key', async () => {
    expect((await custodianReaders(await dataDirWith(), { ANTHROPIC_API_KEY: 'sk-ant-env' })).map((reader) => reader.name)).toEqual(['claude-api', 'codex']);
    expect((await custodianReaders(await dataDirWith(), {})).map((reader) => reader.name)).toEqual(['codex']);
    expect((await custodianReaders(await dataDirWith({ agentCliEnv: { claude: { ANTHROPIC_API_KEY: ' ' } } }), {})).map((reader) => reader.name)).toEqual(['codex']);
  });
  it('asks Codex for document retrieval below the extra-high effort that made each question take one to three minutes', () => {
    expect(CODEX_CUSTODIAN_READER.effort).not.toBe('xhigh');
    const args = codexCustodianArgs('schema.json', 'answer.json', ['a.png']);
    expect(args).toContain(`model_reasoning_effort="${CODEX_CUSTODIAN_READER.effort}"`);
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', CODEX_CUSTODIAN_READER.model]);
    expect(args.slice(-3)).toEqual(['--image', 'a.png', '-']);
  });
  it('sends the same frozen-evidence prompt to Claude with structured output, refusal fallbacks and the images first', async () => {
    const dir = await dataDirWith(); const image = path.join(dir, 'crop.png'); await writeFile(image, 'png-bytes');
    const create = vi.fn(async () => message(JSON.stringify({ answer: 'Quattro.', citations: [{ sourceId: 's1', title: 'Disciplinare', page: 37, assetId: null }], assetIds: [], gaps: [] })));
    const value = await claudeCustodianRunner({ beta: { messages: { create } } })(request([image]));
    expect(value).toEqual({ answer: 'Quattro.', citations: [{ sourceId: 's1', title: 'Disciplinare', page: 37 }], assetIds: [], gaps: [] });
    const body = (create.mock.calls[0] as unknown[])[0] as Record<string, any>;
    expect(body).toMatchObject({ model: 'claude-opus-5-5', betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: CLAUDE_CUSTODIAN_READER.effort, format: { type: 'json_schema', schema: CLAUDE_CUSTODIAN_OUTPUT_SCHEMA } } });
    // Structured outputs list anyOf, not type lists, among the supported schema features.
    expect(JSON.stringify(body.output_config.format.schema)).not.toMatch(/"type":\[/);
    expect(body.messages[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from('png-bytes').toString('base64') } },
      { type: 'text', text: custodianPrompt(request([image])) },
    ]);
  });
  it('fails a Claude answer that was refused or cut off instead of reading a partial one', async () => {
    await expect(claudeCustodianRunner({ beta: { messages: { create: async () => message('', 'refusal') } } })(request())).rejects.toThrow(/refus/i);
    await expect(claudeCustodianRunner({ beta: { messages: { create: async () => message('{"answer":"Qua', 'max_tokens') } } })(request())).rejects.toThrow(/max_tokens/);
  });
});
