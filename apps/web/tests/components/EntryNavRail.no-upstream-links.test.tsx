// @vitest-environment jsdom
//
// MelilloDesign is installed on the team's own PCs. The upstream project's Discord ("free credits"),
// X account and support email at the foot of the rail lead engineers to a community and a support
// desk that do not serve this install, so the rail carries no outbound community links.

import { act, cleanup, render } from '@testing-library/react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryNavRail, resetWorkspaceDirectoryCache } from '../../src/components/EntryNavRail';
import { WORKSPACE_CHROME_ACCOUNT_ACTIONS_ID } from '../../src/components/workspaceChromeActions';
import { resetProjectRunStatusStore } from '../../src/hooks/useProjectRunStatuses';
import { I18nProvider, type Locale } from '../../src/i18n';

const UPSTREAM = /discord\.gg|feishu\.cn|x\.com|mailto:|open-design\.ai/;

function teamContext(): WorkspaceCollabContext {
  return {
    workspaceId: 'ws-team',
    workspaceType: 'team',
    workspaceMemberId: 'wm-1',
    role: 'owner',
    memberStatus: 'active',
    lifecycleState: 'active',
    billingState: 'active',
    planId: 'team_plus',
    displayName: 'Leaf',
    seatSummary: { seatLimit: 5, usedSeats: 1, availableSeats: 4, isSeatFull: false },
    permissions: { canInviteMembers: true, canViewWorkspaceSettings: true },
  } as unknown as WorkspaceCollabContext;
}

function renderRail(context: WorkspaceCollabContext | null, locale: Locale) {
  return render(
    <I18nProvider initial={locale}>
      <EntryNavRail
        view="home"
        onViewChange={() => {}}
        onNewProject={() => {}}
        open
        context={context}
        billing={null}
        footerNotice={context ? undefined : <div data-testid="local-sign-in-card">Sign in</div>}
      />
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  resetWorkspaceDirectoryCache();
  resetProjectRunStatusStore();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/messages?')) return Response.json({ messages: [], nextCursor: null, unreadCount: 0 });
    if (url.includes('/status')) return Response.json({ loggedIn: false });
    if (url.includes('/api/runs?')) return Response.json({ runs: [], awaitingInputProjectIds: [] });
    return Response.json({ items: [] });
  }));
  const chrome = document.createElement('header');
  chrome.className = 'workspace-tabs-chrome';
  const host = document.createElement('div');
  host.id = WORKSPACE_CHROME_ACCOUNT_ACTIONS_ID;
  chrome.append(host);
  document.body.append(chrome);
});

afterEach(() => {
  cleanup();
  resetWorkspaceDirectoryCache();
  resetProjectRunStatusStore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelector('.workspace-tabs-chrome')?.remove();
});

describe('rail foot without upstream community links', () => {
  it.each([
    ['signed out', null, 'it'],
    ['signed in', teamContext(), 'it'],
    ['signed out, Chinese UI', null, 'zh-CN'],
  ] as const)('%s', async (_name, context, locale) => {
    renderRail(context, locale);
    await act(async () => {});
    const hrefs = [...document.querySelectorAll('a[href]')].map((link) => link.getAttribute('href') ?? '');
    expect(hrefs.filter((href) => UPSTREAM.test(href))).toEqual([]);
    expect(document.querySelector('[data-testid="entry-nav-rail-social"]')).toBeNull();
  });
});
