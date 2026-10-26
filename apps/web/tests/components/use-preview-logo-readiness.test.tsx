// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { warmPreviewLogos, type PreviewLogo } from '../../src/components/header-footer/preview-image-readiness';
import { usePreviewLogoReadiness } from '../../src/components/header-footer/use-preview-logo-readiness';

vi.mock('../../src/components/header-footer/preview-image-readiness', () => ({ warmPreviewLogos: vi.fn() }));

type Plan = Parameters<typeof usePreviewLogoReadiness>[0];
type Pending = { signal: AbortSignal; ready: () => void; fail: () => void };
const asset: PreviewLogo = { id: 'logo', name: 'Logo', url: '/assets/logo', sha256: 'hash' };
const plan = (key = 'initial', active = true): Plan => ({ key, active, assets: [asset] });
let pending: Pending[];

beforeEach(() => {
  pending = [];
  vi.mocked(warmPreviewLogos).mockImplementation((_assets, options) => new Promise<void>((resolve, reject) => {
    pending.push({ signal: options.signal, ready: resolve, fail: () => reject(new Error('Logo decode failed')) });
  }));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('preview logo readiness hook', () => {
  it('stays loading until decode finishes, then reports ready', async () => {
    const { result } = renderHook(() => usePreviewLogoReadiness(plan()));
    expect(result.current.status).toBe('loading');
    await act(async () => pending[0]!.ready());
    expect(result.current.status).toBe('ready');
  });

  it('invalidates an old ready key when the model, format or asset fingerprint changes', async () => {
    const { result, rerender } = renderHook(({ value }: { value: Plan }) => usePreviewLogoReadiness(value), { initialProps: { value: plan() } });
    await act(async () => pending[0]!.ready());
    const initialKey = result.current.key;
    expect(result.current.status).toBe('ready');
    rerender({ value: plan('new revision / format / asset hash') });
    expect(result.current.status).toBe('loading');
    expect(result.current.key).not.toBe(initialKey);
    expect(pending[0]!.signal.aborted).toBe(true);
    await act(async () => pending[1]!.ready());
    expect(result.current.status).toBe('ready');
  });

  it('ignores an earlier decode completion after a key change', async () => {
    const { result, rerender } = renderHook(({ value }: { value: Plan }) => usePreviewLogoReadiness(value), { initialProps: { value: plan() } });
    rerender({ value: plan('next model') });
    await act(async () => pending[0]!.ready());
    expect(result.current.status).toBe('loading');
    await act(async () => pending[1]!.ready());
    expect(result.current.status).toBe('ready');
  });

  it('shows failure and creates a real new request on explicit retry', async () => {
    const { result } = renderHook(() => usePreviewLogoReadiness(plan()));
    await act(async () => pending[0]!.fail());
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBeInstanceOf(Error);
    act(() => result.current.retry());
    expect(result.current.status).toBe('loading');
    expect(warmPreviewLogos).toHaveBeenCalledTimes(2);
    await act(async () => pending[1]!.ready());
    expect(result.current.status).toBe('ready');
  });

  it('aborts when the preview closes and ignores a late completion', async () => {
    const { result, rerender } = renderHook(({ value }: { value: Plan }) => usePreviewLogoReadiness(value), { initialProps: { value: plan() } });
    rerender({ value: plan('initial', false) });
    expect(pending[0]!.signal.aborted).toBe(true);
    expect(result.current.status).toBe('inactive');
    await act(async () => pending[0]!.ready());
    expect(result.current.status).toBe('inactive');
  });

  it('aborts on unmount', () => {
    const { unmount } = renderHook(() => usePreviewLogoReadiness(plan()));
    unmount();
    expect(pending[0]!.signal.aborted).toBe(true);
  });

  it('rejects a missing referenced asset without treating it as an empty design', () => {
    const { result } = renderHook(() => usePreviewLogoReadiness({ ...plan(), missingAsset: 'Mozilla' }));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatchObject({ message: 'Logo not found: Mozilla' });
    expect(warmPreviewLogos).not.toHaveBeenCalled();
  });
});
