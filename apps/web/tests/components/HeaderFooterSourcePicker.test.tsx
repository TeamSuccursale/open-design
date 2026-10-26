// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeaderFooterSourcePicker } from '../../src/components/header-footer/HeaderFooterSourcePicker';
const mocks = vi.hoisted(() => ({ getHeaderFooterSourceFiles: vi.fn(), importHeaderFooterSources: vi.fn() }));
vi.mock('../../src/providers/header-footer', () => mocks);
beforeEach(() => { vi.clearAllMocks(); mocks.getHeaderFooterSourceFiles.mockResolvedValue({ files: [{ id: 'source', name: 'loghi.zip', relativePath: 'sources/loghi.zip', folder: 'Test project', kind: 'zip', size: 90 }], truncated: false }); });
afterEach(cleanup);
describe('existing logo source selection', () => {
  it('distinguishes available source files from received logos and imports only the selected ZIP', async () => {
    const onImported = vi.fn(), imported = { assets: [{ id: 'logo' }], errors: [] }; mocks.importHeaderFooterSources.mockResolvedValue(imported);
    render(<HeaderFooterSourcePicker projectId="project" italian onImported={onImported} />);
    expect(await screen.findByLabelText(/loghi.zip/)).toBeTruthy(); expect(screen.queryByText('Ricevuto')).toBeNull();
    expect(mocks.importHeaderFooterSources).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/loghi.zip/)); fireEvent.click(screen.getByRole('button', { name: 'Importa 1 file nella raccolta' }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(imported));
    expect(mocks.importHeaderFooterSources).toHaveBeenCalledWith('project', ['source'], undefined);
    expect(await screen.findByText(/File importati/)).toBeTruthy();
  });
  it('keeps source and import failures actionable without falsely marking an asset received', async () => {
    const onImported = vi.fn(); mocks.importHeaderFooterSources.mockRejectedValue(new Error('Il file sorgente è cambiato.'));
    render(<HeaderFooterSourcePicker projectId="project" italian onImported={onImported} />);
    fireEvent.click(await screen.findByLabelText(/loghi.zip/)); fireEvent.click(screen.getByRole('button', { name: 'Importa 1 file nella raccolta' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Il file sorgente è cambiato.'); expect(onImported).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Rileggi i file' })); await waitFor(() => expect(mocks.getHeaderFooterSourceFiles).toHaveBeenCalledTimes(2));
  });
});
