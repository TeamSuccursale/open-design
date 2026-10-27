import { describe, expect, it } from 'vitest';
import type { HeaderFooterBlock, HeaderFooterVariant } from '@open-design/contracts';
import { headerFooterTextOverflow } from '../../src/services/header-footer-fit.js';

// A text block can carry fields inline («Pagina {pageNumber} di {totalPages}»), so the fit check measures
// the phrase that will print, not the placeholder names.
const variant = (block: HeaderFooterBlock): HeaderFooterVariant => ({ id: 'a4', name: 'A4 verticale', pageWidthMm: 210, pageHeightMm: 297, headerHeightMm: 20, footerHeightMm: 15, blocks: [block] });
const numbering: HeaderFooterBlock = { id: 'numbering', region: 'footer', kind: 'text', text: 'Pagina {pageNumber} di {totalPages}', x: .7, y: .2, width: .12, height: .6, fontSize: 9 };

describe('header/footer fit with placeholders', () => {
  it('measures a numbering phrase with its numbers, known or not yet known', () => {
    expect(headerFooterTextOverflow([variant(numbering)], { pageNumber: '3', totalPages: '8' })).toBeNull();
    expect(headerFooterTextOverflow([variant(numbering)])).toBeNull();
  });
  it('still reports a document name that does not fit once it is filled in', () => {
    const named: HeaderFooterBlock = { ...numbering, text: 'Elaborato: {documentName}' };
    expect(headerFooterTextOverflow([variant(named)], { documentName: 'Relazione tecnica illustrativa del progetto di restauro' }))
      .toEqual({ value: 'Elaborato: Relazione tecnica illustrativa del progetto di restauro', variantName: 'A4 verticale' });
  });
});
