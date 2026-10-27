import { describe, expect, it } from 'vitest';
import { startupLabel } from '../../src/runtime/startup-label';

describe('startupLabel', () => {
  // The splash renders before the i18n bundle loads and stays up for about 20 s on a first dev start,
  // so an Italian engineer's first screen must not be the only English text in the app.
  it('greets an Italian browser in Italian', () => {
    expect(startupLabel(['it-IT', 'en-US'])).toBe('Avvio di MelilloDesign…');
  });
  it('falls back to English for every other language', () => {
    expect(startupLabel(['de-DE'])).toBe('Loading MelilloDesign…');
    expect(startupLabel([])).toBe('Loading MelilloDesign…');
  });
});
