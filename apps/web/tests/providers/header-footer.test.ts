import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyHeaderFooterSet, disableHeaderFooter, getHeaderFooterWorkspace, HeaderFooterError, uploadHeaderFooterFiles } from '../../src/providers/header-footer';
const state = { projectId: 'project', sets: [], bindings: [], assets: [], searches: [], documents: [], transactions: [], history: [] };
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => state }); });
afterEach(() => vi.unstubAllGlobals());
describe('header/footer HTTP provider', () => {
  it('persists the explicit sharing choice through the same binding endpoint as the CLI', async () => {
    await applyHeaderFooterSet('project/name', 'report one', { setId: 'studio', followUpdates: false, header: true, footer: false, showOnCover: false, expectedBindingVersion: 3 });
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project%2Fname/header-footer/documents/report%20one/binding', expect.objectContaining({ method: 'POST', body: JSON.stringify({ setId: 'studio', followUpdates: false, header: true, footer: false, showOnCover: false, expectedBindingVersion: 3 }) }));
  });
  it('disables an unconfigured document with an explicit initial version', async () => {
    await disableHeaderFooter('project', 'new-doc', undefined);
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project/header-footer/documents/new-doc/binding?expectedBindingVersion=0', expect.objectContaining({ method: 'DELETE' }));
  });
  it('retains actionable conflict details and rejects incomplete workspace responses', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: { code: 'STALE_DRAFT', message: 'The draft changed in another document.' } }) });
    await expect(getHeaderFooterWorkspace('project')).rejects.toMatchObject({ status: 409, code: 'STALE_DRAFT', message: 'The draft changed in another document.' });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sets: [] }) });
    await expect(getHeaderFooterWorkspace('project')).rejects.toBeInstanceOf(HeaderFooterError);
  });
  it('uploads only selected logo files and ZIP contents through the owned asset endpoint', async () => {
    await uploadHeaderFooterFiles('project', [new File(['<svg/>'], 'studio.svg', { type: 'image/svg+xml' }), new File(['zip'], 'logos.zip', { type: 'application/zip' })]);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/projects/project/header-footer/assets');
    const body = JSON.parse(options.body as string) as { files: { name: string; base64: string }[] };
    expect(body.files.map((file) => file.name)).toEqual(['studio.svg', 'logos.zip']); expect(atob(body.files[0]!.base64)).toBe('<svg/>'); expect(Object.keys(body)).toEqual(['files']);
  });
});
