import type http from 'node:http';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DesktopRenderSlidesInput, DesktopRenderSlidesResult } from '@open-design/sidecar-proto';
import {
  createSystemPagedDocumentPrinter,
  preparePagedPrintHtml,
  printPagedDocumentPdf,
  type PagedDocumentPrintInput,
} from '../src/paged-document-pdf.js';
import { startServer } from '../src/server.js';

// A designed document (pages with data-melillodesign-document-page and their paper size) is printed by the PC's own
// Chrome or Edge, so `od export --format pdf` works without the desktop app and keeps each page's paper size.

const PAGED = [
  '<!doctype html><html lang="it"><head><meta charset="utf-8"><link rel="stylesheet" href="tavole.css"></head>',
  '<body><main><section data-melillodesign-document-page data-width-mm="420" data-height-mm="297">Tavola</section></main></body></html>',
].join('');
const PDF = Buffer.from('%PDF-1.7\n% stub\n');

describe('preparing a paged document for the browser print', () => {
  it('resolves relative assets against the base before any of its own, and adds the preparation script', () => {
    const html = preparePagedPrintHtml(
      '<!doctype html><html><head><base href="elsewhere/"><title>T</title></head><body><p>x</p></body></html>',
      'http://127.0.0.1:7456/api/projects/p/preview/s/documents/',
    );
    expect(html.indexOf('<base href="http://127.0.0.1:7456/api/projects/p/preview/s/documents/">')).toBeLessThan(html.indexOf('<base href="elsewhere/">'));
    expect(html).toMatch(/<script data-md-print-prepare>\(function\(\)\{[\s\S]*<\/script><\/body>/);
  });

  it('copes with a fragment that has no head', () => {
    const html = preparePagedPrintHtml('<section data-melillodesign-document-page>x</section>', 'http://127.0.0.1/a/');
    expect(html.startsWith('<base href="http://127.0.0.1/a/">')).toBe(true);
  });
});

describe('printing a paged document with the system browser', () => {
  const scratchRoot = path.join(os.tmpdir(), `od-paged-print-${process.pid}`);
  let counter = 0;
  const scratch = () => path.join(scratchRoot, String(counter++));

  it('prints the prepared page to PDF in a throwaway profile, with the stylesheets inlined', async () => {
    const scratchDir = scratch();
    let seen: { executable: string; args: string[]; page: string } | null = null;
    const pdf = await printPagedDocumentPdf({
      html: PAGED,
      baseHref: 'http://127.0.0.1:7456/api/projects/p/preview/s/documents/tavole/',
      scratchDir,
      executable: 'browser.exe',
      fetchText: async (url) => {
        expect(url).toBe('http://127.0.0.1:7456/api/projects/p/preview/s/documents/tavole/tavole.css');
        return '@media (max-width: 900px){main{display:block}} .t{background:url(img/a.png)}';
      },
      run: async (executable, args) => {
        const target = args.find((arg) => arg.startsWith('--print-to-pdf='))!.slice('--print-to-pdf='.length);
        seen = { executable, args, page: await readFile(fileURLToPath(args.at(-1)!), 'utf8') };
        await writeFile(target, PDF);
      },
    });
    expect(pdf.equals(PDF)).toBe(true);
    expect(seen!.executable).toBe('browser.exe');
    expect(seen!.args).toEqual(expect.arrayContaining([
      '--headless=new',
      '--no-pdf-header-footer',
      `--user-data-dir=${path.join(scratchDir, 'profile')}`,
      `--print-to-pdf=${path.join(scratchDir, 'document.pdf')}`,
    ]));
    // UTF-8 signature: a file page with no charset declaration would otherwise be read as Windows-1252.
    expect(seen!.page.charCodeAt(0)).toBe(0xfeff);
    expect(seen!.page).toContain('<style data-md-print-inlined>@media (max-width: 900px)');
    expect(seen!.page).toContain('url(http://127.0.0.1:7456/api/projects/p/preview/s/documents/tavole/img/a.png)');
    expect(seen!.page).not.toContain('<link rel="stylesheet"');
    expect(seen!.page).toContain('<script data-md-print-prepare>');
  });

  it('fails when the browser leaves no PDF behind', async () => {
    await expect(printPagedDocumentPdf({
      html: PAGED,
      baseHref: 'http://127.0.0.1/a/',
      scratchDir: scratch(),
      executable: 'browser.exe',
      fetchText: async () => '',
      run: async () => {},
    })).rejects.toThrow(/did not produce a PDF/);
  });

  it('reports no printer on a PC without Chrome or Edge', async () => {
    const printer = createSystemPagedDocumentPrinter({ findExecutable: () => null });
    expect(await printer({ html: PAGED, baseHref: 'http://127.0.0.1/a/', scratchDir: scratch() })).toBeNull();
  });
});

describe('PDF export of a paged document without the desktop app', () => {
  let server: http.Server;
  let baseUrl: string;
  let exportRenderRoot: string;
  const projectId = 'proj-paged-pdf';
  const printed: PagedDocumentPrintInput[] = [];
  const rendered: DesktopRenderSlidesInput[] = [];
  let printerResult: 'pdf' | 'none' | 'fail' = 'pdf';

  const printer = async (input: PagedDocumentPrintInput) => {
    printed.push(input);
    expect(existsSync(input.scratchDir) || input.scratchDir.length > 0).toBe(true);
    if (printerResult === 'fail') throw new Error('the browser exited with code 21');
    return printerResult === 'pdf' ? PDF : null;
  };
  const renderer = async (input: DesktopRenderSlidesInput): Promise<DesktopRenderSlidesResult> => {
    rendered.push(input);
    return { ok: false, error: 'desktop renderer unavailable: connect ENOENT' };
  };
  const exportPdf = (fileName: string) =>
    fetch(`${baseUrl}/api/projects/${projectId}/export/pdf-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, title: 'Fascicolo grafico B' }),
    });

  beforeAll(async () => {
    const started = (await startServer({
      port: 0,
      returnServer: true,
      desktopSlideRenderer: renderer,
      pagedDocumentPrinter: printer,
    })) as { url: string; server: http.Server };
    baseUrl = started.url;
    server = started.server;
    const dataDir = process.env.OD_DATA_DIR!;
    exportRenderRoot = path.join(realpathSync(dataDir), 'export-render');
    const dir = path.join(dataDir, 'projects', projectId, 'documents', 'tavole');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'tavole.html'), PAGED);
    await writeFile(path.join(dir, 'pagina.html'), '<html><body><main>Pagina</main></body></html>');
  }, 60_000);

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('prints it with the system browser and returns a PDF named after the title', async () => {
    printerResult = 'pdf';
    const before = rendered.length;
    const res = await exportPdf('documents/tavole/tavole.html');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('Fascicolo-grafico-B.pdf');
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
    const input = printed.at(-1)!;
    expect(input.html).toBe(PAGED);
    expect(input.baseHref).toMatch(new RegExp(`/api/projects/${projectId}/preview/[^/]+/documents/tavole/$`));
    expect(input.scratchDir.startsWith(exportRenderRoot + path.sep)).toBe(true);
    expect(existsSync(input.scratchDir)).toBe(false);
    expect(rendered.length).toBe(before);
  });

  it('leaves an ordinary page to the screenshot renderer', async () => {
    const before = printed.length;
    const res = await exportPdf('documents/tavole/pagina.html');
    expect(res.status).toBe(502);
    expect(printed.length).toBe(before);
    expect(rendered.at(-1)?.html).toContain('Pagina');
  });

  it('falls back to the screenshot renderer when the PC has no browser to print with', async () => {
    printerResult = 'none';
    const before = rendered.length;
    const res = await exportPdf('documents/tavole/tavole.html');
    expect(res.status).toBe(502);
    expect(rendered.length).toBe(before + 1);
  });

  it('says the browser could not print when printing fails', async () => {
    printerResult = 'fail';
    const res = await exportPdf('documents/tavole/tavole.html');
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('the browser exited with code 21');
  });
});
