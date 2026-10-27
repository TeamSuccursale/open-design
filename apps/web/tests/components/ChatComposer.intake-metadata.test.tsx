// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildIntakeVectorProposal, type IntakeAsset, type IntakeSelection } from '@open-design/contracts';
import { ChatComposer } from '../../src/components/ChatComposer';
import { I18nProvider } from '../../src/i18n';
import { composerText, flushMounts } from '../helpers/lexical-composer';
const asset: IntakeAsset = { id: 'map', documentId: 'document', sourcePath: 'private/source.pdf', sourceName: 'source.pdf', page: 5, box: [0, 0, 1000, 1000], imagePath: 'intake-assets/map.png', width: 100, height: 100, title: 'Site map', description: 'Private description', tags: ['private-tag'], kind: 'drawing', status: 'ready' };
vi.mock('../../src/components/ProjectGalleryDrawer', () => ({
  ProjectGalleryDrawer: ({ open, onAdd, onClose }: { open: boolean; onAdd: (items: IntakeSelection[]) => void; onClose: () => void }) => !open ? null : <>
    <button onClick={() => { onAdd([{ asset, note: 'Keep the legend' }]); onClose(); }}>Attach map</button>
    <button onClick={() => { onAdd([{ asset, note: 'Keep the legend', draftText: buildIntakeVectorProposal(asset, { note: 'Keep the legend', language: 'en' }).prompt }]); onClose(); }}>SVG request</button>
    <button onClick={() => { onAdd([{ asset, note: 'Keep the legend', attachmentPath: 'designs/vector/map/v2.svg', draftText: 'Use the SVG of Site map. Keep the legend' }]); onClose(); }}>Saved SVG</button>
  </>,
}));
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url === '/api/mcp/servers' ? { servers: [], templates: [] } : url === '/api/plugins' ? { plugins: [] } : url === '/api/skills' ? { skills: [] } : {}), { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
describe('intake metadata is private in the composer and user message', () => {
  it('pairs a gallery note with its image as a card, not as editor text', async () => {
    const onSend = vi.fn();
    render(<I18nProvider initial="en"><ChatComposer projectId="project" projectFiles={[]} streaming={false} skills={[]} onEnsureProject={async () => 'project'} onSend={onSend} onStop={vi.fn()} /></I18nProvider>);
    await flushMounts();
    fireEvent.click(screen.getByRole('button', { name: 'Project gallery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Attach map' }));
    const card = await screen.findByTestId('image-note-card');
    expect(card.textContent).toContain('Keep the legend');
    expect(card.textContent).toContain('Site map');
    for (const hidden of ['private/source.pdf', 'Private description', 'private-tag', 'intake-assets/map.png']) expect(card.textContent).not.toContain(hidden);
    expect(composerText().trim()).toBe('');
    fireEvent.click(screen.getByTestId('chat-send'));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0]![0]).toBe('');
    expect(onSend.mock.calls[0]![1]).toEqual([expect.objectContaining({ name: 'Site map', path: 'intake-assets/map.png', kind: 'image', annotation: { note: 'Keep the legend' } })]);
  });
  it.each(['SVG request', 'Saved SVG'])('keeps %s metadata out of the editor and sent user text', async (action) => {
    const onSend = vi.fn();
    render(<I18nProvider initial="en"><ChatComposer projectId="project" projectFiles={[]} streaming={false} skills={[]} onEnsureProject={async () => 'project'} onSend={onSend} onStop={vi.fn()} /></I18nProvider>);
    await flushMounts();
    fireEvent.click(screen.getByRole('button', { name: 'Project gallery' }));
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(composerText()).toContain('Keep the legend'));
    const visible = composerText();
    expect(visible).toContain('Site map');
    for (const hidden of ['private/source.pdf', 'Private description', 'private-tag', 'pdfPage', 'crop', 'intake-assets/map.png', 'designs/vector/map/v2.svg']) expect(visible).not.toContain(hidden);
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('chat-send'));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0]![0]).toBe(visible);
    expect(onSend.mock.calls[0]![1]).toEqual([expect.objectContaining({ name: 'Site map', path: action === 'Saved SVG' ? 'designs/vector/map/v2.svg' : 'intake-assets/map.png', kind: 'image' })]);
  });
});
