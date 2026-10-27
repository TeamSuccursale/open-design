// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsProvider, useAnalytics } from '../../src/analytics/provider';

const sink = vi.hoisted(() => ({ resolved: null as string | null }));
vi.mock('../../src/i18n', () => ({ useI18n: () => ({ locale: 'it' }) }));
vi.mock('../../src/analytics/identity', () => ({
  getAnonymousId: () => 'device-test', getSessionId: () => 'session-test',
  detectClientType: () => 'web', isFirstSession: () => false,
}));
vi.mock('../../src/analytics/client', () => ({
  getAnalyticsClient: vi.fn(async () => (sink.resolved ? { register: vi.fn() } : null)), capture: vi.fn(),
  getResolvedAnonymousId: () => sink.resolved,
  applyConsent: vi.fn(), applyIdentity: vi.fn(), bootstrapExceptionTracking: vi.fn(),
  setAnalyticsUserId: vi.fn(), setConfigureGlobals: vi.fn(),
}));
vi.mock('../../src/analytics/error-tracking', () => ({ patchExceptionTrackingAppVersion: vi.fn() }));

function Recording() {
  return <span>{useAnalytics().recording ? 'recording' : 'not recording'}</span>;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: { version: '1.2.3' } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sink.resolved = null; });

// Flow run 2 (27 October): the experience survey appeared over the Blockout studio although the
// daemon has no analytics key, so the answers would have gone nowhere.
describe('whether answers given to the app are recorded', () => {
  it('is false when the daemon has no analytics configured', async () => {
    render(<AnalyticsProvider><Recording /></AnalyticsProvider>);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText('not recording')).toBeTruthy();
  });

  it('is true once the daemon enables capture', async () => {
    sink.resolved = 'installation-1';
    render(<AnalyticsProvider><Recording /></AnalyticsProvider>);
    expect(await screen.findByText('recording')).toBeTruthy();
  });

  it('is false outside the provider', () => {
    render(<Recording />);
    expect(screen.getByText('not recording')).toBeTruthy();
  });
});
