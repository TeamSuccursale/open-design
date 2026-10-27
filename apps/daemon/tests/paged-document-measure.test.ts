import { execFile } from 'node:child_process';
import type http from 'node:http';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBlockoutDocument, createDocumentPresentation, type DocumentLayoutMeasurement, type DocumentRuleCheck } from '@open-design/contracts';
import {
  createSystemPagedDocumentMeasurer,
  measurePagedDocumentLayout,
  type PagedDocumentPrintInput,
} from '../src/paged-document-pdf.js';
import { saveBlockoutWorkspace } from '../src/services/blockout-workspaces.js';
import { startServer } from '../src/server.js';

// Before export, the document is measured in the same browser that prints it, and the measurement is compared with
// the rules the setup saved for that document. The check only reports: export never waits for it.

const PAGED = [
  '<!doctype html><html lang="it"><head><meta charset="utf-8"><link rel="stylesheet" href="tavole.css"></head>',
  '<body><main><section data-melillodesign-document-page="tavole" data-blockout-page-id="page-1" data-width-mm="420" data-height-mm="297">Tavola</section></main></body></html>',
].join('');
const MEASURED: DocumentLayoutMeasurement = { documentId: 'tavole', unreadStylesheets: 0, pages: [{ index: 1, widthMm: 420, heightMm: 297, blockoutPageId: 'page-1',
  fonts: [{ pt: 11, family: 'Arial', chars: 120, text: 'Tavola', recurring: false }],
  margins: { right: { mm: 13.4, kind: 'box', blockId: 'detail-2', text: 'Fotografia 2' }, left: { mm: 24, kind: 'text', text: 'Tavola' } } }] };
const execFileP = promisify(execFile);
const daemonRoot = fileURLToPath(new URL('..', import.meta.url));
const cliEntry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const tsxCli = path.join(fileURLToPath(new URL('../../..', import.meta.url)), 'node_modules/tsx/dist/cli.mjs');
const dump = (value: unknown) => `<html><head><meta name="md-layout-measure" content="${encodeURIComponent(JSON.stringify(value))}"></head><body></body></html>`;

describe('measuring a paged document with the system browser', () => {
  const scratchRoot = path.join(os.tmpdir(), `od-paged-measure-${process.pid}`);
  let counter = 0;
  const scratch = () => path.join(scratchRoot, String(counter++));

  it('dumps the prepared page with the measuring script after the preparation, and reads its report', async () => {
    let seen: { args: string[]; page: string; timeoutMs: number } | null = null;
    const measured = await measurePagedDocumentLayout({
      html: PAGED, baseHref: 'http://127.0.0.1:7456/api/projects/p/preview/s/documents/tavole/', scratchDir: scratch(), executable: 'browser.exe',
      fetchText: async () => '.t{color:red}',
      dump: async (_executable, args, timeoutMs) => { seen = { args, timeoutMs, page: await readFile(fileURLToPath(args.at(-1)!), 'utf8') }; return dump(MEASURED); },
    });
    expect(measured).toEqual(MEASURED);
    expect(seen!.args).toContain('--dump-dom');
    // The check only advises: a page stuck on slow assets gives up after a minute, not the print's two.
    expect(seen!.timeoutMs).toBe(60_000);
    expect(seen!.args.some((arg) => arg.startsWith('--print-to-pdf'))).toBe(false);
    expect(seen!.page).toContain('<style data-md-print-inlined>.t{color:red}');
    expect(seen!.page.indexOf('<script data-md-print-prepare>')).toBeLessThan(seen!.page.indexOf('<script data-md-layout-measure>'));
  });

  it('says what went wrong when the page could not be measured', async () => {
    const input = { html: PAGED, baseHref: 'http://127.0.0.1/a/', executable: 'browser.exe', fetchText: async () => '' };
    await expect(measurePagedDocumentLayout({ ...input, scratchDir: scratch(), dump: async () => dump({ error: 'page is not defined' }) })).rejects.toThrow(/page is not defined/);
    await expect(measurePagedDocumentLayout({ ...input, scratchDir: scratch(), dump: async () => '<html></html>' })).rejects.toThrow(/did not report/);
  });

  it('reports no measurer on a PC without Chrome or Edge', async () => {
    const measurer = createSystemPagedDocumentMeasurer({ findExecutable: () => null });
    expect(await measurer({ html: PAGED, baseHref: 'http://127.0.0.1/a/', scratchDir: scratch() })).toBeNull();
  });
});

describe('the rule check before export', () => {
  let server: http.Server;
  let baseUrl: string;
  const projectId = 'proj-rule-check';
  const measured: PagedDocumentPrintInput[] = [];
  let result: 'measure' | 'none' | 'fail' = 'measure';
  const measurer = async (input: PagedDocumentPrintInput) => {
    measured.push(input);
    if (result === 'fail') throw new Error('the browser exited with code 21');
    return result === 'measure' ? MEASURED : null;
  };
  const check = (fileName: string) => fetch(`${baseUrl}/api/projects/${projectId}/export/check`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName }),
  });

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true, pagedDocumentMeasurer: measurer })) as { url: string; server: http.Server };
    baseUrl = started.url;
    server = started.server;
    const root = path.join(process.env.OD_DATA_DIR!, 'projects', projectId);
    await mkdir(path.join(root, 'documents', 'tavole'), { recursive: true });
    await writeFile(path.join(root, 'documents', 'tavole', 'tavole.html'), PAGED);
    await writeFile(path.join(root, 'documents', 'tavole', 'pagina.html'), '<html><body><main>Pagina</main></body></html>');
    const presentation = createDocumentPresentation('Tavole');
    const setup = {
      version: 1, projectId, status: 'confirmed', workingDirectory: realpathSync(root), updatedAt: '2026-10-27T08:00:00Z',
      intent: { kind: 'other', subtype: 'Tavole di gara', editorialSettings: [{ documentId: 'tavole', presentation, constraints: [
        { id: 'limit', kind: 'page-limit', value: 'Tavole: massimo 4 pagine A3. Disciplinare p. 37, tabella 9.', status: 'confirmed', sourceIds: ['source-37'] },
        { id: 'paper', kind: 'paper', value: 'Tavole: formato A3.', status: 'confirmed', sourceIds: ['source-37'] },
      ] }] },
      scan: { status: 'complete', warnings: [], constraints: [], sources: [
        { id: 'source-37', path: 'Disciplinare - estratto.pdf', root: realpathSync(root), page: 1, title: 'Disciplinare - estratto.pdf', excerpt: 'Tabella 9', readable: true, role: 'rules' },
      ] },
    };
    await mkdir(path.join(root, '.melillodesign', 'projects', projectId), { recursive: true });
    await writeFile(path.join(root, '.melillodesign', 'projects', projectId, 'document-setup.json'), JSON.stringify(setup));
    const document = createBlockoutDocument(); document.documentId = 'tavole';
    const plate = document.variants[0]!.pages[0]!;
    Object.assign(plate, { id: 'page-1', widthMm: 420, heightMm: 297, safeMarginMm: 24, blocks: [{ id: 'detail-2', label: 'Dettaglio inferiore', kind: 'image',
      box: { x: 72, y: 58, width: 22, height: 18, rotation: 0 }, images: [], references: [], lockRatio: false, expectation: '', feedback: '', flexibility: 'guided' }] });
    await saveBlockoutWorkspace(root, 'tavole', { document, baseRaw: null });
  }, 60_000);

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('measures the document in the browser and cites each rule with its file and page', async () => {
    result = 'measure';
    const res = await check('documents/tavole/tavole.html');
    expect(res.status).toBe(200);
    const { check: report } = await res.json() as { check: DocumentRuleCheck };
    expect(measured.at(-1)!.baseHref).toMatch(new RegExp(`/api/projects/${projectId}/preview/[^/]+/documents/tavole/$`));
    const rows = Object.fromEntries(report.rows.map((row) => [row.kind, row]));
    expect(rows.pages).toMatchObject({ status: 'ok', expected: { maxPages: 4 }, rule: { sources: [{ path: 'Disciplinare - estratto.pdf', page: 1 }] } });
    expect(rows.paper).toMatchObject({ status: 'ok', expected: { name: 'A3' } });
    expect(rows.margins).toMatchObject({ status: 'warning', rule: { origin: 'blockout' }, findings: [{ page: 1, side: 'right', mm: 13.4, expectedMm: 24, label: 'Dettaglio inferiore' }] });
    expect(report.status).toBe('warning');
  });

  it('has nothing to check on a page without paper sizes', async () => {
    const before = measured.length;
    const res = await check('documents/tavole/pagina.html');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ check: null });
    expect(measured.length).toBe(before);
  });

  it('is the same check from the od CLI, as rows with their rules, or as JSON; warnings exit 0', async () => {
    result = 'measure';
    const od = (...extra: string[]) => execFileP(process.execPath, [tsxCli, cliEntry, 'export', 'check', 'documents/tavole/tavole.html',
      '--project', projectId, '--daemon-url', baseUrl, ...extra], { cwd: daemonRoot, env: { ...process.env, OD_TOOL_TOKEN: '' } });
    const text = await od();
    expect(text.stdout).toMatch(/1 page.*1 warning.*export is not blocked/);
    expect(text.stdout).toMatch(/ok\s+Pages\s+1 of 4/);
    expect(text.stdout).toContain('Rule: "Tavole: massimo 4 pagine A3. Disciplinare p. 37, tabella 9."');
    expect(text.stdout).toContain('Source: Disciplinare - estratto.pdf, p. 1');
    expect(text.stdout).toMatch(/warning\s+Margins\s+page 1 right 13\.4 mm, expected at least 24 mm \(Dettaglio inferiore\)/);
    expect(text.stdout).toContain('Rule: the Blockout safe margin');
    expect(text.stdout).toMatch(/unchecked\s+Orientation\s+no rule/);
    const json = await od('--json');
    expect(JSON.parse(json.stdout)).toMatchObject({ check: { status: 'warning', fileName: 'documents/tavole/tavole.html' } });
  }, 60_000);

  it('says why it could not measure, without touching the export', async () => {
    result = 'none';
    const missing = await check('documents/tavole/tavole.html');
    expect(missing.status).toBe(503);
    expect(await missing.text()).toContain('Chrome or Edge');
    result = 'fail';
    const failed = await check('documents/tavole/tavole.html');
    expect(failed.status).toBe(502);
    expect(await failed.text()).toContain('the browser exited with code 21');
  });
});
