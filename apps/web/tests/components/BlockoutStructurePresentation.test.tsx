// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlockoutDocument, createBlockoutPage, createDocumentPresentation, type BlockoutBlock } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { BlockoutMaterialPreview } from '../../src/components/blockout/BlockoutMaterialPreview';
import { BlockoutCanvas } from '../../src/components/blockout/BlockoutCanvas';
import { BlockoutDocumentOverview } from '../../src/components/blockout/BlockoutDocumentOverview';
import { BlockoutInspector } from '../../src/components/blockout/BlockoutInspector';
import { materialDocument, materialInventory } from '../helpers/blockout-materials-fixtures';

afterEach(cleanup);
const wrap = (node: React.ReactNode) => <I18nProvider initial="en">{node}</I18nProvider>;
function legacyFixture() {
  const document = materialDocument();
  delete document.planningStage;
  const page = document.variants[0]!.pages[0]!;
  page.blocks[1]!.images = [{ assetId: 'legacy-photo', imagePath: 'source/real-photo.png', title: 'Linked photograph', description: '', sourceName: 'survey.pdf', sourcePath: 'survey.pdf', page: 1, width: 1200, height: 800 }];
  return { document, page, inventory: materialInventory() };
}

describe('Blockout as an empty structural plan', () => {
  it('honors header/footer, excluded cover allowance and a hidden cover number in editor, comparison and enlarged preview', () => {
    const document = createBlockoutDocument(), page = document.variants[0]!.pages[0]!;
    document.presentation = { ...createDocumentPresentation('Relazione B'), status: 'confirmed', header: true, footer: true, cover: true, pageNumbers: true, numberOnCover: false, coverCountsTowardPageLimit: false, coverCountsInNumbering: true };
    page.role = 'cover'; page.label = 'Copertina';
    document.variants[0]!.pages.push(createBlockoutPage('body', 'Testo'));
    render(wrap(<>
      <BlockoutCanvas page={page} presentation={document.presentation} pageIndex={0} selectedId={null} questionPage={false} projectId="project" zoom={1} onSelect={vi.fn()} onTransform={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />
      <BlockoutDocumentOverview document={document} presentation="proposals" onOpenPage={vi.fn()} />
    </>));
    expect(screen.getAllByText('Header to configure')).toHaveLength(3); expect(screen.getAllByText('Footer to configure')).toHaveLength(3);
    expect(screen.getAllByText('Outside the page limit')).toHaveLength(2);
    expect(screen.queryByLabelText('Page number 1')).toBeNull(); expect(screen.getByLabelText('Page number 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Preview Testo/ }));
    expect(screen.getAllByLabelText('Page number 2')).toHaveLength(2);
    expect(screen.getAllByTestId('blockout-page-presentation').every((node) => !node.querySelector('img'))).toBe(true);
  });

  it('does not print numbers when footer is enabled without page numbering', () => {
    const document = createBlockoutDocument(); document.presentation = { ...createDocumentPresentation('Relazione B'), footer: true, pageNumbers: false };
    render(wrap(<BlockoutDocumentOverview document={document} presentation="selected" onOpenPage={vi.fn()} />));
    expect(screen.getByText('Footer to configure')).toBeTruthy(); expect(screen.queryByLabelText(/Page number/)).toBeNull();
  });
  it.each([
    { name: 'Relazione tecnica B', widthMm: 210, heightMm: 297, pages: 8, hasCover: true, targetIndex: 1, visibleNumber: '1', headerMm: 28, footerMm: 20 },
    { name: 'Fascicolo grafico B', widthMm: 420, heightMm: 297, pages: 4, hasCover: false, targetIndex: 2, visibleNumber: '3', headerMm: 24, footerMm: 18 },
  ])('shows the actual applied graphics for $name in editor, comparison and the clicked-page modal', (example) => {
    const document = createBlockoutDocument(), variant = document.variants[0]!;
    variant.label = 'Composizione scelta';
    variant.pages = Array.from({ length: example.pages }, (_, index) => ({ ...createBlockoutPage(`page-${index + 1}`, index === 0 && example.hasCover ? 'Copertina' : `Pagina ${index + 1}`), widthMm: example.widthMm, heightMm: example.heightMm, ...(index === 0 && example.hasCover ? { role: 'cover' as const } : {}) }));
    document.presentation = {
      ...createDocumentPresentation(example.name), status: 'confirmed', header: true, footer: true, cover: example.hasCover, pageNumbers: true,
      numberOnCover: false, coverCountsTowardPageLimit: true, coverCountsInNumbering: false,
      headerFooter: {
        version: 1, projectId: 'document-workspace', documentId: 'report', setId: 'shared-studio', revision: 7, projectName: 'Progetto Antro', header: true, footer: true, showOnCover: false, appliedAt: '2026-10-24T10:00:00Z',
        assets: [{ id: 'studio-logo', path: 'documents/report/header footer/logo studio.svg', mimeType: 'image/svg+xml' }],
        design: { version: 1, name: 'Studio condiviso', guidance: '', stage: 'graphic', variants: [{
          id: 'page-format', name: example.name, pageWidthMm: example.widthMm, pageHeightMm: example.heightMm, headerHeightMm: example.headerMm, footerHeightMm: example.footerMm,
          blocks: [
            { id: 'brand', region: 'header', kind: 'logo', x: .07, y: .2, width: .15, height: .5, assetId: 'studio-logo', lockedRatio: true },
            { id: 'local-title', region: 'header', kind: 'field', field: 'documentName', x: .3, y: .2, width: .6, height: .5, fontSize: 11 },
            { id: 'local-page', region: 'footer', kind: 'field', field: 'pageNumber', x: .75, y: .2, width: .07, height: .5 },
            { id: 'local-total', region: 'footer', kind: 'field', field: 'totalPages', x: .88, y: .2, width: .07, height: .5 },
          ],
        }] },
      },
    };
    const page = variant.pages[example.targetIndex]!;
    render(wrap(<>
      <BlockoutCanvas page={page} presentation={document.presentation} pageIndex={example.targetIndex} totalPages={example.pages} selectedId={null} questionPage={false} projectId="document-workspace" zoom={1} onSelect={vi.fn()} onTransform={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />
      <BlockoutDocumentOverview document={document} presentation="proposals" onOpenPage={vi.fn()} />
    </>));
    function expectApplied(surface: HTMLElement) {
      const svg = surface.querySelector<SVGElement>('[data-header-footer-set="shared-studio"]')!;
      expect(svg).toBeTruthy(); expect(svg.getAttribute('viewBox')).toBe(`0 0 ${example.widthMm} ${example.heightMm}`); expect(svg.getAttribute('data-header-footer-revision')).toBe('7');
      expect(svg.querySelector('[data-header-footer-block="local-title"]')?.textContent).toBe(example.name);
      expect(svg.querySelector('[data-header-footer-block="local-page"]')?.textContent).toBe(example.visibleNumber);
      expect(svg.querySelector('[data-header-footer-block="local-total"]')?.textContent).toBe(String(example.pages));
      const image = svg.querySelector('image[data-header-footer-block="brand"]')!;
      expect(image.getAttribute('href')).toBe('/api/projects/document-workspace/raw/documents/report/header%20footer/logo%20studio.svg');
      expect(Number(image.getAttribute('width'))).toBeCloseTo(example.widthMm * .15); expect(Number(image.getAttribute('height'))).toBeCloseTo(example.headerMm * .5); expect(image.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    }
    expectApplied(screen.getByTestId('blockout-paper'));
    expectApplied(screen.getByTestId(`overview-page-${variant.id}-${page.id}`));
    const safe = screen.getByTestId('blockout-safe-area') as HTMLElement;
    expect(parseFloat(safe.style.top)).toBeCloseTo((example.headerMm + 10) / example.heightMm * 100);
    expect(screen.queryByText('Header to configure')).toBeNull(); expect(screen.queryByText('Footer to configure')).toBeNull();
    if (example.hasCover) expect(screen.getByTestId(`overview-page-${variant.id}-page-1`).querySelector('[data-header-footer-set]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Preview ${page.label}`) }));
    expectApplied(screen.getByRole('dialog'));
    expect((screen.getByRole('combobox', { name: 'Page in preview' }) as HTMLSelectElement).value).toBe(page.id);
  });
  it('shows functional roles and schematic rhythm even when legacy source text and images are linked', () => {
    const { page, inventory } = legacyFixture(), before = JSON.stringify(page);
    const { container } = render(wrap(<>{page.blocks.map((block) => <BlockoutMaterialPreview key={block.id} block={block} page={page} inventory={inventory} projectId="project" />)}</>));
    expect(screen.getByTestId('blockout-content-body').getAttribute('data-role')).toBe('body');
    expect(screen.getByTestId('blockout-content-photo').getAttribute('data-role')).toBe('figure');
    expect(screen.getByText('Body text')).toBeTruthy(); expect(screen.getByText('Figure or drawing')).toBeTruthy();
    expect(container.querySelectorAll('img, picture, video, iframe')).toHaveLength(0);
    expect(container.textContent).not.toContain(inventory.items.find((item) => item.kind === 'text')!.text);
    expect(container.innerHTML).not.toContain('source/real-photo.png');
    expect(container.innerHTML).not.toContain('intake/west-wall.png');
    expect(JSON.stringify(page)).toBe(before);
  });

  it('keeps the editor and comparison empty after approval instead of exposing source content', () => {
    const { document, page, inventory } = legacyFixture();
    document.approval = { variantId: document.activeVariantId, acceptedAt: '2026-10-24' };
    const { container } = render(wrap(<>
      <BlockoutCanvas page={page} selectedId={null} questionPage={false} projectId="project" zoom={1} inventory={inventory} onSelect={vi.fn()} onTransform={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />
      <BlockoutDocumentOverview document={document} inventory={inventory} projectId="project" presentation="proposals" onOpenPage={vi.fn()} />
    </>));
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.textContent).not.toContain(inventory.items.find((item) => item.kind === 'text')!.text);
    expect(screen.getAllByText(/Empty blocks · schematic rhythm/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('blockout-block-body').getAttribute('data-design-role')).toBe('body');
  });

  it('distinguishes heading, caption, table, background and navigation without requiring assets', () => {
    const document = createBlockoutDocument(), page = document.variants[0]!.pages[0]!;
    const roles = ['heading', 'body', 'caption', 'figure', 'table', 'background', 'navigation'] as const;
    const blocks = roles.map((designRole): BlockoutBlock => ({ id: designRole, designRole, label: '', kind: 'mixed', box: { x: 10, y: 10, width: 60, height: 40, rotation: 0 }, lockRatio: false, images: [], references: [], expectation: '', feedback: '', flexibility: 'guided' }));
    render(wrap(<>{blocks.map((block) => <BlockoutMaterialPreview key={block.id} block={block} page={page} />)}</>));
    for (const role of roles) expect(screen.getByTestId(`blockout-content-${role}`).getAttribute('data-role')).toBe(role);
    expect(screen.getByText('Background or watermark')).toBeTruthy();
    expect(screen.queryByText(/unresolved|inventory|missing/i)).toBeNull();
  });

  it('puts intent before collapsed references and geometry, and edits watermark intent without selecting an image', () => {
    const { page } = legacyFixture(), block = page.blocks[0]!, onBlock = vi.fn();
    render(wrap(<BlockoutInspector page={page} block={block} projectId="project" question={null} busy={false} onPage={vi.fn()} onBlock={onBlock} onPageSelect={vi.fn()} onAnswer={vi.fn()} />));
    const expectation = screen.getByRole('textbox', { name: 'What should go here?' });
    const references = screen.getByText('Optional references for later graphic design');
    const geometry = screen.getByText('Position, size and ratio');
    expect(expectation.compareDocumentPosition(references) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(expectation.compareDocumentPosition(geometry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(references.closest('details')!.open).toBe(false); expect(geometry.closest('details')!.open).toBe(false);
    expect(screen.queryByRole('textbox', { name: /Search the project gallery/ })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Role in the page' }), { target: { value: 'background' } });
    expect(onBlock).toHaveBeenCalledWith({ designRole: 'background', kind: 'mixed' });
    fireEvent.change(expectation, { target: { value: 'Subtle project watermark behind the main text.' } });
    expect(onBlock).toHaveBeenCalledWith({ expectation: 'Subtle project watermark behind the main text.' });
  });
});
