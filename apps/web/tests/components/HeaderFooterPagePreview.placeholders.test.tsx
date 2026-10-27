// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { HeaderFooterVariant } from '@open-design/contracts';
import { HeaderFooterPagePreview } from '../../src/components/header-footer/HeaderFooterPagePreview';

afterEach(cleanup);
const variant: HeaderFooterVariant = { id: 'a4', name: 'A4 verticale', pageWidthMm: 210, pageHeightMm: 297, headerHeightMm: 20, footerHeightMm: 15,
  blocks: [{ id: 'numbering', region: 'footer', kind: 'text', text: 'Pagina {pageNumber} di {totalPages}', x: .7, y: .2, width: .25, height: .6, align: 'right' }] };

describe('structural preview of a text block with fields', () => {
  it('shows the numbers the page will print, not the placeholder names', () => {
    render(<HeaderFooterPagePreview variant={variant} assets={[]} structural totalPages={8} visibleNumber={1} />);
    expect(screen.getByTestId('header-footer-block-numbering').textContent).toBe('Pagina 1 di 8');
  });
});
