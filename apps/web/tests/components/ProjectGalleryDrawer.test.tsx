// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntakeAsset, ProjectIntakeCatalog } from '@open-design/contracts';
import { ProjectGalleryDrawer } from '../../src/components/ProjectGalleryDrawer';
import { I18nProvider } from '../../src/i18n';
import { fetchIntakeSettings, fetchProjectIntake, proposeIntakeVector } from '../../src/providers/project-intake';
import { uploadProjectFiles } from '../../src/providers/registry';

vi.mock('../../src/providers/project-intake', () => ({ fetchProjectIntake: vi.fn(), fetchIntakeSettings: vi.fn(), proposeIntakeVector: vi.fn() }));
vi.mock('../../src/providers/registry', () => ({ projectRawUrl: (_project: string, file: string) => `/raw/${file}`, uploadProjectFiles: vi.fn() }));
const asset = (id: string, title: string): IntakeAsset => ({ id, documentId: 'doc', sourcePath: 'source.pdf', sourceName: 'source.pdf', page: 3,
  box: [10, 20, 800, 900], imagePath: `intake-assets/${id}.png`, width: 800, height: 600, kind: 'drawing', title, description: title, tags: [title], status: 'ready' });
const catalog: ProjectIntakeCatalog = { version: 1, documents: [], assets: [asset('plan', 'Planimetria'), asset('section', 'Sezione')] };
function setup() {
  const onAdd = vi.fn(), onClose = vi.fn();
  render(<I18nProvider initial="it"><ProjectGalleryDrawer projectId="project" open onAdd={onAdd} onClose={onClose} /></I18nProvider>);
  return { onAdd, onClose };
}
beforeEach(() => {
  localStorage.clear(); vi.mocked(fetchProjectIntake).mockResolvedValue(catalog);
  vi.mocked(fetchIntakeSettings).mockResolvedValue({ version: 1, sourceDirs: [], outputDir: 'intake-assets', projectDir: 'C:/project', configPath: 'C:/project/intake.config.json', catalogPath: 'C:/project/intake-assets/catalog.json', outputPath: 'C:/project/intake-assets', uploadPath: 'C:/project/sources' });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('Project gallery selection', () => {
  it('keeps selected items and individual notes while searching, and only stages on confirmation', async () => {
    const { onAdd, onClose } = setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Seleziona Planimetria' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nota per questo elemento' }), { target: { value: 'Usa in copertina' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Cerca descrizioni, tag o documenti…' }), { target: { value: 'Sezione' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleziona Sezione' }));
    const notes = screen.getAllByRole('textbox', { name: 'Nota per questo elemento' });
    fireEvent.change(notes[1]!, { target: { value: 'Conserva la legenda' } });
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi alla chat · 2' }));
    expect(onAdd).toHaveBeenCalledWith([{ asset: catalog.assets[0], note: 'Usa in copertina' }, { asset: catalog.assets[1], note: 'Conserva la legenda' }]);
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('shows the most recently added items first, and can show the oldest first', async () => {
    const dated = (id: string, title: string, documentId: string): IntakeAsset => ({ ...asset(id, title), documentId });
    const document = (id: string, addedAt: string) => ({ id, sourcePath: `${id}.png`, name: `${id}.png`, status: 'ready' as const, pageCount: 1, completedPages: 1, indexedPages: [1], updatedAt: '2026-10-27T12:00:00.000Z', addedAt });
    vi.mocked(fetchProjectIntake).mockResolvedValue({ version: 1,
      documents: [document('old', '2026-10-27T09:00:00.000Z'), document('new', '2026-10-27T11:00:00.000Z')],
      assets: [dated('a', 'Vecchia', 'old'), dated('b', 'Nuova', 'new')] });
    setup();
    await screen.findByRole('checkbox', { name: 'Seleziona Nuova' });
    const titles = () => screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'));
    expect(titles()).toEqual(['Seleziona Nuova', 'Seleziona Vecchia']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Ordine' }), { target: { value: 'oldest' } });
    expect(titles()).toEqual(['Seleziona Vecchia', 'Seleziona Nuova']);
  });
  it('moves the drawer between edges and closes with Escape', async () => {
    const { onClose } = setup();
    await screen.findByRole('checkbox', { name: 'Seleziona Planimetria' });
    fireEvent.click(screen.getByRole('button', { name: 'Sposta in alto' }));
    expect(localStorage.getItem('melillodesign:gallery-edge')).toBe('top');
    expect(screen.getByRole('button', { name: 'Sposta in basso' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('uses the same intake endpoint to scan PDFs already in the folder', async () => {
    setup();
    await screen.findByRole('checkbox', { name: 'Seleziona Planimetria' });
    fireEvent.click(screen.getByRole('button', { name: 'Analizza cartella' }));
    await waitFor(() => expect(fetchProjectIntake).toHaveBeenCalledWith('project', undefined, { retry: true }));
    expect(uploadProjectFiles).not.toHaveBeenCalled();
  });
  it('shows an API failure and keeps the selection available', async () => {
    setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Seleziona Planimetria' }));
    vi.mocked(fetchProjectIntake).mockRejectedValueOnce(new Error('Codex non disponibile'));
    fireEvent.click(screen.getByRole('button', { name: 'Analizza cartella' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Codex non disponibile');
    expect(screen.getByRole('button', { name: 'Aggiungi alla chat · 1' })).toBeEnabled();
  });
  it('starts intake for successful uploads even when another upload fails', async () => {
    setup();
    await screen.findByRole('checkbox', { name: 'Seleziona Planimetria' });
    vi.mocked(uploadProjectFiles).mockResolvedValueOnce({ uploaded: [{ path: 'sources/new.pdf', name: 'new.pdf', kind: 'file' }], failed: [{ name: 'failed.pdf' }], error: 'Un file non è stato caricato' });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['PDF'], 'new.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(fetchProjectIntake).toHaveBeenCalledWith('project', undefined, { paths: ['sources/new.pdf'], retry: true }));
    expect(screen.getByRole('alert').textContent).toContain('Un file non è stato caricato');
  });
  it('saves extra source folders and output without starting intake or losing selections', async () => {
    setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Seleziona Planimetria' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cartelle' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Cartelle sorgenti aggiuntive · un percorso per riga' }), { target: { value: 'C:/references\nD:/drawings' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Nuove immagini estratte · cartella relativa al progetto' }), { target: { value: 'library/figures' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva cartelle intake' }));
    await waitFor(() => expect(fetchIntakeSettings).toHaveBeenCalledWith('project', undefined, { version: 1, sourceDirs: ['C:/references', 'D:/drawings'], outputDir: 'library/figures' }));
    expect(screen.getByText('Cartelle salvate')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Torna alla galleria' }));
    expect(screen.getByRole('checkbox', { name: 'Seleziona Planimetria' })).toBeChecked();
    expect(fetchProjectIntake).not.toHaveBeenCalledWith('project', undefined, { retry: true });
  });
  it('stages an SVG proposal with its source image and note, leaving other selections intact', async () => {
    const { onAdd, onClose } = setup();
    vi.mocked(proposeIntakeVector).mockResolvedValueOnce({ asset: catalog.assets[0]!, prompt: 'Proponi una versione SVG. Conserva la legenda.', agentContext: 'Private source metadata', suggestedPath: 'designs/vector/plan.svg' });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Seleziona Planimetria' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nota per questo elemento' }), { target: { value: 'Conserva la legenda' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleziona Sezione' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Ridisegna in SVG' })[0]!);
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith([{ asset: catalog.assets[0], note: 'Conserva la legenda', draftText: 'Proponi una versione SVG. Conserva la legenda.' }]));
    expect(proposeIntakeVector).toHaveBeenCalledWith('project', 'plan', { note: 'Conserva la legenda', language: 'it' }, undefined);
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByRole('checkbox', { name: 'Seleziona Sezione' })).toBeChecked();
  });
  it('keeps notes and selection when preparing the SVG request fails', async () => {
    const { onAdd } = setup();
    vi.mocked(proposeIntakeVector).mockRejectedValueOnce(new Error('Galleria non disponibile'));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Seleziona Planimetria' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nota per questo elemento' }), { target: { value: 'Conserva la legenda' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ridisegna in SVG' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Galleria non disponibile');
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Nota per questo elemento' })).toHaveValue('Conserva la legenda');
    expect(screen.getByRole('button', { name: 'Ridisegna in SVG' })).toBeEnabled();
  });
});
