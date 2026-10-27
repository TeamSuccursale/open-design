// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAttachedImageIntake } from '../../src/hooks/useAttachedImageIntake';
import { fetchProjectIntake } from '../../src/providers/project-intake';

vi.mock('../../src/providers/project-intake', () => ({ fetchProjectIntake: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('useAttachedImageIntake', () => {
  it('asks once per opened project to take in the images attached in its chats', () => {
    vi.mocked(fetchProjectIntake).mockResolvedValue({ version: 1, documents: [], assets: [] });
    const { rerender } = renderHook(({ id }) => useAttachedImageIntake(id, null), { initialProps: { id: 'pompei' as string | null } });
    rerender({ id: 'pompei' });
    expect(fetchProjectIntake).toHaveBeenCalledTimes(1);
    expect(fetchProjectIntake).toHaveBeenCalledWith('pompei', null, { attached: true }, expect.any(AbortSignal));
    rerender({ id: 'antro' });
    expect(fetchProjectIntake).toHaveBeenLastCalledWith('antro', null, { attached: true }, expect.any(AbortSignal));
    rerender({ id: null });
    expect(fetchProjectIntake).toHaveBeenCalledTimes(2);
  });

  it('stays quiet when the daemon refuses', async () => {
    vi.mocked(fetchProjectIntake).mockRejectedValue(new Error('Forbidden'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHook(() => useAttachedImageIntake('pompei', null));
    await Promise.resolve();
    expect(errors).not.toHaveBeenCalled();
  });
});
