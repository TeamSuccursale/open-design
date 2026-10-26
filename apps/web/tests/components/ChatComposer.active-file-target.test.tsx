// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { WorkspaceContextItem } from '@open-design/contracts';
import { ChatComposer, STAGE_ATTACHMENT_EVENT } from '../../src/components/ChatComposer';
import { I18nProvider } from '../../src/i18n';
import { composerText, flushMounts, typeAndSettle } from '../helpers/lexical-composer';

const fileContext: WorkspaceContextItem = { id: 'file:site/index.html', kind: 'file', label: 'index.html', path: 'site/index.html', tabId: 'site/index.html' };
const file = (name: string) => ({ name, path: name, type: 'file' as const, kind: 'html' as const, mime: 'text/html', size: 128, mtime: 1 });
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith('/references') ? { references: [] } : url === '/api/mcp/servers' ? { servers: [], templates: [] } : url === '/api/plugins' ? { plugins: [] } : url === '/api/skills' ? { skills: [] } : {},
  ), { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

function element(onSend: ComponentProps<typeof ChatComposer>['onSend'], activeFile = 'site/index.html', withWorkspace = true) {
  return <I18nProvider initial="en"><aside aria-label="Open preview">{activeFile}</aside><ChatComposer
    projectId="project-1" projectFiles={[file('site/index.html'), file('site/details.html')]}
    activeProjectFileName={activeFile} activeWorkspaceContext={withWorkspace ? { ...fileContext, id: `file:${activeFile}`, path: activeFile, tabId: activeFile } : null}
    streaming={false} projectMetadata={{ kind: 'prototype', importedFrom: 'folder' }}
    onEnsureProject={async () => 'project-1'} onSend={onSend} onStop={vi.fn()}
  /></I18nProvider>;
}

describe('deselect an open file without closing its preview', () => {
  it('removes the automatic target and private file context, preserving other attachments and the preview', async () => {
    const onSend = vi.fn();
    render(<I18nProvider initial="en"><aside aria-label="Open preview">site/index.html</aside><ChatComposer
      projectId="project-1" projectFiles={[file('site/index.html')]} activeProjectFileName="site/index.html"
      activeWorkspaceContext={fileContext} streaming={false}
      projectMetadata={{ kind: 'prototype', importedFrom: 'folder' }} onEnsureProject={async () => 'project-1'} onSend={onSend} onStop={vi.fn()}
    /></I18nProvider>);
    await flushMounts();
    fireEvent(window, new CustomEvent(STAGE_ATTACHMENT_EVENT, { detail: { attachments: [{ path: 'notes.pdf', name: 'notes.pdf', kind: 'file' }] } }));
    await typeAndSettle('Discuss the page options');
    fireEvent.click(screen.getByRole('button', { name: 'Remove index.html from this request' }));
    expect(screen.queryByTestId('composer-active-file')).toBeNull();
    expect(screen.getByLabelText('Open preview').textContent).toBe('site/index.html');
    expect(composerText()).toBe('Discuss the page options');
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(onSend.mock.calls[0]?.[1]).toEqual([expect.objectContaining({ path: 'notes.pdf' })]);
    expect(onSend.mock.calls[0]?.[3]).toBeUndefined();
  });

  it('removing the existing current-file context chip also suppresses the duplicate implicit attachment', async () => {
    const onSend = vi.fn(); render(element(onSend)); await flushMounts();
    fireEvent.click(screen.getByLabelText('Remove index.html'));
    await typeAndSettle('Plan another document'); fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(onSend.mock.calls[0]?.[1]).toEqual([]);
    expect(onSend.mock.calls[0]?.[3]).toBeUndefined();
    expect(screen.getByLabelText('Open preview').textContent).toBe('site/index.html');
  });

  it('keeps the same open file excluded across rerenders and multiple sends until explicitly reattached', async () => {
    const onSend = vi.fn(), view = render(element(onSend)); await flushMounts();
    fireEvent.click(screen.getByRole('button', { name: 'Remove index.html from this request' }));
    view.rerender(element(onSend));
    await typeAndSettle('First general request'); fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    await typeAndSettle('Second general request'); fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    for (const call of onSend.mock.calls) { expect(call[1]).toEqual([]); expect(call[3]).toBeUndefined(); }
    fireEvent.click(screen.getByRole('button', { name: 'Use open file: index.html' }));
    await typeAndSettle('Now edit the page'); fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(3));
    expect(onSend.mock.calls[2]?.[1]).toEqual([{ path: 'site/index.html', name: 'index.html', kind: 'file' }]);
    expect(onSend.mock.calls[2]?.[3]?.context?.workspaceItems).toEqual([fileContext]);
    expect(onSend.mock.calls[2]?.[3]?.context?.editTargetFile).toBe('site/index.html');
  });

  it('offers the newly opened file as a new target while leaving the old file deselected', async () => {
    const onSend = vi.fn(), view = render(element(onSend)); await flushMounts();
    fireEvent.click(screen.getByRole('button', { name: 'Remove index.html from this request' }));
    view.rerender(element(onSend, 'site/details.html'));
    await typeAndSettle('Edit the details'); fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(onSend.mock.calls[0]?.[1]).toEqual([{ path: 'site/details.html', name: 'details.html', kind: 'file' }]);
    expect(onSend.mock.calls[0]?.[3]?.context?.workspaceItems?.map((item: WorkspaceContextItem) => item.path)).toEqual(['site/details.html']);
  });

  it('allows an explicitly attached file after excluding its automatic target', async () => {
    const onSend = vi.fn(); render(element(onSend)); await flushMounts();
    fireEvent.click(screen.getByRole('button', { name: 'Remove index.html from this request' }));
    fireEvent(window, new CustomEvent(STAGE_ATTACHMENT_EVENT, { detail: { attachments: [{ path: 'site/index.html', name: 'index.html', kind: 'file' }] } }));
    await typeAndSettle('Use the attachment explicitly'); fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(onSend.mock.calls[0]?.[1]).toHaveLength(1);
    expect(onSend.mock.calls[0]?.[1]?.[0].path).toBe('site/index.html');
  });
});
