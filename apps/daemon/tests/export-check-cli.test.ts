import { describe, expect, it } from 'vitest';

import { assessDocumentRules, type DocumentLayoutMeasurement } from '@open-design/contracts';
import { formatDocumentRuleCheck } from '../src/export-check-cli.js';

// A finding the measurement could not tie to a Blockout block or to any text still says what kind of thing crossed
// the margin, so the engineer knows what to look for on the page.
describe('od export check text', () => {
  it('names an unlabeled finding by what it is', () => {
    const measurement: DocumentLayoutMeasurement = { documentId: null, unreadStylesheets: 0, pages: [{ index: 1, widthMm: 210, heightMm: 297, fonts: [],
      margins: { bottom: { mm: 8, kind: 'image', text: '' } } }] };
    const check = assessDocumentRules({ fileName: 'a.html', measurement, sources: [],
      constraints: [{ id: 'm', kind: 'margins', value: 'Margini di 20 mm', status: 'confirmed', sourceIds: [] }] });
    expect(formatDocumentRuleCheck(check)).toContain('page 1 bottom 8 mm, expected at least 20 mm (image)');
  });
});
