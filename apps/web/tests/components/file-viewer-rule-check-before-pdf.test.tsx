// @vitest-environment jsdom

// A designed document is checked against its rules before it goes to PDF. The check opens first, and its export
// button runs the same export the menu would have run; an ordinary page exports straight away.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProjectFile } from '../../src/types';

const { exportProjectScreenshotPdfMock, exportProjectAsPdfMock, checkDocumentRulesMock } = vi.hoisted(() => ({
  exportProjectScreenshotPdfMock: vi.fn(async () => ({ ok: true as const })),
  exportProjectAsPdfMock: vi.fn(async () => undefined),
  checkDocumentRulesMock: vi.fn(() => new Promise(() => {})),
}));

vi.mock('../../src/runtime/exports', async () => {
  const actual = await vi.importActual<typeof import('../../src/runtime/exports')>('../../src/runtime/exports');
  return { ...actual, exportProjectScreenshotPdf: exportProjectScreenshotPdfMock, exportProjectAsPdf: exportProjectAsPdfMock, isOpenDesignHostAvailable: () => false };
});
vi.mock('../../src/runtime/document-rule-check', () => ({ checkDocumentRules: checkDocumentRulesMock }));

import { FileViewer } from '../../src/components/FileViewer';
import { I18nProvider } from '../../src/i18n';
import { en } from '../../src/i18n/locales/en';

const PAGED = '<!doctype html><html><body><section data-melillodesign-document-page="tavole" data-width-mm="420" data-height-mm="297">Tavola</section></body></html>';
const PAGE = '<html><body><h1>Pagina</h1></body></html>';
const file: ProjectFile = {
  name: 'documents/tavole/tavole.html', path: 'documents/tavole/tavole.html', type: 'file', size: 1024, mtime: 1710000000, kind: 'html', mime: 'text/html',
  artifactManifest: { version: 1, kind: 'html', title: 'Tavole', entry: 'documents/tavole/tavole.html', renderer: 'html', exports: ['html'] },
};

async function exportCurrentAsPdf(liveHtml: string) {
  const version = { id: 'v1', fileName: file.name, version: 1, label: 'Current', createdAt: 1_725_000_000_000, source: 'manual', prompt: 'Current', size: 42, mime: 'text/html', kind: 'html', current: true };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (url.endsWith('/versions')) return new Response(JSON.stringify({ file, versions: [version] }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 404 });
  }));
  render(<I18nProvider initial="en"><FileViewer projectId="project-1" projectKind="prototype" file={file} liveHtml={liveHtml} /></I18nProvider>);
  fireEvent.click(screen.getByRole('button', { name: en['fileViewer.versions.entry'] }));
  const versions = await screen.findByRole('dialog', { name: en['fileViewer.versions.title'] });
  const download = `${en['fileViewer.download']} ${en['fileViewer.versions.versionLabel'].replace('{version}', '1')}`;
  fireEvent.click(await within(versions).findByRole('button', { name: download }));
  fireEvent.click(within(versions).getByRole('menuitem', { name: en['fileViewer.exportPdf'] }));
}

describe('the PDF export of a designed document', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

  it('opens the rule check first, whose button runs the export', async () => {
    await exportCurrentAsPdf(PAGED);
    const check = await screen.findByRole('dialog', { name: en['ruleCheck.title'] });
    expect(checkDocumentRulesMock).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', fileName: file.name }));
    expect(exportProjectScreenshotPdfMock).not.toHaveBeenCalled();
    fireEvent.click(within(check).getByRole('button', { name: en['ruleCheck.export'] }));
    await waitFor(() => expect(exportProjectScreenshotPdfMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: en['ruleCheck.title'] })).toBeNull();
  });

  it('exports an ordinary page without a check', async () => {
    await exportCurrentAsPdf(PAGE);
    await waitFor(() => expect(exportProjectAsPdfMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: en['ruleCheck.title'] })).toBeNull();
    expect(checkDocumentRulesMock).not.toHaveBeenCalled();
  });
});
