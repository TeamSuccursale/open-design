// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

const file: ProjectFile = {
  name: 'composition.html',
  path: 'composition.html',
  type: 'file',
  size: 1024,
  mtime: 1000,
  kind: 'html',
  mime: 'text/html',
};

let diskSource = '<html><body><main>Original composition</main></body></html>';

function previewFrame(): HTMLIFrameElement {
  return screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
}

async function flushSourceRead() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  diskSource = '<html><body><main>Original composition</main></body></html>';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 800, height: 600, top: 0, left: 0, bottom: 600, right: 800,
  } as DOMRect);
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (url.startsWith('/api/projects/project-1/raw/composition.html')) {
      return new Response(diskSource, { status: 200 });
    }
    return new Response('', { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FileViewer URL refresh recovery', () => {
  it.each(['file update', 'Reload'] as const)(
    'recovers fresh source after a previously painted URL stalls on %s',
    async (trigger) => {
      const view = render(<FileViewer projectId="project-1" projectKind="prototype" file={file} />);
      await flushSourceRead();
      const originalFrame = previewFrame();
      expect(originalFrame.dataset.odRenderMode).toBe('url-load');
      fireEvent.load(originalFrame);

      // The first document painted successfully. A later navigation changes
      // src but never commits: Chromium continues showing the old document.
      const originalUrl = originalFrame.getAttribute('src');
      diskSource = '<html><body><main>Narrower revised composition</main></body></html>';
      if (trigger === 'file update') {
        view.rerender(<FileViewer projectId="project-1" projectKind="prototype"
          file={{ ...file, mtime: 2000 }} filesRefreshKey={1} />);
      } else {
        fireEvent.click(screen.getByRole('button', { name: /reload preview/i }));
      }
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(previewFrame().getAttribute('src')).not.toBe(originalUrl);
      // A routine revision refresh keeps the painted document visible.
      expect(screen.queryByTestId('artifact-preview-first-load')).toBeNull();

      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

      const recoveredFrame = previewFrame();
      expect(recoveredFrame.dataset.odRenderMode).toBe('srcdoc');
      expect(recoveredFrame.srcdoc).toContain('Narrower revised composition');
      expect(recoveredFrame.srcdoc).not.toContain('Original composition');
    },
  );

  it('keeps a successfully loaded refreshed URL instead of falling back', async () => {
    const view = render(<FileViewer projectId="project-1" projectKind="prototype" file={file} />);
    await flushSourceRead();
    const originalFrame = previewFrame();
    fireEvent.load(originalFrame);

    diskSource = '<html><body><main>Loaded revised composition</main></body></html>';
    view.rerender(<FileViewer projectId="project-1" projectKind="prototype"
      file={{ ...file, mtime: 2000 }} filesRefreshKey={1} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    fireEvent.load(previewFrame());
    const loadedUrl = previewFrame().getAttribute('src');

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(previewFrame()).toBe(originalFrame);
    expect(previewFrame().dataset.odRenderMode).toBe('url-load');
    expect(previewFrame().getAttribute('src')).toBe(loadedUrl);
  });
});
