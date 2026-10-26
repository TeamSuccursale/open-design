import { describe, expect, it } from 'vitest';
import { AppliedHeaderFooterSchema, headerFooterReservations, renderAppliedHeaderFooterSvg } from '../src/api/header-footer-presentation.js';
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
