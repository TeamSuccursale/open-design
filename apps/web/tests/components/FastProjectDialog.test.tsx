// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import { FastProjectDialog } from '../../src/components/FastProjectDialog';
import { LOCAL_REQUEST_TIMEOUT_MS } from '../../src/runtime/request-deadline';

afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('named Fast projects', () => {
  it('opens on a required editable project name with a sensible localized default', () => {
    render(<I18nProvider initial="it"><FastProjectDialog onCancel={vi.fn()} onConfirm={vi.fn()} /></I18nProvider>);
    const name = screen.getByLabelText('Nome del progetto') as HTMLInputElement;
    expect(name.value).toBe('Progetto rapido'); expect(name.required).toBe(true); expect(document.activeElement).toBe(name);
    expect(name.selectionStart).toBe(0); expect(name.selectionEnd).toBe(name.value.length);
    fireEvent.change(name, { target: { value: '   ' } }); expect((screen.getByRole('button', { name: 'Crea e avvia la chat' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps the explicit project name, goal and selected files after failure and retries with the same draft', async () => {
    const onConfirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<I18nProvider initial="it"><FastProjectDialog onCancel={vi.fn()} onConfirm={onConfirm} /></I18nProvider>);
    const name = screen.getByLabelText('Nome del progetto') as HTMLInputElement;
    fireEvent.change(name, { target: { value: '  Antro — Studio grafico  ' } });
    fireEvent.change(screen.getByLabelText('Che cosa vuoi realizzare? (facoltativo)'), { target: { value: 'Una relazione chiamata Relazione B.' } });
    const file = new File(['prepared'], 'loghi.zip', { type: 'application/zip' }); fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Crea e avvia la chat' })); await screen.findByRole('alert');
    expect(name.value).toBe('  Antro — Studio grafico  '); expect(screen.getByText('loghi.zip')).toBeTruthy();
    expect(onConfirm).toHaveBeenCalledWith({ name: 'Antro — Studio grafico', prompt: 'Una relazione chiamata Relazione B.', files: [file] });
    fireEvent.click(screen.getByRole('button', { name: 'Crea e avvia la chat' })); await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2)); expect(onConfirm.mock.calls[1]![0]).toEqual(onConfirm.mock.calls[0]![0]);
  });
  it('offers continued observation after a slow create without replaying it or discarding files', async () => {
    let finish!: (value: boolean) => void;
    const onConfirm = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const onCancel = vi.fn();
    render(<I18nProvider initial="it"><FastProjectDialog onCancel={onCancel} onConfirm={onConfirm} /></I18nProvider>);
    const file = new File(['logo'], 'loghi.zip');
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [file] } });
    vi.useFakeTimers(); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Crea e avvia la chat' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(LOCAL_REQUEST_TIMEOUT_MS); });
    fireEvent.click(screen.getByRole('button', { name: 'Continua ad attendere' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(LOCAL_REQUEST_TIMEOUT_MS); });
    expect(onConfirm).toHaveBeenCalledOnce(); expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByText('loghi.zip')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Annulla' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(false); });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Crea e avvia la chat' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
