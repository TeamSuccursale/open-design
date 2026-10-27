// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider, useI18n, type Locale } from '../../src/i18n';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
});

// Excalidraw writes its own language onto <html> when it mounts: the hidden sketch prewarm left an Italian
// workspace marked lang="en" (the spellchecker then flags every Italian word) and would turn an Arabic one
// left-to-right. The page language belongs to the app locale, whatever a library writes there.
describe('the document language', () => {
  it('follows the app locale after a library overwrites it', async () => {
    render(<I18nProvider initial="it"><span /></I18nProvider>);
    expect(document.documentElement.getAttribute('lang')).toBe('it');
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    await waitFor(() => expect(document.documentElement.getAttribute('lang')).toBe('it'));
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('keeps an Arabic page right-to-left', async () => {
    render(<I18nProvider initial="ar"><span /></I18nProvider>);
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    await waitFor(() => expect(document.documentElement.getAttribute('dir')).toBe('rtl'));
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
  });

  it('still lets the user switch language', async () => {
    let setLocale: ((next: Locale) => void) | null = null;
    function Handle() {
      setLocale = useI18n().setLocale;
      return null;
    }
    render(<I18nProvider initial="it"><Handle /></I18nProvider>);
    act(() => setLocale?.('fa'));
    await waitFor(() => expect(document.documentElement.getAttribute('lang')).toBe('fa'));
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });
});
