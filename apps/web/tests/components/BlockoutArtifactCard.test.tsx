// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlockoutDocument, createBlockoutPage, type BlockoutBlock } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { BlockoutArtifactCard } from '../../src/components/blockout/BlockoutArtifactCard';
import { loadBlockout } from '../../src/providers/blockout';
import { OPEN_BLOCKOUT_PROPOSALS_EVENT } from '../../src/components/blockout/events';

vi.mock('../../src/providers/blockout', () => ({ loadBlockout: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const block: BlockoutBlock = { id: 'body', label: 'Body', kind: 'text', box: { x: 10, y: 10, width: 80, height: 60, rotation: 0 }, lockRatio: false, expectation: '', flexibility: 'guided', feedback: '', images: [], references: [] };

describe('honest Blockout artifact cards', () => {
  it('does not advertise twelve blank setup pages or their initial document as selectable alternatives', async () => {
    const document = createBlockoutDocument(); document.documentId = 'report'; document.title = 'Relazione B'; document.variants[0]!.label = 'Struttura iniziale';
    document.variants[0]!.pages = Array.from({ length: 12 }, (_, index) => createBlockoutPage(`page-${index + 1}`, `Page ${index + 1}`));
    vi.mocked(loadBlockout).mockResolvedValue({ document, raw: 'setup scaffold' });
    const paths = [...document.variants[0]!.pages.map((page) => `blockouts/report/${page.id}.blockout.json`), 'blockout/layout.json'];
    await act(async () => { render(<I18nProvider initial="en">{paths.map((path) => <BlockoutArtifactCard key={path} projectId="p" path={path} />)}</I18nProvider>); });
    expect(loadBlockout).toHaveBeenCalledTimes(13);
    expect(screen.queryAllByTestId(/^blockout-artifact-/)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Compare/ })).toBeNull(); expect(screen.queryByText(/Blockout page|Document blockout/)).toBeNull();
  });

  it('keeps a nonempty single manual structure and its blank cover visible', async () => {
    const document = createBlockoutDocument(); document.documentId = 'report'; document.title = 'Manual report';
    document.variants[0]!.pages = [createBlockoutPage('cover', 'Cover'), { ...createBlockoutPage('body', 'Body'), blocks: [block] }];
    vi.mocked(loadBlockout).mockResolvedValue({ document, raw: 'manual' });
    render(<I18nProvider initial="en"><BlockoutArtifactCard projectId="p" path="blockouts/report/cover.blockout.json" /></I18nProvider>);
    expect(await screen.findByText('Blockout page 1 · Cover · Manual report')).toBeTruthy();
    const opened = vi.fn(); window.addEventListener(OPEN_BLOCKOUT_PROPOSALS_EVENT, opened);
    try { fireEvent.click(screen.getByRole('button', { name: 'Compare this page' })); expect(opened.mock.calls[0]![0].detail).toMatchObject({ documentId: 'report', pageId: 'cover' }); }
    finally { window.removeEventListener(OPEN_BLOCKOUT_PROPOSALS_EVENT, opened); }
  });

  it('shows real alternatives even when their pages are empty and retains an explicit saved selection', async () => {
    const document = createBlockoutDocument(); document.variants.push({ ...structuredClone(document.variants[0]!), id: 'alternative', label: 'Alternative' });
    vi.mocked(loadBlockout).mockResolvedValueOnce({ document, raw: 'alternatives' });
    const view = render(<I18nProvider initial="en"><BlockoutArtifactCard projectId="p" path="blockout/layout.json" /></I18nProvider>);
    expect(await screen.findByRole('button', { name: 'Compare all proposals' })).toBeTruthy();
    const selected = createBlockoutDocument(); selected.selectedVariantId = 'brief';
    vi.mocked(loadBlockout).mockResolvedValueOnce({ document: selected, raw: 'explicitly selected' });
    view.rerender(<I18nProvider initial="en"><BlockoutArtifactCard projectId="p" path="blockout/layout.json" revision={2} /></I18nProvider>);
    expect(await screen.findByRole('button', { name: 'Compare all proposals' })).toBeTruthy();
  });

  it('shows a former scaffold once a new revision contains composed blocks', async () => {
    const initial = createBlockoutDocument(), composed = structuredClone(initial); composed.variants[0]!.pages[0]!.blocks = [block];
    vi.mocked(loadBlockout).mockResolvedValueOnce({ document: initial, raw: 'initial' });
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<I18nProvider initial="en"><BlockoutArtifactCard projectId="p" path="blockout/layout.json" revision={1} /></I18nProvider>); });
    expect(screen.queryByRole('button', { name: /Compare/ })).toBeNull();
    vi.mocked(loadBlockout).mockResolvedValueOnce({ document: composed, raw: 'composed' });
    view.rerender(<I18nProvider initial="en"><BlockoutArtifactCard projectId="p" path="blockout/layout.json" revision={2} /></I18nProvider>);
    expect(await screen.findByRole('button', { name: 'Compare all proposals' })).toBeTruthy();
    expect(screen.getByRole('img').querySelector('i')?.style.width).toBe('80%');
  });
});
