import { afterEach, describe, expect, it, vi } from 'vitest';
import { runProjectIntakeCli } from '../../src/services/project-intake-cli.js';
vi.mock('../../src/daemon-url.js', () => ({ resolveDaemonUrl: async () => 'http://127.0.0.1:17466' }));
const settings = { version: 1, sourceDirs: ['C:/old'], outputDir: 'intake-assets', projectDir: 'C:/project', configPath: 'C:/project/intake.config.json', catalogPath: 'C:/project/intake-assets/catalog.json', outputPath: 'C:/project/intake-assets', uploadPath: 'C:/project/sources' };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('intake CLI folder parity', () => {
  it('registers and prefers SVGs through the same endpoints as the gallery', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'diagram' }) });
    vi.stubGlobal('fetch', request); vi.spyOn(console, 'log').mockImplementation(() => {});
    await runProjectIntakeCli(['register-svg', '--project', 'project', '--asset', 'diagram', '--path', 'designs/custom.svg', '--label', 'Version A', '--json']);
    expect(request.mock.calls[0]![0]).toBe('http://127.0.0.1:17466/api/projects/project/intake/assets/diagram/vectors');
    expect(JSON.parse(request.mock.calls[0]![1].body)).toEqual({ path: 'designs/custom.svg', label: 'Version A' });
    await runProjectIntakeCli(['prefer-svg', '--project', 'project', '--asset', 'diagram', '--variant', 'version', '--note', 'Clearer legend', '--json']);
    expect(request.mock.calls[1]![1].method).toBe('PUT');
    expect(JSON.parse(request.mock.calls[1]![1].body)).toEqual({ versionId: 'version', reason: 'Clearer legend' });
  });
  it('uses the same settings API to replace extra folders and change output', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => settings });
    vi.stubGlobal('fetch', request); vi.spyOn(console, 'log').mockImplementation(() => {});
    await runProjectIntakeCli(['configure', '--project', 'project', '--source-dir', 'C:/one', '--source-dir', 'D:/two', '--output-dir', 'library/figures', '--json']);
    expect(request.mock.calls[1]![0]).toBe('http://127.0.0.1:17466/api/projects/project/intake/settings');
    expect(JSON.parse(request.mock.calls[1]![1].body)).toEqual({ version: 1, sourceDirs: ['C:/one', 'D:/two'], outputDir: 'library/figures' });
  });
  it('links a project using the existing working-directory endpoint', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => settings });
    vi.stubGlobal('fetch', request); vi.spyOn(console, 'log').mockImplementation(() => {});
    await runProjectIntakeCli(['configure', '--project', 'project', '--project-folder', 'C:/chosen', '--json']);
    expect(request.mock.calls[0]![0]).toBe('http://127.0.0.1:17466/api/projects/project/working-dir');
    expect(JSON.parse(request.mock.calls[0]![1].body)).toEqual({ baseDir: 'C:/chosen' });
  });
  it('prepares SVG instructions through the same endpoint as the gallery without starting a run', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ prompt: 'Editable SVG proposal', asset: { id: 'diagram' } }) });
    vi.stubGlobal('fetch', request); vi.spyOn(console, 'log').mockImplementation(() => {});
    await runProjectIntakeCli(['propose-svg', '--project', 'project', '--asset', 'diagram', '--note', 'Keep the legend', '--language', 'en', '--json']);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toBe('http://127.0.0.1:17466/api/projects/project/intake/assets/diagram/vector-proposal');
    expect(JSON.parse(request.mock.calls[0]![1].body)).toEqual({ note: 'Keep the legend', language: 'en' });
  });
});
