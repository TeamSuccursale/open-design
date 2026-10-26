// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeaderFooterRevision, HeaderFooterSet, HeaderFooterWorkspaceResponse } from '@open-design/contracts';
import { HeaderFooterHistory } from '../../src/components/header-footer/HeaderFooterHistory';
const mocks = vi.hoisted(() => ({ getHeaderFooterVersions: vi.fn(), restoreHeaderFooterDraft: vi.fn(), restoreHeaderFooterSet: vi.fn() }));
vi.mock('../../src/providers/header-footer', () => mocks);
const variants = [{ id: 'a4', name: 'A4', pageWidthMm: 210, pageHeightMm: 297, headerHeightMm: 28, footerHeightMm: 20, blocks: [] }];
const older = { id: 1, setId: 'studio', name: 'Studio', guidance: '', stage: 'graphic' as const, variants, createdAt: '2026-10-24T10:00:00Z' };
const current = { ...older, id: 2 };
const set: HeaderFooterSet = { id: 'studio', name: 'Studio', draft: { version: 1, name: 'Studio', guidance: '', stage: 'graphic', variants }, publishedRevision: current, revision: 2, draftVersion: 5, archivedAt: null, createdAt: older.createdAt, updatedAt: older.createdAt };
const state: HeaderFooterWorkspaceResponse = { projectId: 'project', sets: [set], bindings: [], assets: [], searches: [], documents: [], transactions: [], history: [] };
beforeEach(() => { mocks.getHeaderFooterVersions.mockResolvedValue({ revisions: [older, current], drafts: [{ id: 'draft-1', draft: set.draft, draftVersion: 3, createdAt: older.createdAt }] }); mocks.restoreHeaderFooterSet.mockResolvedValue(state); mocks.restoreHeaderFooterDraft.mockResolvedValue(state); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('header/footer recovery', () => {
  it('compares real revisions before restoring a selected version in only this document', async () => {
    render(<HeaderFooterHistory projectId="project" documentId="report" set={set} workspace={state} italian onRestored={vi.fn()} onError={vi.fn()} />);
    expect(await screen.findByTestId('header-footer-history-comparison')).toBeTruthy();
    expect(screen.getAllByTestId('header-footer-page')).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Differenze tra revisioni' })).toBeTruthy(); expect(screen.getByText(/Bozza v3 · non applicata/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Dove ripristinare'), { target: { value: 'document' } }); fireEvent.click(screen.getByRole('button', { name: 'Ripristina revisione 1' }));
    await waitFor(() => expect(mocks.restoreHeaderFooterSet).toHaveBeenCalledWith('project', 'studio', expect.objectContaining({ revision: 1, documentId: 'report', expectedRevision: 2, expectedDraftVersion: 5 }), undefined));
  });
  it('recovers a saved draft without applying it to documents', async () => {
    const onRestored = vi.fn(); render(<HeaderFooterHistory projectId="project" documentId="report" set={set} workspace={state} italian onRestored={onRestored} onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Recupera bozza' }));
    await waitFor(() => expect(mocks.restoreHeaderFooterDraft).toHaveBeenCalledWith('project', 'studio', 'draft-1', 5, undefined));
    expect(onRestored).toHaveBeenCalledWith(state, true); expect(mocks.restoreHeaderFooterSet).not.toHaveBeenCalled();
  });
  it('names the changed block and property beside the revision previews', async () => {
    const before: HeaderFooterRevision = structuredClone(older), after: HeaderFooterRevision = structuredClone(current);
    before.variants[0]!.blocks = [{ id: 'header-rule', region: 'header', kind: 'rule', x: .08, y: .8, width: .828, height: .01 }];
    after.variants[0]!.blocks = [{ ...before.variants[0]!.blocks[0]!, width: .848 }];
    mocks.getHeaderFooterVersions.mockResolvedValue({ revisions: [before, after], drafts: [] });
    render(<HeaderFooterHistory projectId="project" documentId="report" set={{ ...set, publishedRevision: after }} workspace={state} italian onRestored={vi.fn()} onError={vi.fn()} />);
    expect(await screen.findByText('Separatore intestazione · header-rule')).toBeTruthy();
    expect(screen.getByText('Larghezza: 82.8% → 84.8%')).toBeTruthy();
  });
});
