// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listProjectDocuments } from '../../src/providers/project-documents';
import { useProjectDocuments } from '../../src/components/project-documents/useProjectDocuments';

vi.mock('../../src/providers/project-documents', () => ({ listProjectDocuments: vi.fn(), PROJECT_DOCUMENTS_UPDATED_EVENT: 'documents-updated' }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });

describe('document list loading lifetime', () => {
  it('coalesces background refreshes without cancelling an in-flight list', async () => {
    let finish!: (value: { documents: []; selectedDocumentId: null }) => void;
    vi.mocked(listProjectDocuments).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ documents: [], selectedDocumentId: null });
    const view = renderHook(() => useProjectDocuments('parent'));
    expect(view.result.current.loading).toBe(true);
    act(() => { view.result.current.refresh(); view.result.current.refresh(); });
    expect(listProjectDocuments).toHaveBeenCalledOnce();
    expect(vi.mocked(listProjectDocuments).mock.calls[0]?.[2]?.aborted).toBe(false);
    await act(async () => { finish({ documents: [], selectedDocumentId: null }); });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(listProjectDocuments).toHaveBeenCalledTimes(2);
    expect(view.result.current.error).toBe(false);
  });
  it('turns a hanging read into a retryable error and ignores its late result', async () => {
    vi.useFakeTimers(); let finish!: (value: { documents: []; selectedDocumentId: null }) => void;
    vi.mocked(listProjectDocuments).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ documents: [], selectedDocumentId: null });
    const view = renderHook(() => useProjectDocuments('parent'));
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(view.result.current.loading).toBe(false); expect(view.result.current.error).toBe(true);
    act(() => view.result.current.refresh());
    await act(async () => { await Promise.resolve(); });
    expect(view.result.current.error).toBe(false); expect(view.result.current.loading).toBe(false);
    await act(async () => finish({ documents: [], selectedDocumentId: null }));
    expect(view.result.current.error).toBe(false);
  });
});
