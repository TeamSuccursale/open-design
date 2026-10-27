import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkDocumentRules } from '../../src/runtime/document-rule-check';

afterEach(() => { vi.unstubAllGlobals(); });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('asking the daemon for the rule check', () => {
  it('posts the file and version to the project check route', async () => {
    const fetchMock = vi.fn(async () => json(200, { check: null }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await checkDocumentRules({ projectId: 'p 1', fileName: 'documents/tavole/tavole.html', versionId: 'v2' })).toEqual({ ok: true, check: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/projects/p%201/export/check');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ fileName: 'documents/tavole/tavole.html', versionId: 'v2' });
  });

  it('carries the daemon’s reason when it cannot measure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'no Chrome or Edge on this PC to measure the document with' } })));
    expect(await checkDocumentRules({ projectId: 'p', fileName: 'a.html' })).toEqual({ ok: false, reason: 'no-browser', detail: 'no Chrome or Edge on this PC to measure the document with' });
    vi.stubGlobal('fetch', vi.fn(async () => json(502, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'the browser did not finish measuring within 60 s' } })));
    expect(await checkDocumentRules({ projectId: 'p', fileName: 'a.html' })).toEqual({ ok: false, reason: 'failed', detail: 'the browser did not finish measuring within 60 s' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await checkDocumentRules({ projectId: 'p', fileName: 'a.html' })).toEqual({ ok: false, reason: 'failed', detail: 'Failed to fetch' });
  });
});
