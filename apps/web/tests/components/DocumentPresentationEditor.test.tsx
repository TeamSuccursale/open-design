// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentPresentation, type DocumentPresentation } from '@open-design/contracts';
import { DocumentPresentationEditor } from '../../src/components/document-presentation/DocumentPresentationEditor';
import { I18nProvider } from '../../src/i18n';

afterEach(cleanup);
function setup(initial = createDocumentPresentation('Relazione B')) {
  const changed = vi.fn();
  function Host() { const [value, setValue] = useState(initial); return <I18nProvider initial="en"><DocumentPresentationEditor value={value} onChange={(next) => { changed(next); setValue(next); }} /></I18nProvider>; }
  const view = render(<Host />); return { ...view, changed };
}
const choose = (name: string, value: string) => fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } });
describe('document presentation editor', () => {
  it('never converts unanswered choices into defaults and validates explicit confirmation', () => {
    const { changed } = setup();
    expect((screen.getByRole('combobox', { name: 'Header' }) as HTMLSelectElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm these settings' }));
    expect(screen.getByRole('alert')).toBeTruthy(); expect(changed).not.toHaveBeenCalled();
    for (const name of ['Header', 'Footer', 'Cover page', 'Page numbers']) choose(name, 'no');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm these settings' }));
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'confirmed', cover: false, pageNumbers: false });
  });
  it('keeps the page allowance separate from a hidden cover number that advances the sequence', () => {
    const { changed } = setup();
    for (const name of ['Header', 'Footer']) choose(name, 'no');
    choose('Cover page', 'yes'); choose('Page numbers', 'yes');
    choose('Include the cover in the page limit?', 'no'); choose('Print a number on the cover?', 'no');
    choose('Does the cover advance the numbering sequence?', 'yes');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm these settings' }));
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'confirmed', coverCountsTowardPageLimit: false, numberOnCover: false, coverCountsInNumbering: true });
  });
  it('marks edited settings as draft while preserving independent cover decisions', () => {
    const initial: DocumentPresentation = { ...createDocumentPresentation('Relazione B'), status: 'confirmed', header: true, footer: false, cover: true, pageNumbers: true, numberOnCover: false, coverCountsTowardPageLimit: false, coverCountsInNumbering: true, confirmedAt: 'now' };
    const { changed } = setup(initial); choose('Header', 'no');
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'draft', coverCountsTowardPageLimit: false, coverCountsInNumbering: true });
    expect(changed.mock.calls.at(-1)?.[0].confirmedAt).toBeUndefined();
  });
});
