// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppliedHeaderFooterSchema, createDocumentPresentation, createBlockoutDocument, createBlockoutPage, type BlockoutDocument } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { BlockoutDocumentOverview } from '../../src/components/blockout/BlockoutDocumentOverview';
import { BlockoutPageBudget } from '../../src/components/blockout/BlockoutPageBudget';

afterEach(cleanup);
function fixture(): BlockoutDocument {
  const document = createBlockoutDocument();
  document.title = 'Engineering report';
  document.pageBudget = { mode: 'maximum', limit: 4, target: 4, source: 'Disciplinare, p. 8' };
  document.activeVariantId = 'proposal-a';
  document.variants = ['a', 'b', 'c'].map((letter) => ({
    id: `proposal-${letter}`, label: `Proposal ${letter.toUpperCase()}`,
    pages: Array.from({ length: 4 }, (_, index) => ({ ...createBlockoutPage(`${letter}-${index + 1}`, `Page ${index + 1}`), expectation: `Existing material group ${index + 1}` })),
  }));
  document.variants[0]!.pages.unshift({ ...createBlockoutPage('cover', 'Cover'), countsTowardLimit: false });
  document.variants[0]!.pages[1]!.blocks = [{
    id: 'drawing', label: 'Structural drawing', kind: 'drawing', box: { x: 10, y: 10, width: 60, height: 40, rotation: 0 },
    lockRatio: true, images: [], references: [], expectation: 'Existing annotated drawing', feedback: '', flexibility: 'guided',
  }];
  return document;
}
function setup(document = fixture(), extra: Partial<React.ComponentProps<typeof BlockoutDocumentOverview>> = {}) {
  const props = { document, onOpenPage: vi.fn(), onSelectProposal: vi.fn(), onMoveBlock: vi.fn(() => true), onCountPage: vi.fn(), ...extra };
  render(<I18nProvider initial="en"><BlockoutDocumentOverview {...props} /></I18nProvider>);
  return props;
}
function transfer() {
  const data = new Map<string, string>();
  return { types: ['application/x-melillodesign-blockout-block'], setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? '', effectAllowed: 'none', dropEffect: 'none' };
}

describe('complete-document Blockout overview', () => {
  it('navigates with arrow keys from the current preview without wrapping, selecting or reaching the editor', () => {
    const props = setup(fixture(), { presentation: 'proposals' });
    fireEvent.click(screen.getByRole('button', { name: 'Preview Page 2 · Proposal B' }));
    const modal = within(screen.getByRole('dialog'));
    const close = modal.getByRole('button', { name: 'Close' });
    const underlyingKeys = vi.fn();
    document.addEventListener('keydown', underlyingKeys);
    try {
      fireEvent.keyDown(close, { key: 'ArrowRight' });
      expect(modal.getByRole('img', { name: '3. Page 3' })).toBeTruthy();
      fireEvent.keyDown(close, { key: 'ArrowRight' });
      fireEvent.keyDown(close, { key: 'ArrowRight' });
      expect(modal.getByRole('img', { name: '4. Page 4' })).toBeTruthy();
      for (let step = 0; step < 4; step++) fireEvent.keyDown(close, { key: 'ArrowLeft' });
      expect(modal.getByRole('img', { name: '1. Page 1' })).toBeTruthy();
      expect(underlyingKeys).not.toHaveBeenCalled();
      expect(props.onOpenPage).not.toHaveBeenCalled();
      expect(props.onSelectProposal).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(close);
      close.blur();
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      expect(modal.getByRole('img', { name: '2. Page 2' })).toBeTruthy();
      const previous = modal.getByRole('button', { name: 'Previous page' });
      previous.focus();
      fireEvent.keyDown(previous, { key: 'ArrowLeft' });
      expect(modal.getByRole('img', { name: '1. Page 1' })).toBeTruthy();
      expect(document.activeElement).toBe(close);
      fireEvent.keyDown(close, { key: 'ArrowRight' });
      expect(modal.getByRole('img', { name: '2. Page 2' })).toBeTruthy();
    } finally {
      document.removeEventListener('keydown', underlyingKeys);
    }
  });

  it('leaves the page selector and modified arrow shortcuts to their native behavior', () => {
    setup(fixture(), { presentation: 'proposals' });
    fireEvent.click(screen.getByRole('button', { name: 'Preview Page 2 · Proposal B' }));
    const modal = within(screen.getByRole('dialog'));
    const selector = modal.getByRole('combobox', { name: 'Page in preview' });
    selector.focus();
    expect(fireEvent.keyDown(selector, { key: 'ArrowRight' })).toBe(true);
    expect(fireEvent.keyDown(selector, { key: 'ArrowLeft' })).toBe(true);
    const close = modal.getByRole('button', { name: 'Close' });
    close.focus();
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      expect(fireEvent.keyDown(close, { key: 'ArrowLeft', [modifier]: true })).toBe(true);
    }
    expect(fireEvent.keyDown(close, { key: 'ArrowRight', isComposing: true })).toBe(true);
    expect(modal.getByRole('img', { name: '2. Page 2' })).toBeTruthy();
    fireEvent.change(selector, { target: { value: 'b-4' } });
    fireEvent.keyDown(close, { key: 'ArrowLeft' });
    expect(modal.getByRole('img', { name: '3. Page 3' })).toBeTruthy();
  });

  it('pauses keyboard navigation while persisting the choice', async () => {
    let finish!: () => void;
    setup(fixture(), { presentation: 'proposals', onSelectProposal: () => new Promise<void>((resolve) => { finish = resolve; }) });
    fireEvent.click(screen.getByRole('button', { name: 'Preview Page 2 · Proposal B' }));
    const modal = within(screen.getByRole('dialog'));
    fireEvent.click(modal.getByRole('button', { name: 'Choose this structure' }));
    fireEvent.keyDown(modal.getByRole('img', { name: '2. Page 2' }), { key: 'ArrowRight' });
    expect(modal.getByRole('img', { name: '2. Page 2' })).toBeTruthy();
    await act(async () => finish());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses page three’s full-document index and cover policy for the actual recurring graphic in the modal', () => {
    const value = fixture(); value.presentation = { ...createDocumentPresentation('Report'), cover: true, pageNumbers: true, numberOnCover: false, coverCountsInNumbering: false, numberingStart: 1, header: true, footer: true };
    value.presentation.headerFooter = AppliedHeaderFooterSchema.parse({ version: 1, projectId: 'project', documentId: 'report', setId: 'studio', revision: 5, projectName: 'Project', header: true, footer: true, showOnCover: false, appliedAt: '2026-10-24', assets: [], design: { version: 1, name: 'Studio', guidance: '', stage: 'graphic', variants: [{ id: 'a4', name: 'A4', pageWidthMm: 210, pageHeightMm: 297, headerHeightMm: 20, footerHeightMm: 20, blocks: [{ id: 'number', region: 'footer', kind: 'field', field: 'pageNumber', x: .8, y: .2, width: .1, height: .5 }] }] } });
    setup(value, { presentation: 'proposals' });
    fireEvent.click(within(screen.getByRole('region', { name: 'Proposal B' })).getByRole('button', { name: 'Preview Page 3 · Proposal B' }));
    const modal = within(screen.getByRole('dialog'));
    expect(modal.getByTestId('blockout-page-presentation').getAttribute('data-sequence')).toBe('2');
    expect(modal.getByTestId('applied-header-footer').textContent).toBe('2');
  });
  it('opens read-only enlargements before choice and offers a separate whole-proposal choice', async () => {
    const value = fixture(), onSelectProposal = vi.fn(), props = setup(value, { presentation: 'proposals', onSelectProposal });
    for (const label of ['Proposal A', 'Proposal B', 'Proposal C']) {
      const region = within(screen.getByRole('region', { name: label }));
      const pageCount = value.variants.find((variant) => variant.label === label)!.pages.length;
      expect(region.getAllByRole('article')).toHaveLength(pageCount);
      expect(region.getAllByRole('button', { name: /^Preview / })).toHaveLength(pageCount);
      fireEvent.click(region.getByRole('button', { name: `Choose ${label}` }));
      await waitFor(() => expect((region.getByRole('button', { name: `Choose ${label}` }) as HTMLButtonElement).disabled).toBe(false));
      expect(region.queryByText(/Existing material group/)).toBeNull();
    }
    expect(onSelectProposal.mock.calls.map(([variantId]) => variantId)).toEqual(['proposal-a', 'proposal-b', 'proposal-c']);
    expect(props.onOpenPage).not.toHaveBeenCalled(); expect(props.onMoveBlock).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('region', { name: 'Proposal B' })).getAllByRole('button', { name: /^Preview / })[0]!);
    const preview = within(screen.getByRole('dialog', { name: 'Preview · Proposal B' }));
    expect(preview.getByRole('img', { name: '1. Page 1' })).toBeTruthy();
    expect(props.onOpenPage).not.toHaveBeenCalled();
    fireEvent.click(preview.getByRole('button', { name: 'Next page' }));
    expect(preview.getByRole('img', { name: '2. Page 2' })).toBeTruthy();
    expect(preview.queryByRole('textbox')).toBeNull(); expect(preview.getByRole('combobox', { name: 'Page in preview' })).toBeTruthy();
    fireEvent.click(preview.getByRole('button', { name: 'Choose this structure' }));
    expect(onSelectProposal.mock.calls.at(-1)).toEqual(['proposal-b']);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(props.onOpenPage).not.toHaveBeenCalled();
    expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit page|Select Structural drawing|Move/ })).toBeNull();
  });

  it('opens the exact third page from the labelled thumbnail and passes the currently viewed page only for choose-and-edit', async () => {
    const value = fixture(), props = setup(value, { presentation: 'proposals' });
    const thumbnail = within(screen.getByRole('region', { name: 'Proposal B' })).getByRole('button', { name: 'Preview Page 3 · Proposal B' });
    fireEvent.click(within(thumbnail).getByText('3. Page 3'));
    const modal = within(screen.getByRole('dialog', { name: 'Preview · Proposal B' }));
    expect(modal.getByRole('img', { name: '3. Page 3' })).toBeTruthy();
    expect((modal.getByRole('combobox', { name: 'Page in preview' }) as HTMLSelectElement).value).toBe('b-3');
    expect(props.onOpenPage).not.toHaveBeenCalled(); expect(props.onSelectProposal).not.toHaveBeenCalled();
    fireEvent.click(modal.getByRole('button', { name: 'Next page' }));
    expect(modal.getByRole('img', { name: '4. Page 4' })).toBeTruthy();
    fireEvent.click(modal.getByRole('button', { name: 'Edit this page’s composition' }));
    expect(props.onSelectProposal).toHaveBeenCalledExactlyOnceWith('proposal-b', 'b-4');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(props.onOpenPage).not.toHaveBeenCalled(); expect(value.approval).toBeUndefined();
  });

  it('uses the full document for modal navigation when a per-page file displays only page three', async () => {
    const full = fixture(), scoped = { ...full, variants: full.variants.map((variant) => ({ ...variant, pages: [variant.pages.find((page) => page.label === 'Page 3')!] })) };
    const props = setup(scoped, { previewDocument: full, presentation: 'proposals', pageNumberOffset: 2 });
    fireEvent.click(within(screen.getByRole('region', { name: 'Proposal B' })).getByRole('button', { name: 'Preview Page 3 · Proposal B' }));
    const modal = within(screen.getByRole('dialog'));
    expect(modal.getByRole('img', { name: '3. Page 3' })).toBeTruthy();
    expect(modal.getAllByRole('option')).toHaveLength(4);
    fireEvent.change(modal.getByRole('combobox', { name: 'Page in preview' }), { target: { value: 'b-1' } });
    expect(modal.getByRole('img', { name: '1. Page 1' })).toBeTruthy();
    fireEvent.click(modal.getByRole('button', { name: 'Edit this page’s composition' }));
    expect(props.onSelectProposal).toHaveBeenCalledExactlyOnceWith('proposal-b', 'b-1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the modal and saving status until selection is persisted, then reports that graphics were not approved', async () => {
    let finish!: () => void;
    const onSelectProposal = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = setup(fixture(), { presentation: 'proposals', onSelectProposal });
    fireEvent.click(within(screen.getByRole('region', { name: 'Proposal B' })).getByRole('button', { name: 'Preview Page 3 · Proposal B' }));
    const modal = within(screen.getByRole('dialog'));
    fireEvent.click(modal.getByRole('button', { name: 'Choose this structure' }));
    expect(modal.getByRole('status').textContent).toBe('Saving your choice…');
    expect((modal.getByRole('button', { name: 'Edit this page’s composition' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('dialog')).toBeTruthy(); expect(props.onOpenPage).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Structure selected and saved. Graphic design has not been approved.');
    expect(onSelectProposal).toHaveBeenCalledExactlyOnceWith('proposal-b');
  });

  it('keeps the exact preview after a failed save and retries with the requested edit page', async () => {
    const onSelectProposal = vi.fn().mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(undefined);
    const props = setup(fixture(), { presentation: 'proposals', onSelectProposal });
    fireEvent.click(within(screen.getByRole('region', { name: 'Proposal B' })).getByRole('button', { name: 'Preview Page 3 · Proposal B' }));
    const modal = within(screen.getByRole('dialog'));
    fireEvent.click(modal.getByRole('button', { name: 'Edit this page’s composition' }));
    await waitFor(() => expect(modal.getByRole('alert').textContent).toBe('Your choice could not be saved. The preview is kept: try again.'));
    expect(modal.getByRole('img', { name: '3. Page 3' })).toBeTruthy(); expect(props.onOpenPage).not.toHaveBeenCalled();
    fireEvent.click(modal.getByRole('button', { name: 'Edit this page’s composition' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onSelectProposal.mock.calls).toEqual([['proposal-b', 'b-3'], ['proposal-b', 'b-3']]);
  });

  it('uses descriptive names and closes the preview with Escape without bubbling to the editor', () => {
    const value = fixture(); value.variants[0]!.label = 'A · Continuous reading';
    const props = setup(value, { presentation: 'proposals' });
    expect(screen.getByRole('button', { name: 'Choose Continuous reading' })).toBeTruthy();
    expect(screen.queryByText('A · Continuous reading')).toBeNull();
    const opener = within(screen.getByRole('region', { name: 'Continuous reading' })).getAllByRole('button', { name: /^Preview / })[0]!;
    opener.focus(); fireEvent.click(opener);
    const underlyingEscape = vi.fn(); document.addEventListener('keydown', underlyingEscape);
    fireEvent.keyDown(document, { key: 'Escape' }); document.removeEventListener('keydown', underlyingEscape);
    expect(screen.queryByRole('dialog')).toBeNull(); expect(underlyingEscape).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener); expect(props.onOpenPage).not.toHaveBeenCalled(); expect(props.onSelectProposal).not.toHaveBeenCalled();
  });

  it('shows every page of three proposals, their own allowance count, and no raw JSON presentation', () => {
    setup();
    for (const proposal of ['Proposal A', 'Proposal B', 'Proposal C']) {
      const section = screen.getByRole('region', { name: proposal });
      expect(within(section).getAllByRole('article')).toHaveLength(proposal === 'Proposal A' ? 5 : 4);
      expect(within(section).getByText(/4 \/ 4 counted pages/)).toBeTruthy();
      expect(within(section).getByText(/Existing material group 4/)).toBeTruthy();
    }
    expect(screen.getByText(/1 excluded/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.querySelector('pre, code')).toBeNull();
    expect(screen.queryByText(/\.json|"variants"|"blocks"/)).toBeNull();
  });

  it('opens the actual nonfirst page in its proposal and selects proposals without choosing another page', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Page 3 · Proposal B' }));
    expect(props.onOpenPage).toHaveBeenCalledExactlyOnceWith('proposal-b', 'b-3');
    fireEvent.click(within(screen.getByRole('region', { name: 'Proposal C' })).getByRole('button', { name: 'Work on this proposal' }));
    expect(props.onSelectProposal).toHaveBeenCalledExactlyOnceWith('proposal-c');
    expect(props.onOpenPage).toHaveBeenCalledTimes(1);
  });

  it('offers native button/select controls to move a selected block without dragging', () => {
    const props = setup();
    const block = screen.getByRole('button', { name: 'Select Structural drawing on Page 1 · Proposal A' });
    block.focus(); fireEvent.click(block, { detail: 0 });
    const destination = screen.getByRole('combobox', { name: 'Destination page' });
    expect(within(destination).queryByRole('option', { name: 'Page 1' })).toBeNull();
    expect(within(destination).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual(['', 'cover', 'a-2', 'a-3', 'a-4']);
    fireEvent.change(destination, { target: { value: 'a-4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move block' }), { detail: 0 });
    expect(props.onMoveBlock).toHaveBeenCalledExactlyOnceWith({ variantId: 'proposal-a', pageId: 'a-1', blockId: 'drawing' }, 'a-4');
    expect(screen.getByText('Moved “Structural drawing” to Page 4.')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Destination page' })).toBeNull();
    expect(props.onOpenPage).not.toHaveBeenCalled();
  });

  it('drags a block only within its own proposal and shows the eligible destination', () => {
    const props = setup(), dataTransfer = transfer();
    fireEvent.dragStart(screen.getByRole('button', { name: 'Select Structural drawing on Page 1 · Proposal A' }), { dataTransfer });
    const other = screen.getByTestId('overview-page-proposal-b-b-2');
    fireEvent.dragOver(other, { dataTransfer });
    expect(other.getAttribute('data-drop')).toBeNull();
    fireEvent.drop(other, { dataTransfer });
    expect(props.onMoveBlock).not.toHaveBeenCalled();
    const target = screen.getByTestId('overview-page-proposal-a-a-2');
    fireEvent.dragOver(target, { dataTransfer });
    expect(target.getAttribute('data-drop')).toBe('true');
    fireEvent.drop(target, { dataTransfer });
    expect(props.onMoveBlock).toHaveBeenCalledExactlyOnceWith({ variantId: 'proposal-a', pageId: 'a-1', blockId: 'drawing' }, 'a-2');
    expect(target.getAttribute('data-drop')).toBeNull();
  });

  it('reports a rejected move without displaying success or clearing the selected block', () => {
    const onMoveBlock = vi.fn(() => false); setup(fixture(), { onMoveBlock });
    fireEvent.click(screen.getByRole('button', { name: 'Select Structural drawing on Page 1 · Proposal A' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Destination page' }), { target: { value: 'a-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move block' }));
    expect(screen.getByText(/The block could not be moved/)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Destination page' })).toBeTruthy();
    expect(screen.queryByText(/Moved “Structural drawing”/)).toBeNull();
  });

  it('exposes page-count exclusions explicitly and disables changes while busy', () => {
    const props = setup();
    const cover = screen.getByTestId('overview-page-proposal-a-cover');
    const checkbox = within(cover).getByRole('checkbox', { name: 'Count this page in the allowance' }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(props.onCountPage).toHaveBeenCalledExactlyOnceWith('proposal-a', 'cover', true);
    cleanup();
    setup(fixture(), { busy: true });
    for (const control of screen.getAllByRole('checkbox')) expect((control as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Select Structural drawing on Page 1 · Proposal A' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens blocks directly in a read-only comparison without offering move or exclusion controls', () => {
    const props = setup(fixture(), { onMoveBlock: undefined, onCountPage: undefined, onSelectProposal: undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Select Structural drawing on Page 1 · Proposal A' }));
    expect(props.onOpenPage).toHaveBeenCalledExactlyOnceWith('proposal-a', 'a-1', 'drawing');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Excluded from allowance')).toBeTruthy();
  });

  it('keeps the selected proposal’s complete paper ratios and page targets in the larger presentation', () => {
    const value = fixture(); value.variants = [value.variants[1]!]; value.activeVariantId = 'proposal-b';
    value.variants[0]!.pages[2]!.widthMm = 420; value.variants[0]!.pages[2]!.heightMm = 297;
    const props = setup(value, { presentation: 'selected', onMoveBlock: undefined, onCountPage: undefined, onSelectProposal: undefined });
    const pages = within(screen.getByRole('region', { name: 'Proposal B' })).getAllByRole('article');
    expect(pages).toHaveLength(4);
    expect(pages[0]!.querySelector('[style*="aspect-ratio"]')?.getAttribute('style')).toContain('210 / 297');
    expect(pages[2]!.querySelector('[style*="aspect-ratio"]')?.getAttribute('style')).toContain('420 / 297');
    fireEvent.click(within(pages[2]!).getByRole('button', { name: 'Edit Page 3 · Proposal B' }));
    expect(props.onOpenPage).toHaveBeenCalledExactlyOnceWith('proposal-b', 'b-3');
    expect(props.onSelectProposal).toBeUndefined(); expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

function BudgetHarness({ initial = fixture(), onAddPages = vi.fn() }: { initial?: BlockoutDocument; onAddPages?: (count: number) => void }) {
  const [document, setDocument] = useState(initial);
  return <I18nProvider initial="en"><BlockoutPageBudget document={document} busy={false} onChange={setDocument} onAddPages={onAddPages} /></I18nProvider>;
}
describe('visible and adjustable page allowance', () => {
  it('keeps source maximum and full target visible, while allowing flexible exploration and exact counts', () => {
    render(<BudgetHarness />);
    fireEvent.click(screen.getByText('Adjust allowance'));
    expect(screen.getByText('Disciplinare, p. 8')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Use the full allowance' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('spinbutton', { name: 'Planning target' }) as HTMLInputElement).value).toBe('4');
    fireEvent.change(screen.getByRole('combobox', { name: 'Allowance rule' }), { target: { value: 'flexible' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Planning target' }), { target: { value: '6' } });
    expect(screen.getByText('4 / 6 target pages')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('2 pages still to allocate');
    expect((screen.getByRole('spinbutton', { name: 'Allowed pages' }) as HTMLInputElement).value).toBe('4');
    fireEvent.change(screen.getByRole('combobox', { name: 'Allowance rule' }), { target: { value: 'exact' } });
    expect((screen.getByRole('spinbutton', { name: 'Planning target' }) as HTMLInputElement).value).toBe('4');
    expect((screen.getByRole('spinbutton', { name: 'Planning target' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('offers target-page allocation and warns about excess without discarding pages', () => {
    const document = fixture(), onAddPages = vi.fn();
    document.variants[0]!.pages.splice(3);
    render(<BudgetHarness initial={document} onAddPages={onAddPages} />);
    expect(screen.getByRole('status').textContent).toBe('2 pages still to allocate');
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 pages to reach the target' }));
    expect(onAddPages).toHaveBeenCalledExactlyOnceWith(2);
    cleanup();
    const over = fixture(); over.variants[0]!.pages.push(createBlockoutPage('extra', 'Exploration'));
    render(<BudgetHarness initial={over} />);
    expect(screen.getByText(/5 \/ 4 counted pages/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('1 pages over the allowance');
  });
});
