// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

vi.mock('../../src/components/blockout/BlockoutFilePreview', () => ({
  BlockoutComparisonPreview: () => <section aria-label="Native structure comparison" />,
  BlockoutFilePreview: ({ documentId }: { documentId?: string }) => <section aria-label={`Native blockout ${documentId ?? 'page'}`} />,
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const file = (name: string): ProjectFile => ({ name, path: name, type: 'file', kind: 'html', size: 100, mtime: 1, mime: 'text/html' });
describe('Blockout selection renderer boundary', () => {
  it('uses native selection for a generated comparison instead of its embedded HTML controls', () => {
    render(<FileViewer projectId="project" projectKind="prototype" file={file('documents/report/blockout-comparison.html')} />);
    expect(screen.getByRole('region', { name: 'Native structure comparison' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Source' })).toBeNull();
  });
  it('uses an explicit document marker for a legacy index entry without exposing old HTML controls', () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
    const { container } = render(<FileViewer projectId="project" projectKind="prototype" file={file('index.html')} liveHtml={'<html><head><meta name="melillodesign-blockout-document" content="document-1"></head><body><button>Edit blocks</button></body></html>'} />);
    expect(screen.getByRole('region', { name: 'Native blockout document-1' })).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit blocks' })).toBeNull();
  });
});
