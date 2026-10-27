// @vitest-environment jsdom

import { DOCUMENT_PRINT_PREPARE_SCRIPT, isPagedDocumentHtml, pagedDocumentTitle } from '@open-design/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportAsPdf, exportPdfThroughDaemon, inlineLinkedStylesheets, printPagedDocument } from '../../src/runtime/exports';

// A designed document puts its pages inside screen chrome: a sticky toolbar and a grid workspace. Printing it
// whole gave one tall page with the toolbar on top; each page has to land on its own sheet at its own size.
const page = (id: string, width: number, height: number) =>
  `<section class="sheet" id="${id}" data-melillodesign-document-page="document-1" data-width-mm="${width}" data-height-mm="${height}">${id}</section>`;

function prepare(body: string) {
  document.documentElement.removeAttribute('data-md-print-ready');
  document.head.innerHTML = '';
  document.body.innerHTML = body;
  new Function(DOCUMENT_PRINT_PREPARE_SCRIPT)();
  return document.head.querySelector('style[data-md-print]')?.textContent ?? '';
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('isPagedDocumentHtml', () => {
  it('recognizes pages that declare their paper size', () => {
    expect(isPagedDocumentHtml(`<main>${page('p1', 297, 420)}</main>`)).toBe(true);
  });

  it('names the PDF after the document, not after its path in the project', () => {
    expect(pagedDocumentTitle('<html><head><title>\n  Fascicolo grafico B &middot; Passerelle &amp; rampe </title></head></html>')).toBe('Fascicolo grafico B · Passerelle & rampe');
    expect(pagedDocumentTitle('<html><head><title> </title></head></html>')).toBeUndefined();
    expect(pagedDocumentTitle('<svg><title>icon</title></svg>')).toBe('icon');
  });

  it('leaves other documents to the generic export', () => {
    expect(isPagedDocumentHtml('<main><section class="slide">One</section></main>')).toBe(false);
    expect(isPagedDocumentHtml('<section data-melillodesign-document-page="document-1">no size</section>')).toBe(false);
  });
});

describe('the document print preparation', () => {
  it('prints one sheet per page at the declared size, without the screen chrome', () => {
    const css = prepare(`<header class="toolbar">Strumenti</header><main class="workspace"><aside>Indice</aside><div class="pages">${page('p1', 420, 297)}${page('p2', 420, 297)}</div></main><footer>Note a schermo</footer><script>1</script>`);
    expect(css).toContain('@page{size:420mm 297mm;margin:0}');
    expect(css).not.toContain('@page md-');
    expect(document.querySelector('.toolbar')!.hasAttribute('data-md-print-hide')).toBe(true);
    expect(document.querySelector('aside')!.hasAttribute('data-md-print-hide')).toBe(true);
    expect(document.querySelector('body > footer')!.hasAttribute('data-md-print-hide')).toBe(true);
    expect(document.querySelector('script')!.hasAttribute('data-md-print-hide')).toBe(false);
    expect(document.querySelector('main')!.hasAttribute('data-md-print-path')).toBe(true);
    expect(document.querySelector('.pages')!.hasAttribute('data-md-print-path')).toBe(true);
    expect(document.getElementById('p1')!.getAttribute('data-md-print-size')).toBe('420x297');
    expect(document.getElementById('p2')!.hasAttribute('data-md-print-last')).toBe(true);
    expect(document.getElementById('p1')!.hasAttribute('data-md-print-last')).toBe(false);
    expect(css).toContain('[data-md-print-size="420x297"]{width:420mm!important;height:297mm!important');
  });

  it('gives each paper size its own named page when the sizes differ', () => {
    const css = prepare(`<main>${page('a4', 210, 297)}${page('a3', 420, 297)}${page('odd', 210.5, 297)}</main>`);
    expect(css).toContain('@page md-210x297{size:210mm 297mm;margin:0}[data-md-print-size="210x297"]{page:md-210x297}');
    expect(css).toContain('@page md-420x297{size:420mm 297mm;margin:0}');
    expect(document.getElementById('odd')!.getAttribute('data-md-print-size')).toBe('210_5x297');
    expect(css).toContain('@page md-210_5x297{size:210.5mm 297mm;margin:0}');
  });

  it('settles size media queries at the paper size, since print would read them at about 800px', () => {
    const css = [
      '(max-width: 900px)', '(min-width: 901px)', 'print and (max-width: 900px)', 'screen and (min-width: 901px)', 'print',
      '(prefers-reduced-motion: reduce)', '(width <= 900px)', '(400px <= width <= 2000px)', '(orientation: landscape)',
      '(min-width: 60em)', '(max-width: 300mm)', '(min-width: 10vw)', '(max-width: 900px), print', 'not all and (max-width: 900px)',
    ].map((media, index) => `@media ${media}{.r${index}{color:red}}`).join('');
    prepare(`<style>${css}</style><main>${page('p1', 420, 297)}${page('p2', 420, 297)}${page('p3', 210, 297)}</main>`);
    const media = [...(document.querySelector('style:not([data-md-print])') as HTMLStyleElement).sheet!.cssRules]
      .map((rule) => (rule as CSSMediaRule).media.mediaText);
    expect(media).toEqual([
      'not all', 'all', 'not all', 'not all', 'print',
      '(prefers-reduced-motion: reduce)', 'not all', 'all', 'all',
      'all', 'not all', '(min-width: 10vw)', 'not all, print', 'not all and (max-width: 900px)',
    ]);
    expect(document.documentElement.hasAttribute('data-md-print-ready')).toBe(true);
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('prepares once, and leaves a document without sized pages alone', () => {
    prepare(`<main>${page('p1', 210, 297)}</main>`);
    new Function(DOCUMENT_PRINT_PREPARE_SCRIPT)();
    expect(document.head.querySelectorAll('style[data-md-print]')).toHaveLength(1);

    const css = prepare('<main><section data-melillodesign-document-page="document-1" data-width-mm="0" data-height-mm="297">x</section></main>');
    expect(css).toBe('');
    expect(document.documentElement.hasAttribute('data-md-print-ready')).toBe(false);
  });
});

describe('printing a paged document from the browser', () => {
  const base = () => `${window.location.origin}/api/projects/p1/raw/documents/fascicolo/`;
  const doc = `<!doctype html><html><head><title>Fascicolo grafico B</title><link rel="stylesheet" href="fascicolo.css"><link rel="stylesheet" href="https://fonts.example.com/f.css"></head><body><main>${page('p1', 420, 297)}</main></body></html>`;

  function frameMessage(frame: HTMLIFrameElement, phase: string) {
    const nonce = JSON.parse(/var nonce=("[^"]+")/.exec(frame.srcdoc)![1]!) as string;
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { type: 'od:paged-print', nonce, phase } }));
  }

  it('copies same-origin stylesheets in, with their urls resolved where the stylesheet lives', async () => {
    const fetched: string[] = [];
    const html = await inlineLinkedStylesheets(doc, base(), async (url) => {
      fetched.push(url);
      return '.sheet{background:url("img/grain.png")}.logo{background:url(data:image/png;base64,AA)}</style>';
    });
    expect(fetched).toEqual([`${base()}fascicolo.css`]);
    expect(html).toContain(`<style data-md-print-inlined>.sheet{background:url("${base()}img/grain.png")}.logo{background:url(data:image/png;base64,AA)}` + String.raw`<\/style></style>`);
    expect(html).toContain('<link rel="stylesheet" href="https://fonts.example.com/f.css">');
    expect(html).not.toContain('href="fascicolo.css"');
  });

  it('prints from a hidden sandboxed frame and leaves the captured PDF alone', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('.sheet{color:#303840}'));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      const exporting = exportAsPdf(doc, 'documents/fascicolo/fascicolo', { baseHref: base() });
      await vi.waitFor(() => expect(document.querySelector('iframe[sandbox]')).not.toBeNull());
      const frame = document.querySelector<HTMLIFrameElement>('iframe[sandbox]')!;
      expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-modals');
      expect(frame.srcdoc).toMatch(/<style data-md-print-inlined(="")?>\.sheet\{color:#303840\}<\/style>/);
      expect(frame.srcdoc).toContain('data-md-print-ready');
      // The print dialog proposes the document's title as the file name.
      expect(frame.srcdoc).toContain('title="Fascicolo grafico B"');
      frameMessage(frame, 'loading');
      frameMessage(frame, 'printing');
      frameMessage(frame, 'printed');
      await expect(exporting).resolves.toBeUndefined();
      expect(open).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      open.mockRestore();
    }
  });

  it('resolves the relative base href the viewer passes', async () => {
    const fetched: string[] = [];
    await inlineLinkedStylesheets(doc, '/api/projects/p1/raw/documents/fascicolo/', async (url) => { fetched.push(url); return ''; });
    expect(fetched).toEqual([`${base()}fascicolo.css`]);
  });

  it('gives up when the frame never starts, and when it never finishes loading', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(''));
    try {
      await expect(printPagedDocument(doc, 'Fascicolo', { baseHref: base(), startTimeoutMs: 20 })).rejects.toThrow('did not start');
      expect(document.querySelector('iframe[sandbox]')).toBeNull();

      const loading = printPagedDocument(doc, 'Fascicolo', { baseHref: base(), startTimeoutMs: 1_000, loadTimeoutMs: 80 });
      await vi.waitFor(() => expect(document.querySelector('iframe[sandbox]')).not.toBeNull());
      frameMessage(document.querySelector<HTMLIFrameElement>('iframe[sandbox]')!, 'loading');
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(document.querySelector('iframe[sandbox]')).not.toBeNull();
      await expect(loading).rejects.toThrow('did not finish loading');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

// Without the desktop app the daemon still prints a designed document with the PC's own browser, so the export
// arrives as a file instead of a print dialog. Anything else keeps the old rule: the daemon only with a host.
describe('exportPdfThroughDaemon', () => {
  const paged = `<main>${page('p1', 420, 297)}</main>`;

  it('asks the daemon for a designed document even without a host, named after the document', async () => {
    const request = vi.fn(async (_title?: string) => ({ ok: true as const, completion: 'download' as const }));
    expect(await exportPdfThroughDaemon(`<title>Fascicolo grafico B</title>${paged}`, false, request)).toEqual({ done: true, completion: 'download' });
    expect(request).toHaveBeenCalledWith('Fascicolo grafico B');
  });

  it('leaves a designed document to the browser print when the daemon cannot print it', async () => {
    const failed = vi.fn(async () => ({ ok: false as const, error: 'the system browser could not print the document' }));
    expect(await exportPdfThroughDaemon(paged, true, failed)).toEqual({ done: false });
    const missing = vi.fn(async () => ({ ok: false as const, unavailable: true as const, reason: 'no-renderer' as const }));
    expect(await exportPdfThroughDaemon(paged, false, missing)).toEqual({ done: false });
  });

  it('does not ask the daemon for another page without a host', async () => {
    const request = vi.fn();
    expect(await exportPdfThroughDaemon('<main>Pagina</main>', false, request)).toEqual({ done: false });
    expect(request).not.toHaveBeenCalled();
  });

  it('surfaces a screenshot renderer failure for another page instead of downgrading it', async () => {
    const request = vi.fn(async () => ({ ok: false as const, error: 'renderer returned no slides' }));
    await expect(exportPdfThroughDaemon('<main>Pagina</main>', true, request)).rejects.toThrow('renderer returned no slides');
  });
});
