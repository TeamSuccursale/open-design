// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupportDialog } from '../../../src/components/chat/SupportDialog';
import { supportChannels } from '../../../src/components/chat/support-channels';
import { I18nProvider } from '../../../src/i18n';
import { it as italian } from '../../../src/i18n/locales/it';
import type { Dict } from '../../../src/i18n/types';

// The run error card's «Contattaci» opened the upstream project's Feishu group and Discord with a
// «Unisciti» button. The team reports problems to its developer on the fork, as the team guide says.
const t = (key: keyof Dict) => italian[key];

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('support channels on the team install', () => {
  it('point to the fork issue page, not to the upstream community', () => {
    const channels = supportChannels(t);
    expect(channels.map((channel) => channel.href)).toEqual(['https://github.com/TeamSuccursale/open-design/issues/new']);
    expect(channels[0]!.name).toMatch(/sviluppatore/i);
  });

  it('offer to open a report instead of joining', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<I18nProvider initial="it"><SupportDialog inline channels={supportChannels(t)} onClose={() => {}} /></I18nProvider>);
    expect(screen.queryByRole('button', { name: italian['chat.support.join'] })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /segnalazione/i }));
    expect(open).toHaveBeenCalledWith('https://github.com/TeamSuccursale/open-design/issues/new', '_blank', 'noopener,noreferrer');
  });
});
