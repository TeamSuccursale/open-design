// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectLogoSources } from '../../src/components/header-footer/ProjectLogoSources';
import { I18nProvider } from '../../src/i18n';
import { getHeaderFooterSourceFiles } from '../../src/providers/header-footer';
vi.mock('../../src/providers/header-footer', () => ({ getHeaderFooterSourceFiles: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });
const mount = () => render(<I18nProvider initial="en"><ProjectLogoSources projectId="project" /></I18nProvider>);
describe('supplied logo source receipt', () => {
  it('shows the supplied ZIP as an available source, without claiming it is imported', async () => {
    vi.mocked(getHeaderFooterSourceFiles).mockResolvedValue({ files: [{ id: 'zip', name: 'client-logos.zip', relativePath: 'uploads/client-logos.zip', folder: 'Project', size: 90, kind: 'zip' }], truncated: false });
    mount();
    expect(await screen.findByText('client-logos.zip')).toBeTruthy();
    expect(screen.getByText('Images and ZIPs available')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(getHeaderFooterSourceFiles).toHaveBeenCalledWith('project', undefined, expect.any(AbortSignal));
  });
  it('keeps source failures independent and retries without importing or starting intake', async () => {
    vi.mocked(getHeaderFooterSourceFiles).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ files: [], truncated: false });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Check files again' }));
    await vi.waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(getHeaderFooterSourceFiles).toHaveBeenCalledTimes(2);
  });
  it('aborts a slow source listing and cancels the timer when unmounted', async () => {
    vi.useFakeTimers();
    vi.mocked(getHeaderFooterSourceFiles).mockImplementation(() => new Promise(() => {}));
    const view = mount(), signal = vi.mocked(getHeaderFooterSourceFiles).mock.calls[0]![2]!;
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Check files again' })).toBeTruthy();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
