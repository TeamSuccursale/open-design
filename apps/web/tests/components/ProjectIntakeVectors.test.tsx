// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntakeAsset } from '@open-design/contracts';
import { ProjectIntakeVectors } from '../../src/components/ProjectIntakeVectors';
import { I18nProvider } from '../../src/i18n';
import { updateIntakeVector } from '../../src/providers/project-intake';
vi.mock('../../src/providers/project-intake', () => ({ updateIntakeVector: vi.fn() }));
vi.mock('../../src/providers/registry', () => ({ projectRawUrl: (_id: string, file: string) => `/raw/${file}` }));
const first = { id: 'first', path: 'designs/vector/table/v1.svg', label: 'v1.svg', sha256: 'first-hash', updatedAt: '2026-10-23' };
const second = { ...first, id: 'second', label: 'v2.svg', path: 'designs/vector/table/v2.svg', sha256: 'second-hash' };
const asset: IntakeAsset = { id: 'table', documentId: 'doc', sourcePath: 'private.pdf', sourceName: 'private.pdf', page: 3, box: [0, 0, 1000, 1000], imagePath: 'intake-assets/table.png', width: 100, height: 100, kind: 'table', title: 'Table', description: '', tags: [], status: 'ready', vectorVersions: [first, second] };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function setup(value = asset) {
  const onUpdate = vi.fn(), onAdd = vi.fn();
  render(<I18nProvider initial="en"><ProjectIntakeVectors projectId="project" asset={value} note="Keep the totals" onUpdate={onUpdate} onAdd={onAdd} /></I18nProvider>);
  return { onUpdate, onAdd };
}
describe('linked SVG choice', () => {
  it('saves the selected version and explanation without sending a chat message', async () => {
    const { onUpdate, onAdd } = setup();
    vi.mocked(updateIntakeVector).mockResolvedValueOnce({ ...asset, vectorPreference: { versionId: second.id, path: second.path, sha256: second.sha256, reason: 'Clearer column headings', updatedAt: 'now', available: true } });
    expect(screen.getByRole('button', { name: 'Save as preferred' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'View and choose a version' }), { target: { value: second.id } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Why do you prefer this version?' }), { target: { value: 'Clearer column headings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as preferred' }));
    await waitFor(() => expect(updateIntakeVector).toHaveBeenCalledWith('project', 'table', { versionId: second.id, reason: 'Clearer column headings' }, undefined));
    expect(onUpdate).toHaveBeenCalledOnce(); expect(onAdd).not.toHaveBeenCalled();
  });
  it('stages a chosen SVG with the original asset identity, while keeping metadata out of visible text', () => {
    const { onAdd } = setup();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: second.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this SVG to chat' }));
    expect(onAdd).toHaveBeenCalledWith([{ asset, note: 'Keep the totals', attachmentPath: second.path, draftText: 'Use the SVG version “v2.svg” of “Table”.\n\nKeep the totals' }]);
  });
  it('keeps the explanation after a failed save so the user can retry', async () => {
    setup(); vi.mocked(updateIntakeVector).mockRejectedValueOnce(new Error('Save failed'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Why do you prefer this version?' }), { target: { value: 'Readable' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as preferred' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Save failed');
    expect(screen.getByRole('textbox', { name: 'Why do you prefer this version?' })).toHaveValue('Readable');
  });
  it('warns about a changed file, preserves the explanation and allows clearing the preference', async () => {
    setup({ ...asset, vectorPreference: { versionId: 'stale', path: first.path, sha256: 'old', reason: 'Original choice', updatedAt: 'yesterday', available: false } });
    vi.mocked(updateIntakeVector).mockResolvedValueOnce(asset);
    expect(screen.getByText(/preferred file was changed/)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Why do you prefer this version?' })).toHaveValue('Original choice');
    fireEvent.click(screen.getByRole('button', { name: 'Clear preference' }));
    await waitFor(() => expect(updateIntakeVector).toHaveBeenCalledWith('project', 'table', { versionId: null, reason: 'Original choice' }, undefined));
  });
});
