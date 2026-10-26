// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkProjectContext, DOCUMENT_CONTEXT_UPDATED_EVENT, projectContextReferences } from '../../src/providers/project-context-actions';
import { documentSetupRequest } from '../../src/providers/document-setup';

vi.mock('../../src/providers/document-setup', () => ({ documentSetupRequest: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
const reference = { projectId: 'reference-1', name: 'Survey', workingDirectory: 'C:\\Survey' };

describe('private document project context API', () => {
  it('reads without mutation, saves only project IDs, and refreshes the current project after success', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ references: [reference] }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    const updated = vi.fn(); window.addEventListener(DOCUMENT_CONTEXT_UPDATED_EVENT, updated);
    try {
      expect(await projectContextReferences('project with spaces')).toEqual([reference]);
      expect(request.mock.calls[0]?.[0]).toBe('/api/projects/project%20with%20spaces/document-setup/references');
      expect(request.mock.calls[0]?.[1].method).toBe('GET');
      expect(updated).not.toHaveBeenCalled();
      request.mockResolvedValueOnce(new Response(JSON.stringify({ references: [reference] }), { status: 200 }));
      await projectContextReferences('project-1', null, ['reference-1']);
      expect(request.mock.calls[1]?.[1].method).toBe('PUT');
      expect(JSON.parse(request.mock.calls[1]?.[1].body)).toEqual({ projectIds: ['reference-1'] });
      expect(updated.mock.calls[0]?.[0].detail).toEqual({ projectId: 'project-1', source: 'references' });
      expect(request.mock.calls.every(([url]) => String(url).endsWith('/document-setup/references'))).toBe(true);
    } finally { window.removeEventListener(DOCUMENT_CONTEXT_UPDATED_EVENT, updated); }
  });

  it('preserves references on a rejected write and does not announce uncommitted context', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'This project is not accessible' } }), { status: 403 })));
    const updated = vi.fn(); window.addEventListener(DOCUMENT_CONTEXT_UPDATED_EVENT, updated);
    try {
      await expect(projectContextReferences('project-1', null, ['restricted'])).rejects.toThrow('not accessible');
      expect(updated).not.toHaveBeenCalled();
    } finally { window.removeEventListener(DOCUMENT_CONTEXT_UPDATED_EVENT, updated); }
  });

  it('checks only on explicit action and notifies chat after a successful scan', async () => {
    vi.mocked(documentSetupRequest).mockResolvedValue(null);
    const updated = vi.fn(); window.addEventListener(DOCUMENT_CONTEXT_UPDATED_EVENT, updated);
    const signal = new AbortController().signal;
    try {
      await checkProjectContext('legacy-project', null, signal);
      expect(documentSetupRequest).toHaveBeenCalledWith('legacy-project', null, 'scan', undefined, signal);
      expect(updated.mock.calls[0]?.[0].detail).toEqual({ projectId: 'legacy-project', source: 'scan', setup: null });
      vi.mocked(documentSetupRequest).mockRejectedValue(new Error('Read failed'));
      await expect(checkProjectContext('legacy-project')).rejects.toThrow('Read failed');
      expect(updated).toHaveBeenCalledOnce();
    } finally { window.removeEventListener(DOCUMENT_CONTEXT_UPDATED_EVENT, updated); }
  });
});
