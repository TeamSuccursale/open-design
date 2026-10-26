// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { forwardRef, useImperativeHandle } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import type { Conversation, ProjectFile } from '../../src/types';

const composerMocks = vi.hoisted(() => ({
  focus: vi.fn(),
  restoreDraft: vi.fn(),
  setDraft: vi.fn(),
}));

const translate = (key: string, vars?: Record<string, string | number>) => {
  if (key === 'chat.designArtifactsShowMore') {
    return `Show ${vars?.count ?? ''} more design files`;
  }
  return key;
};

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'en', setLocale: () => undefined, t: translate }),
  useT: () => translate,
}));

vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({
      focus: composerMocks.focus,
      restoreDraft: composerMocks.restoreDraft,
      setDraft: composerMocks.setDraft,
    }));
    return <output data-testid="composer" />;
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const conversations: Conversation[] = [
  { id: 'conv-1', projectId: 'project-1', title: 'Conversation 1', createdAt: 1, updatedAt: 1 },
];

function renderPane(extra: Partial<React.ComponentProps<typeof ChatPane>>) {
  return render(
    <ChatPane
      projectKindForTracking="prototype"
      messages={[]}
      streaming={false}
      error={null}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      conversations={conversations}
      activeConversationId="conv-1"
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
      projectMetadata={{ kind: 'prototype' }}
      {...extra}
    />,
  );
}

function file(name: string, kind: ProjectFile['kind'], mtime: number): ProjectFile {
  return {
    name,
    size: 128,
    mtime,
    kind,
    mime: kind === 'html' ? 'text/html' : kind === 'image' ? 'image/jpeg' : 'text/plain',
  };
}

describe('ChatPane starter prompts', () => {
  it('places document preparation in the chat transcript above the composer without a dialog', () => {
    renderPane({ documentPreparationPending: true, documentSetupContent: <section aria-label="Document preparation"><h2>Read the context</h2><button>Skip image intake</button></section> });
    const preparation = screen.getByRole('region', { name: 'Document preparation' });
    expect(screen.getByTestId('chat-log').contains(preparation)).toBe(true);
    expect(screen.getByTestId('composer').contains(preparation)).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  // #5517: an empty conversation renders a clean pane — no 开始一个对话 title
  // and no starter template cards.
  it('renders no starter title or example cards in an empty conversation', () => {
    renderPane({});

    expect(screen.queryByText('chat.startTitle')).toBeNull();
    expect(screen.queryByText('chat.example1Title')).toBeNull();
    // 这条**故意**按类名查:它钉的是 #5517 删掉的那块 DOM 不许回来 ——
    // 被删的东西不会有 testid,类名就是它本身,换成别的钩子反而钉不住。
    expect(document.querySelector('.chat-examples')).toBeNull();
  });
});

describe('ChatPane imported folder workspace', () => {
  it('keeps the chat clean while imported and extracted files stay in the explorer', () => {
    const onRequestOpenFile = vi.fn();
    renderPane({
      projectMetadata: { kind: 'prototype', importedFrom: 'folder', entryFile: 'site/index.html' },
      projectFiles: [file('site/index.html', 'html', 20), file('intake-assets/doc/figure.png', 'image', 30)],
      onRequestOpenFile,
    });
    expect(screen.queryByTestId('chat-design-artifacts')).toBeNull();
    expect(screen.queryByText('site/index.html')).toBeNull();
    expect(screen.queryByText('intake-assets/doc/figure.png')).toBeNull();
    expect(screen.getByTestId('composer')).toBeTruthy();
    expect(onRequestOpenFile).not.toHaveBeenCalled();
  });
});
