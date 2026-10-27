import { describe, expect, it } from 'vitest';
import { AppliedHeaderFooterSchema, fillHeaderFooterText, headerFooterDateText, headerFooterReservations, renderAppliedHeaderFooterSvg } from '../src/api/header-footer-presentation.js';
import { blockoutOutsideSafeArea, blockoutSafeArea } from '../src/api/blockout-geometry.js';
import { createBlockoutPage } from '../src/api/blockout.js';

const applied = AppliedHeaderFooterSchema.parse({ version: 1, projectId: 'project', documentId: 'report', setId: 'shared', revision: 2,
  projectName: 'Studio <demo>', header: true, footer: true, showOnCover: false, appliedAt: '2026-10-24T08:00:00Z',
  assets: [{ id: 'logo', path: 'documents/report/header-footer/report/assets/logo.svg', mimeType: 'image/svg+xml' }],
  design: { version: 1, name: 'Editorial', guidance: '', stage: 'graphic', variants: [{ id: 'a4', name: 'A4', pageWidthMm: 210, pageHeightMm: 297, headerHeightMm: 25, footerHeightMm: 15,
    blocks: [{ id: 'logo', region: 'header', kind: 'logo', assetId: 'logo', x: .05, y: .2, width: .2, height: .6 },
      { id: 'name', region: 'header', kind: 'field', field: 'documentName', x: .4, y: .3, width: .5, height: .5 },
      { id: 'number', region: 'footer', kind: 'field', field: 'pageNumber', x: .8, y: .3, width: .1, height: .4 }] }] },
});
describe('applied recurring graphics', () => {
  it('uses document-local values and portable logo references without changing proportions', () => {
    const svg = renderAppliedHeaderFooterSvg(applied, { widthMm: 210, heightMm: 297, documentName: 'Relazione <B>', index: 7, totalPages: 8, visibleNumber: 7, assetUrl: (file) => `../${file}` });
    expect(svg).toContain('Relazione &lt;B&gt;'); expect(svg).not.toContain('Relazione <B>');
    expect(svg).toContain('>7</tspan>'); expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(svg).toContain('../documents/report/header-footer/report/assets/logo.svg');
  });
  it('excludes an unadorned cover and reserves no body space there', () => {
    expect(renderAppliedHeaderFooterSvg(applied, { widthMm: 210, heightMm: 297, documentName: 'Report', index: 0, totalPages: 8, isCover: true, visibleNumber: null })).toBe('');
    expect(headerFooterReservations(applied, { widthMm: 210, heightMm: 297, isCover: true })).toEqual({ headerMm: 0, footerMm: 0 });
  });
  it('shows an unknown preview total without inventing a one-page document and renders real totals unchanged', () => {
    const design = structuredClone(applied); design.design.variants[0]!.blocks.push({ id: 'total', region: 'footer', kind: 'field', field: 'totalPages', x: .9, y: .3, width: .05, height: .4 });
    const page = { widthMm: 210, heightMm: 297, documentName: 'Report', index: 0, totalPages: null, visibleNumber: 1 };
    expect(renderAppliedHeaderFooterSvg(design, page)).toContain('>—</tspan>');
    expect(renderAppliedHeaderFooterSvg(design, { ...page, totalPages: 2 })).toContain('>2</tspan>');
  });
  it('prints the revision date as day/month/year, the form the engineer reviews in the editor', () => {
    const design = structuredClone(applied); design.appliedAt = '2026-10-24T12:00:00.000Z';
    design.design.variants[0]!.blocks.push({ id: 'date', region: 'footer', kind: 'field', field: 'date', x: .4, y: .3, width: .2, height: .4 });
    const svg = renderAppliedHeaderFooterSvg(design, { widthMm: 210, heightMm: 297, documentName: 'Report', index: 0, totalPages: 8, visibleNumber: 1 });
    expect(svg).toContain('>24/10/2026</tspan>'); expect(svg).not.toContain('2026-10-24');
    expect(headerFooterDateText('2026-10-24T12:00:00.000Z')).toBe('24/10/2026');
  });
  // Run 3 of 27 October printed «pagina 3 / 8» as four boxes, each aligned inside its own width, so the
  // gaps between number and words depended on the box widths. One text block now carries the fields.
  it('fills field placeholders inside a text block, so a numbering phrase prints as one line', () => {
    const design = structuredClone(applied);
    design.design.variants[0]!.blocks.push({ id: 'numbering', region: 'footer', kind: 'text', text: 'Pagina {pageNumber} di {totalPages} · {documentName} {sconosciuto}', x: .5, y: .3, width: .45, height: .4, align: 'right' });
    const svg = renderAppliedHeaderFooterSvg(design, { widthMm: 210, heightMm: 297, documentName: 'Relazione <B>', index: 2, totalPages: 8, visibleNumber: 3 });
    expect(svg).toContain('>Pagina 3 di 8 · Relazione &lt;B&gt; {sconosciuto}</tspan>');
    expect(fillHeaderFooterText('{projectName} — rev. {revision}, {date}', { projectName: 'Antro', revision: '2', date: '24/10/2026' })).toBe('Antro — rev. 2, 24/10/2026');
  });
  it('never stretches an A4 design into an unsupported A3 format', () => {
    expect(renderAppliedHeaderFooterSvg(applied, { widthMm: 420, heightMm: 297, documentName: 'Booklet', index: 0, totalPages: 4 })).toBe('');
  });
  it('reserves real header/footer heights for safe area warnings and snap targets', () => {
    const page = { ...createBlockoutPage('one', 'Body'), reservedHeaderMm: 25, reservedFooterMm: 15 };
    const safe = blockoutSafeArea(page); expect(safe.top).toBeCloseTo(35 / 297 * 100); expect(safe.bottom).toBeCloseTo(100 - 25 / 297 * 100);
    expect(blockoutOutsideSafeArea({ x: 10, y: 5, width: 30, height: 10, rotation: 0 }, page)).toBe(true);
    expect(blockoutOutsideSafeArea({ x: 10, y: 15, width: 30, height: 10, rotation: 0 }, page)).toBe(false);
  });
  it('refuses an asset path escaping the registered document workspace', () => {
    expect(AppliedHeaderFooterSchema.safeParse({ ...applied, assets: [{ id: 'logo', path: '../private.svg', mimeType: 'image/svg+xml' }] }).success).toBe(false);
  });
});
