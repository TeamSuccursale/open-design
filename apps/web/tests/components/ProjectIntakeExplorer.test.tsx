// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectIntakeExplorer } from '../../src/components/ProjectIntakeExplorer';
import { I18nProvider } from '../../src/i18n';
import { fetchProjectIntake, OPEN_PROJECT_GALLERY_EVENT } from '../../src/providers/project-intake';
vi.mock('../../src/providers/project-intake', () => ({ fetchProjectIntake: vi.fn(), OPEN_PROJECT_GALLERY_EVENT: 'melillodesign:open-project-gallery' }));
vi.mock('../../src/providers/registry', () => ({ projectRawUrl: (_project: string, name: string) => `/raw/${name}` }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('recognized assets in the file explorer', () => {
  it('opens images on a single click and opens the gallery only on request', async () => {
    vi.mocked(fetchProjectIntake).mockResolvedValue({ version: 1, documents: [], assets: [{ id: 'figure', documentId: 'document', sourcePath: 'source.pdf', sourceName: 'source.pdf', page: 2, box: [0, 0, 1000, 1000], imagePath: 'intake-assets/figure.png', width: 100, height: 100, title: 'Planimetria', description: 'Mappa del sito', kind: 'drawing', tags: [], status: 'ready' }] });
    const open = vi.fn(), gallery = vi.fn();
    window.addEventListener(OPEN_PROJECT_GALLERY_EVENT, gallery);
    render(<I18nProvider initial="it"><ProjectIntakeExplorer projectId="project" onOpenFile={open} /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Anteprima Planimetria' }));
    expect(open).toHaveBeenCalledWith('intake-assets/figure.png');
    expect(gallery).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Galleria' }));
    expect(gallery.mock.calls[0]![0].detail).toEqual({ projectId: 'project' });
    window.removeEventListener(OPEN_PROJECT_GALLERY_EVENT, gallery);
  });
});
