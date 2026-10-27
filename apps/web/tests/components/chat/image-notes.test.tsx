// @vitest-environment jsdom
// A note pinned to an image stays with that image: in the composer, in the sent
// message, and in the turn the agent receives. Images added to the chat also
// enter the project gallery.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withImageNotes, type ChatAttachment } from '@open-design/contracts';
import { ChatComposer } from '../../../src/components/ChatComposer';
import { UserMessageImpl } from '../../../src/components/ChatPane';
import { ANNOTATION_EVENT, type AnnotationEventDetail } from '../../../src/components/PreviewDrawOverlay';
import { I18nProvider } from '../../../src/i18n';
import { stageImageAnnotation } from '../../../src/runtime/chat/image-annotation';
import { composerText, flushMounts } from '../../helpers/lexical-composer';

const marked: ChatAttachment = { path: 'drawing-1.png', name: 'facciata.jpg', kind: 'image', order: 1, annotation: { note: 'Questa crepa va descritta in B.2', sourcePath: 'rilievo/facciata.jpg' } };
const plain: ChatAttachment = { path: 'rilievo/sezione.png', name: 'sezione.png', kind: 'image', order: 2 };
const t = ((key: string) => key) as never;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/upload')) return new Response(JSON.stringify({ files: [{ name: 'foto.png', path: 'foto.png', originalName: 'foto.png', size: 4 }] }), { status: 200 });
    if (url.endsWith('/intake') && init?.method === 'POST') return new Response(JSON.stringify({ version: 1, documents: [], assets: [] }), { status: 202 });
    return new Response(JSON.stringify(url === '/api/mcp/servers' ? { servers: [], templates: [] } : url === '/api/plugins' ? { plugins: [] } : url === '/api/skills' ? { skills: [] } : {}), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

function intakeRequests() {
  return fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/intake') && (init as RequestInit | undefined)?.method === 'POST')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { paths: string[] });
}

function renderComposer() {
  const onSend = vi.fn();
  render(<I18nProvider initial="it"><ChatComposer projectId="project" projectFiles={[]} streaming={false} skills={[]} onEnsureProject={async () => 'project'} onSend={onSend} onStop={vi.fn()} /></I18nProvider>);
  return onSend;
}

describe('a sent image note', () => {
  it('shows the note with its image and keeps the agent block out of the bubble', () => {
    render(<UserMessageImpl message={{ id: 'm1', role: 'user', content: withImageNotes('Scrivi il paragrafo B.2', [marked, plain]), attachments: [marked, plain], createdAt: Date.UTC(2026, 9, 27) } as never} projectId="p1" t={t} appliedContextItems={[]} />);
    const card = screen.getByTestId('image-note-card');
    expect(card.textContent).toContain('Questa crepa va descritta in B.2');
    expect(card.querySelector('img')?.getAttribute('src')).toContain('drawing-1.png');
    const message = screen.getByTestId('user-message');
    expect(message.textContent).toContain('Scrivi il paragrafo B.2');
    expect(message.textContent).not.toContain('image-notes');
    // The plain image stays in the thumbnail row; the noted one is not shown twice.
    expect(screen.getByTestId('user-attachment-row').querySelectorAll('img')).toHaveLength(1);
  });

  it('shows an image-only turn as its card, without the agent block', () => {
    render(<UserMessageImpl message={{ id: 'm2', role: 'user', content: withImageNotes('', [marked]), attachments: [marked], createdAt: Date.UTC(2026, 9, 27) } as never} projectId="p1" t={t} appliedContextItems={[]} />);
    expect(screen.getByTestId('image-note-card').textContent).toContain('Questa crepa');
    expect(screen.getByTestId('user-message').textContent).not.toContain('The engineer attached');
  });
});

describe('an image note from the viewer', () => {
  it('waits in the composer as one card and is sent with its image', async () => {
    const onSend = renderComposer();
    await flushMounts();
    const ack = vi.fn();
    await act(async () => {
      const detail: AnnotationEventDetail = { file: null, note: 'Usa questa pianta nel fascicolo A3', action: 'draft', filePath: 'rilievo/pianta.png', imageSourcePath: 'rilievo/pianta.png', ack };
      window.dispatchEvent(new CustomEvent(ANNOTATION_EVENT, { detail }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(ack).toHaveBeenCalledWith({ ok: true }));
    expect(screen.getByTestId('image-note-card').textContent).toContain('Usa questa pianta nel fascicolo A3');
    expect(composerText()).not.toContain('Usa questa pianta');
    await waitFor(() => expect(intakeRequests()).toEqual([{ paths: ['rilievo/pianta.png'] }]));
    fireEvent.click(screen.getByTestId('chat-send'));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0]![1]).toEqual([expect.objectContaining({ path: 'rilievo/pianta.png', kind: 'image', annotation: { note: 'Usa questa pianta nel fascicolo A3' } })]);
  });

  it('adds a second note on the same image to the first', () => {
    const first = stageImageAnnotation([], { path: 'a.png', name: 'a.png', kind: 'image', order: 1, annotation: { note: 'Prima nota' } });
    const second = stageImageAnnotation(first, { path: 'a.png', name: 'a.png', kind: 'image', order: 2, annotation: { note: 'Seconda nota' } });
    expect(second).toEqual([{ path: 'a.png', name: 'a.png', kind: 'image', order: 1, annotation: { note: 'Prima nota\nSeconda nota' } }]);
  });
});

describe('images added to the chat', () => {
  it('enter the project gallery once uploaded', async () => {
    renderComposer();
    await flushMounts();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['png'], 'foto.png', { type: 'image/png' })] } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(intakeRequests()).toEqual([{ paths: ['foto.png'] }]));
  });
});
