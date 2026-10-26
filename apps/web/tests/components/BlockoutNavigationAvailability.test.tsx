// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlockoutDocument } from '@open-design/contracts';
import { hasNavigableBlockout, useBlockoutNavigationAvailability } from '../../src/components/blockout/useBlockoutNavigationAvailability';
const mocks = vi.hoisted(() => ({ listBlockoutDocuments: vi.fn(), loadBlockout: vi.fn(), registeredBlockoutComparisonDocument: vi.fn() }));
vi.mock('../../src/providers/blockout', () => ({ ...mocks, BLOCKOUT_COMPARISON_RESULT_EVENT: 'melillodesign:blockout-comparison-result' }));
beforeEach(() => { vi.clearAllMocks(); mocks.listBlockoutDocuments.mockResolvedValue([]); mocks.loadBlockout.mockResolvedValue({ document: null, raw: null }); mocks.registeredBlockoutComparisonDocument.mockResolvedValue(null); });
afterEach(cleanup);
describe('proposal navigation follows saved page structure', () => {
  it('keeps modern setup seeds hidden even when titled and populated with empty editorial pages', () => {
    const seed = createBlockoutDocument(); seed.title = 'Relazione B'; seed.variants[0]!.pages.push({ ...seed.variants[0]!.pages[0]!, id: 'page-2', label: 'Seconda pagina' });
    expect(hasNavigableBlockout(seed)).toBe(false); seed.selectedVariantId = seed.activeVariantId; expect(hasNavigableBlockout(seed)).toBe(true);
  });
  it('retains existing legacy saved workspaces', async () => {
    const legacy = createBlockoutDocument(); delete legacy.planningStage; mocks.listBlockoutDocuments.mockRejectedValue(new Error('Old catalog absent')); mocks.loadBlockout.mockResolvedValue({ document: legacy, raw: '{}' });
    const { result } = renderHook(() => useBlockoutNavigationAvailability('legacy', [{ name: 'blockout/layout.json' }], 1));
    await waitFor(() => expect(result.current).toBe(true)); expect(mocks.loadBlockout).toHaveBeenCalledWith('legacy', undefined, expect.any(AbortSignal), 'document-1');
  });
  it('exposes navigation when a real generated structure arrives and keeps it through transient reads', async () => {
    const document = createBlockoutDocument(); mocks.listBlockoutDocuments.mockResolvedValue([{ id: 'document-1', title: '' }]); mocks.loadBlockout.mockResolvedValue({ document, raw: '{}' });
    const { result } = renderHook(() => useBlockoutNavigationAvailability('project', [{ name: 'blockout/layout.json' }], 1));
    await waitFor(() => expect(mocks.loadBlockout).toHaveBeenCalled()); expect(result.current).toBe(false);
    const proposed = structuredClone(document); proposed.variants[0]!.pages[0]!.blocks.push({ id: 'title', kind: 'text', label: 'Titolo', box: { x: 10, y: 10, width: 80, height: 10, rotation: 0 }, lockRatio: false, images: [], references: [], expectation: '', feedback: '', flexibility: 'guided' });
    mocks.loadBlockout.mockResolvedValue({ document: proposed, raw: '{"updated":true}' }); act(() => window.dispatchEvent(new CustomEvent('melillodesign:blockout-comparison-result', { detail: { projectId: 'project', documentId: 'document-1' } })));
    await waitFor(() => expect(result.current).toBe(true));
    mocks.loadBlockout.mockRejectedValue(new Error('Temporarily offline')); act(() => window.dispatchEvent(new CustomEvent('melillodesign:blockout-saved', { detail: { projectId: 'project' } })));
    await new Promise((resolve) => setTimeout(resolve, 130)); expect(result.current).toBe(true);
  });
  it('does not carry a previous project’s navigation into a fresh Fast project', async () => {
    const legacy = createBlockoutDocument(); delete legacy.planningStage; mocks.listBlockoutDocuments.mockResolvedValue([{ id: 'document-1', title: '' }]); mocks.loadBlockout.mockResolvedValue({ document: legacy, raw: '{}' });
    const { result, rerender } = renderHook(({ id }) => useBlockoutNavigationAvailability(id, [], 0), { initialProps: { id: 'old' } });
    await waitFor(() => expect(result.current).toBe(true)); mocks.listBlockoutDocuments.mockResolvedValue([]); rerender({ id: 'fresh-fast' }); expect(result.current).toBe(false);
  });
  it('makes a registered child proposal navigable from its Fast working chat instead of inspecting only the parent seed', async () => {
    const seed = createBlockoutDocument(), document = createBlockoutDocument(); document.documentId = 'registered-report'; document.selectedVariantId = 'brief';
    mocks.listBlockoutDocuments.mockResolvedValue([{ id: 'document-1', title: '' }]);
    mocks.registeredBlockoutComparisonDocument.mockResolvedValue(document.documentId);
    mocks.loadBlockout.mockImplementation(async (_project, _context, _signal, id) => ({ document: id === document.documentId ? document : seed, raw: '{}' }));
    const path = 'documents/relazione/blockout-comparison.html';
    const { result } = renderHook(() => useBlockoutNavigationAvailability('fast-parent', [{ name: path }], 1));
    await waitFor(() => expect(result.current).toBe(true));
    expect(mocks.registeredBlockoutComparisonDocument).toHaveBeenCalledWith('fast-parent', path, undefined, expect.any(AbortSignal));
    expect(mocks.loadBlockout).toHaveBeenCalledWith('fast-parent', undefined, expect.any(AbortSignal), document.documentId);
  });
});
