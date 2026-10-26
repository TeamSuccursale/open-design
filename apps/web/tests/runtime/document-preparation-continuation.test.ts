import { describe, expect, it } from 'vitest';
import type { DocumentSetup } from '@open-design/contracts';
import { buildDocumentPreparationResumePrompt, hasPendingHeaderFooter } from '../../src/runtime/document-preparation-continuation';

describe('saved preparation continuation', () => {
  it('requests fresh explicit consent, preserving previous answers rather than treating header/footer approval as brief approval', () => {
    const setup = { intent: { editorialSettings: [{ presentation: { name: 'Relazione B', header: true } }, { presentation: { name: 'Tavole B', footer: true, headerFooter: {} } }] } } as unknown as DocumentSetup;
    const prompt = buildDocumentPreparationResumePrompt(setup);
    expect(prompt).toContain('«Relazione B» e «Tavole B»');
    expect(prompt).toContain('Non confermare al posto mio');
    expect(prompt).toContain('nuova domanda');
    expect(hasPendingHeaderFooter(setup)).toBe(true);
    setup.intent.editorialSettings![0]!.presentation.header = false;
    expect(hasPendingHeaderFooter(setup)).toBe(false);
  });
});
