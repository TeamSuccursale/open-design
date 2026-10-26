// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlockoutDocument, createBlockoutPage, type BlockoutDocument, type DocumentSetup } from '@open-design/contracts';
import { DocumentProjectWorkspace } from '../../src/components/document-setup/DocumentProjectWorkspace';
import { BLOCKOUT_OPEN_EVENT, type BlockoutOpenRequest } from '../../src/components/blockout/events';
import { I18nProvider } from '../../src/i18n';
import { en } from '../../src/i18n/locales/en';
import { listBlockoutDocuments, loadBlockout, saveBlockout } from '../../src/providers/blockout';
import { documentSetupRequest } from '../../src/providers/document-setup';

vi.mock('../../src/providers/blockout', () => ({ listBlockoutDocuments: vi.fn(), loadBlockout: vi.fn(), saveBlockout: vi.fn() }));
vi.mock('../../src/providers/document-setup', () => ({ documentSetupRequest: vi.fn() }));
vi.mock('../../src/components/chat/ProjectIntakeProgress', () => ({ ProjectIntakeProgress: () => <div data-testid="background-intake" /> }));
const text = (key: string) => en[`documentWorkspace.${key}` as keyof typeof en];
const onEditorOpen = vi.fn();
let document: BlockoutDocument;
function fixture() {
  const value = createBlockoutDocument(); value.title = 'Survey document'; value.activeVariantId = 'a';
  value.variants = ['a', 'b', 'c'].map((id) => ({ id, label: `Proposal ${id.toUpperCase()}`, pages: ['cover', 'details'].map((pageName) => ({
    ...createBlockoutPage(`${id}-${pageName}`, `${id.toUpperCase()} ${pageName}`), blocks: [{ id: `${id}-${pageName}-block`, label: 'Supplied material', kind: 'text' as const, box: { x: 10, y: 10, width: 80, height: 60, rotation: 0 }, lockRatio: false, expectation: 'Preserve the supplied engineering material', flexibility: 'guided' as const, feedback: '', images: [], references: [] }],
  })) }));
  return value;
}
function confirmedSetup(blockoutApproach: 'manual' | 'agent'): DocumentSetup {
  return { version: 1, status: 'confirmed', intent: { kind: 'free', subtype: '', purpose: 'Plan the survey document', contextRoots: [], imageIntakeConsent: false }, workingDirectory: 'C:\\Working', scan: { status: 'complete', sources: [], constraints: [], warnings: [] }, confirmed: { purpose: 'Plan the survey document', constraints: [], blockoutApproach, confirmedAt: '2026-10-23T12:00:00Z' }, updatedAt: '2026-10-23T12:00:00Z' };
}
function setup(overrides: Partial<React.ComponentProps<typeof DocumentProjectWorkspace>> = {}) {
  const callbacks = { onBack: vi.fn(), onChat: vi.fn(), onFiles: vi.fn(), onStop: vi.fn() };
  const props = { projectId: 'project', title: 'Project title', enabled: true, running: false, failed: false, chatOpen: false, left: 0, ...callbacks, ...overrides };
  const view = render(<I18nProvider initial="en"><DocumentProjectWorkspace {...props} /></I18nProvider>);
  return { ...callbacks, ...view, rerenderProps: (next: Partial<typeof props>) => view.rerender(<I18nProvider initial="en"><DocumentProjectWorkspace {...props} {...next} /></I18nProvider>) };
}
beforeEach(() => {
  document = fixture();
  vi.mocked(listBlockoutDocuments).mockResolvedValue([{ id: 'document-1', title: 'Survey document' }]);
  vi.mocked(loadBlockout).mockImplementation(async () => ({ document, raw: 'original' }));
  vi.mocked(documentSetupRequest).mockResolvedValue(null);
  window.addEventListener(BLOCKOUT_OPEN_EVENT, onEditorOpen);
});
afterEach(() => { cleanup(); window.removeEventListener(BLOCKOUT_OPEN_EVENT, onEditorOpen); vi.resetAllMocks(); });

describe('document workspace stages', () => {
  it('states unknown provenance for existing structures instead of attributing them to Codex', async () => {
    setup();
    await screen.findByRole('heading', { name: text('choose') });
    expect(screen.getByText(text('savedOrigin'))).toBeTruthy();
    expect(screen.queryByText(/Prepared by Codex/)).toBeNull();
  });

  it('attributes proposals only to the verified agent supplied by the run owner', async () => {
    setup({ verifiedAgent: 'Codex CLI · gpt-6.1-sol' });
    expect(await screen.findByText(text('agentOrigin').replace('{agent}', 'Codex CLI · gpt-6.1-sol'))).toBeTruthy();
    expect(screen.queryByText(text('savedOrigin'))).toBeNull();
  });

  it('keeps partial proposals hidden while preparation is running and exposes Stop without auto-opening chat', async () => {
    document.variants = document.variants.slice(0, 1);
    const view = setup({ running: true, verifiedAgent: 'Codex CLI' });
    await waitFor(() => expect(loadBlockout).toHaveBeenCalledOnce());
    expect(screen.getByRole('heading', { name: text('preparing').replace('{agent}', 'Codex CLI') })).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: text('progress') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose Proposal A' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Choose and edit:/ })).toBeNull();
    expect(view.onChat).not.toHaveBeenCalled(); expect(onEditorOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: text('stop') })); expect(view.onStop).toHaveBeenCalledOnce();
    document = fixture(); view.rerenderProps({ running: false });
    await screen.findByRole('button', { name: 'Choose Proposal C' });
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('saves a choice without approving graphics and can compare other proposals without losing it', async () => {
    const original = structuredClone(document); setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Proposal B' }));
    expect(await screen.findByRole('heading', { name: text('selected') })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Proposal B' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Proposal A' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Proposal C' })).toBeNull();
    expect(document).toEqual(original); expect(document.approval).toBeUndefined();
    expect(saveBlockout).toHaveBeenCalledWith('project', { ...original, activeVariantId: 'b', selectedVariantId: 'b' }, 'original', undefined); expect(onEditorOpen).not.toHaveBeenCalled();
    const deselect = screen.getByRole('button', { name: en['chat.comments.deselect'] });
    expect(deselect.getAttribute('title')).toBe(text('compareAll'));
    fireEvent.click(deselect);
    expect(screen.getByRole('button', { name: 'Choose Proposal A' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose Proposal C' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: text('choose') })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Proposal A' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Proposal C' })).toBeTruthy();
    expect(document).toEqual(original); expect(saveBlockout).toHaveBeenCalledOnce();
  });

  it('offers a distinct choice action and page previews that open a modal without saving or approving', async () => {
    const original = structuredClone(document); setup();
    await screen.findByRole('heading', { name: text('choose') });
    for (const label of ['Proposal A', 'Proposal B', 'Proposal C']) {
      const proposal = screen.getByRole('region', { name: label });
      expect(within(proposal).getAllByRole('button', { name: /^Preview / })).toHaveLength(2);
      expect(within(proposal).getByRole('button', { name: `Choose ${label}` })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: /Edit page|Choose and edit|Edit .* ·/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByRole('combobox')).toBeNull();
    expect(document).toEqual(original); expect(saveBlockout).not.toHaveBeenCalled(); expect(onEditorOpen).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('region', { name: 'Proposal B' })).getAllByRole('button', { name: /^Preview / })[1]!);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onEditorOpen).not.toHaveBeenCalled(); expect(document).toEqual(original); expect(saveBlockout).not.toHaveBeenCalled();
  });

  it('opens comparison without inheriting the saved active or approved proposal and resets when reopened', async () => {
    document.activeVariantId = 'b'; document.approval = { variantId: 'b', acceptedAt: '2026-10-23T12:00:00.000Z' };
    const view = setup(); fireEvent.click(await screen.findByRole('button', { name: 'Choose Proposal B' }));
    expect(await screen.findByRole('heading', { name: text('selected') })).toBeTruthy();
    view.rerenderProps({ enabled: false }); view.rerenderProps({ enabled: true });
    await screen.findByRole('button', { name: 'Choose Proposal A' });
    expect(screen.getByRole('button', { name: 'Choose Proposal B' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: text('editSelected') })).toBeNull(); expect(onEditorOpen).not.toHaveBeenCalled();
  });

  it('opens the selected proposal’s actual page target and keeps files and closing explicit', async () => {
    const view = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Proposal B' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit page: Proposal B · B details' }));
    const detail = (onEditorOpen.mock.calls[0]![0] as CustomEvent<BlockoutOpenRequest>).detail;
    expect(detail).toEqual({ projectId: 'project', documentId: 'document-1', variantId: 'b', pageId: 'b-details' });
    fireEvent.click(screen.getByRole('button', { name: text('files') }));
    expect(view.onFiles).toHaveBeenCalledOnce(); expect(view.onChat).not.toHaveBeenCalled();
    expect(saveBlockout).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: en['common.close'] }));
    expect(view.onBack).toHaveBeenCalledOnce();
  });

  it('does not offer a chat-hiding toggle inside the comparison', async () => {
    const view = setup({ chatOpen: true }); await screen.findByRole('heading', { name: text('choose') });
    expect(screen.queryByRole('button', { name: text('hideChat') })).toBeNull();
    expect(screen.queryByRole('button', { name: text('openChat') })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en['common.close'] }));
    expect(view.onBack).toHaveBeenCalledOnce(); expect(view.onChat).not.toHaveBeenCalled(); expect(onEditorOpen).not.toHaveBeenCalled();
  });

  it('keeps a legacy blank document without setup editor-free before a proposal exists', async () => {
    document = createBlockoutDocument(); setup(); await screen.findByRole('heading', { name: text('empty') });
    expect(screen.queryByRole('button', { name: en['blockout.open'] })).toBeNull();
    expect(screen.queryByRole('button', { name: text('editSelected') })).toBeNull(); expect(onEditorOpen).not.toHaveBeenCalled();
    expect(screen.queryByText(/Prepared by Codex/)).toBeNull();
    expect(screen.queryByRole('button', { name: text('manualResume') })).toBeNull();
  });

  it('resumes the existing blank page only after the engineer confirmed the manual approach', async () => {
    document = createBlockoutDocument();
    vi.mocked(documentSetupRequest).mockResolvedValue(confirmedSetup('manual'));
    const original = structuredClone(document); setup({ verifiedAgent: 'Codex CLI' });
    expect(await screen.findByRole('heading', { name: text('manualTitle') })).toBeTruthy();
    expect(screen.queryByText(/Prepared by Codex/)).toBeNull();
    expect(screen.queryByRole('heading', { name: text('choose') })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: text('manualResume') }));
    expect((onEditorOpen.mock.calls[0]![0] as CustomEvent<BlockoutOpenRequest>).detail).toEqual({ projectId: 'project', documentId: 'document-1', variantId: 'brief', pageId: 'page-1' });
    expect(document).toEqual(original); expect(saveBlockout).not.toHaveBeenCalled();
  });

  it('keeps an agent-preparation blank seed editor-free even with confirmed setup', async () => {
    document = createBlockoutDocument();
    vi.mocked(documentSetupRequest).mockResolvedValue(confirmedSetup('agent'));
    setup(); await screen.findByRole('heading', { name: text('empty') });
    expect(screen.queryByRole('button', { name: text('manualResume') })).toBeNull();
    expect(screen.queryByRole('button', { name: en['blockout.open'] })).toBeNull();
    expect(onEditorOpen).not.toHaveBeenCalled(); expect(saveBlockout).not.toHaveBeenCalled();
  });

  it('loads the document requested by the comparison navigation target', async () => {
    setup({ initialDocumentId: 'experience-sheets' }); await screen.findByRole('heading', { name: text('choose') });
    expect(loadBlockout).toHaveBeenCalledWith('project', undefined, expect.any(AbortSignal), 'experience-sheets');
    expect(onEditorOpen).not.toHaveBeenCalled();
  });
  it('compares only the requested logical page, then edits its selected proposal’s scoped page ID', async () => {
    setup({ initialPageId: 'a-details' });
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Proposal B' }));
    await screen.findByRole('heading', { name: text('selected') });
    expect(screen.queryByTestId('overview-page-b-b-cover')).toBeNull();
    expect(screen.getByTestId('overview-page-b-b-details')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit page: Proposal B · B details' }));
    expect((onEditorOpen.mock.calls[0]![0] as CustomEvent<BlockoutOpenRequest>).detail).toEqual({ projectId: 'project', documentId: 'document-1', variantId: 'b', pageId: 'b-details' });
    expect(saveBlockout).toHaveBeenCalledOnce();
  });
});
