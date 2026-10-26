// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlockoutDocument, createDocumentPresentation, type DocumentEditorialSettings } from '@open-design/contracts';
import { resolveHeaderFooterPageContext, useHeaderFooterPageContext } from '../../src/components/header-footer/useHeaderFooterPageContext';
const mocks = vi.hoisted(() => ({ loadBlockout: vi.fn(), getHeaderFooterWorkspace: vi.fn() }));
vi.mock('../../src/providers/blockout', () => ({ loadBlockout: mocks.loadBlockout }));
vi.mock('../../src/providers/header-footer', () => ({ getHeaderFooterWorkspace: mocks.getHeaderFooterWorkspace }));
beforeEach(() => { vi.clearAllMocks(); mocks.getHeaderFooterWorkspace.mockResolvedValue(null); });
afterEach(cleanup);
const setting: DocumentEditorialSettings = { documentId: 'booklet', presentation: createDocumentPresentation('Fascicolo'), pageTarget: 4, constraints: [{ id: 'paper', kind: 'paper', value: 'A3', status: 'confirmed', sourceIds: [] }, { id: 'orientation', kind: 'orientation', value: 'Orizzontale', status: 'confirmed', sourceIds: [] }] };
describe('document-specific recurring page context', () => {
  it('uses confirmed per-document A3 geometry and budget before body pages exist', () => {
    expect(resolveHeaderFooterPageContext(null, setting)).toEqual({ totalPages: 4, initialFormat: { widthMm: 420, heightMm: 297 } });
    expect(resolveHeaderFooterPageContext(null)).toEqual({});
  });
  it('uses the selected proposal’s actual pages instead of the earlier brief allowance', () => {
    const doc = createBlockoutDocument(); doc.variants.push({ id: 'chosen', label: 'Selected', pages: Array.from({ length: 3 }, (_, index) => ({ ...doc.variants[0]!.pages[0]!, id: `chosen-${index}`, widthMm: 300, heightMm: 200 })) }); doc.selectedVariantId = 'chosen'; doc.variants.find((item) => item.id === 'chosen')!.pages[0]!.blocks = [{ id: 'body', label: 'Testo', kind: 'text', box: { x: 10, y: 10, width: 70, height: 60, rotation: 0 }, lockRatio: false, images: [], expectation: '', feedback: '', flexibility: 'guided', references: [] }];
    expect(resolveHeaderFooterPageContext(doc, setting)).toEqual({ totalPages: 3, initialFormat: { widthMm: 300, heightMm: 200 } });
  });
  it('reads canonical persisted page context in Fast mode rather than calling guided document setup', async () => {
    mocks.loadBlockout.mockResolvedValue({ document: createBlockoutDocument() });
    mocks.getHeaderFooterWorkspace.mockResolvedValue({ pageContexts: [{ documentId: 'report', totalPages: 3, initialFormat: { widthMm: 210, heightMm: 297 } }] });
    const { result } = renderHook(() => useHeaderFooterPageContext('project', 'report', [], undefined));
    await waitFor(() => expect(result.current.totalPages).toBe(3));
    expect(result.current.initialFormat).toEqual({ widthMm: 210, heightMm: 297 });
  });
  it('never leaks a late previous document result into the current modal', async () => {
    let finishOld!: (value: unknown) => void;
    mocks.loadBlockout.mockImplementation((_project: string, _context: unknown, _signal: AbortSignal, id: string) => id === 'report' ? new Promise((resolve) => { finishOld = resolve; }) : Promise.resolve({ document: null }));
    const { result, rerender } = renderHook(({ id }) => useHeaderFooterPageContext('project', id, [], [setting]), { initialProps: { id: 'report' } });
    rerender({ id: 'booklet' }); await waitFor(() => expect(mocks.loadBlockout).toHaveBeenCalledTimes(2));
    const old = createBlockoutDocument(); finishOld({ document: old });
    await waitFor(() => expect(result.current.totalPages).toBe(4)); expect(result.current.initialFormat).toEqual({ widthMm: 420, heightMm: 297 });
    expect((mocks.loadBlockout.mock.calls[0]![2] as AbortSignal).aborted).toBe(true);
  });
});
