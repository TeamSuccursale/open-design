// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchProjectIntake, PROJECT_INTAKE_UPDATED_EVENT } from '../../src/providers/project-intake';

afterEach(() => { vi.unstubAllGlobals(); });
describe('intake start notifications', () => {
  it('notifies observers only when an explicit start succeeds, without turning reads into starts', async () => {
    const catalog = { version: 1, documents: [], assets: [] };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(catalog), { status: 200 }));
    vi.stubGlobal('fetch', request);
    const updated = vi.fn(); window.addEventListener(PROJECT_INTAKE_UPDATED_EVENT, updated);
    try {
      await fetchProjectIntake('project');
      expect(request.mock.calls[0]?.[1].method).toBe('GET');
      expect(updated).not.toHaveBeenCalled();
      request.mockResolvedValueOnce(new Response(JSON.stringify(catalog), { status: 200 }));
      await fetchProjectIntake('project', undefined, {});
      expect(request.mock.calls[1]?.[1].method).toBe('POST');
      expect(updated).toHaveBeenCalledOnce();
      expect(updated.mock.calls[0]?.[0].detail).toEqual({ projectId: 'project' });
      request.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'No PDFs found' } }), { status: 400 }));
      await expect(fetchProjectIntake('project', undefined, {})).rejects.toThrow('No PDFs found');
      expect(updated).toHaveBeenCalledOnce();
    } finally { window.removeEventListener(PROJECT_INTAKE_UPDATED_EVENT, updated); }
  });
});
