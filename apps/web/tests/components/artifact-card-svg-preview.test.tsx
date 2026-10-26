// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactCards } from '../../src/components/FileOpsSummary';
vi.mock('../../src/providers/registry', () => ({ projectFileUrl: (_project: string, name: string) => `/raw/${name}` }));
const NativeURL = URL;
const createUrl = vi.fn(), revokeUrl = vi.fn();
const snapshot = '/api/projects/p/chat-artifact-snapshots/svg-1/content';
const item = { name: 'designs/vector/source/v1.svg', kind: 'image' as const, snapshotUrl: snapshot };
beforeEach(() => {
  createUrl.mockReturnValue('blob:immutable-svg');
  vi.stubGlobal('URL', class extends NativeURL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl; });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"><text>Original version</text></svg>', { headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment' } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('immutable SVG chat-card preview', () => {
  it('decodes download-only snapshot bytes as an image while exporting the original snapshot and opening the workspace file', async () => {
    const onOpen = vi.fn();
    render(<ArtifactCards projectId="p" items={[item]} onOpen={onOpen} />);
    const card = screen.getByTestId(`artifact-card-${item.name}`);
    await waitFor(() => expect(card.querySelector('img')).toHaveAttribute('src', 'blob:immutable-svg'));
    expect(fetch).toHaveBeenCalledWith(snapshot, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(createUrl.mock.calls[0]![0].type).toBe('image/svg+xml');
    expect(screen.getByTestId(`artifact-card-export-${item.name}`)).toHaveAttribute('href', snapshot);
    fireEvent.click(screen.getByTestId(`artifact-card-open-${item.name}`));
    expect(onOpen).toHaveBeenCalledWith(item.name);
    cleanup(); expect(revokeUrl).toHaveBeenCalledWith('blob:immutable-svg');
  });
  it('shows an openable filename when the SVG cannot be fetched, instead of a broken image', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Not found', { status: 404 }));
    render(<ArtifactCards projectId="p" items={[item]} onOpen={vi.fn()} />);
    expect(await screen.findByText(item.name)).toBeTruthy();
    expect(screen.getByTestId(`artifact-card-${item.name}`).querySelector('img')).toBeNull();
    expect(createUrl).not.toHaveBeenCalled();
  });
  it('shows the filename if immutable SVG bytes fail image decoding', async () => {
    render(<ArtifactCards projectId="p" items={[item]} onOpen={vi.fn()} />);
    const card = screen.getByTestId(`artifact-card-${item.name}`);
    await waitFor(() => expect(card.querySelector('img')).not.toBeNull());
    fireEvent.error(card.querySelector('img')!);
    expect(await screen.findByText(item.name)).toBeTruthy();
    expect(card.querySelector('img')).toBeNull();
  });
});
