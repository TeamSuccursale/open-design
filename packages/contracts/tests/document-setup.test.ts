import { describe, expect, it } from 'vitest';
import { DocumentProjectReferencesRequestSchema, DocumentSetupConfirmationSchema, DocumentSetupIntentSchema, buildDocumentSetupPreparationPrompt, buildDocumentSetupStartPrompt, type DocumentSetup } from '../src/api/document-setup.js';

describe('document start contract', () => {
  it('requires specific report, offer, form and other types before starting', () => {
    for (const kind of ['report', 'tender-offer', 'tender-form', 'other']) {
      expect(DocumentSetupIntentSchema.safeParse({ kind }).success).toBe(false);
      expect(DocumentSetupIntentSchema.parse({ kind, subtype: '  Descriptive report  ' }).subtype).toBe('Descriptive report');
    }
    expect(DocumentSetupIntentSchema.parse({ kind: 'free' })).toMatchObject({ subtype: '', contextRoots: [], imageIntakeConsent: false });
  });
  it('accepts a distinct trimmed first-document name without inventing one for legacy projects', () => {
    expect(DocumentSetupIntentSchema.parse({ kind: 'report', subtype: 'Technical report', documentName: '  Relazione descrittiva B  ' }).documentName).toBe('Relazione descrittiva B');
    expect(DocumentSetupIntentSchema.parse({ kind: 'free' }).documentName).toBeUndefined();
    for (const documentName of ['', '  ', 'x'.repeat(241)]) expect(DocumentSetupIntentSchema.safeParse({ kind: 'free', documentName }).success).toBe(false);
  });
  it('never starts an unconfirmed context and keeps manual and agent starts distinct', () => {
    const setup = { status: 'draft' } as DocumentSetup;
    expect(() => buildDocumentSetupStartPrompt(setup)).toThrow('Confirm');
    const confirmed = { ...setup, status: 'confirmed', confirmed: { blockoutApproach: 'agent' } } as DocumentSetup;
    expect(buildDocumentSetupStartPrompt(confirmed)).toContain('tre proposte parallele');
    const withHeader = { ...confirmed, intent: { editorialSettings: [{ documentId: 'report', presentation: { name: 'Relazione B', header: true, footer: true } }] } } as unknown as DocumentSetup;
    expect(buildDocumentSetupStartPrompt(withHeader)).toContain('Prima del Blockout delle pagine');
    expect(buildDocumentSetupStartPrompt(withHeader)).toContain('Relazione B');
    expect(buildDocumentSetupStartPrompt(withHeader)).not.toContain('tre proposte parallele');
    expect(buildDocumentSetupStartPrompt(confirmed)).toContain('per ciascun elaborato selezionato');
    expect(buildDocumentSetupStartPrompt(confirmed)).toContain('completa tutti gli elaborati selezionati');
    expect(buildDocumentSetupStartPrompt(confirmed)).toContain('esplicitamente rinviato');
    confirmed.confirmed!.blockoutApproach = 'manual';
    expect(buildDocumentSetupStartPrompt(confirmed)).toContain('attendi le mie modifiche');
    expect(buildDocumentSetupStartPrompt(confirmed)).not.toContain('json');
  });
  it('keeps an optional integer page target separate from the confirmed source constraints', () => {
    const confirmation = { purpose: 'Graphic document', constraints: [], blockoutApproach: 'manual' };
    expect(DocumentSetupConfirmationSchema.parse(confirmation).pageTarget).toBeUndefined();
    expect(DocumentSetupConfirmationSchema.parse({ ...confirmation, pageTarget: 3 }).pageTarget).toBe(3);
    for (const pageTarget of [0, -1, 3.5, '3', 10_001]) expect(DocumentSetupConfirmationSchema.safeParse({ ...confirmation, pageTarget }).success).toBe(false);
  });
  it('accepts optional preset intake answers without changing legacy JSON', () => {
    const legacy = { kind: 'report', subtype: 'Relazione illustrativa', purpose: 'Presentare il progetto' };
    expect(DocumentSetupIntentSchema.parse(legacy).intakeAnswers).toBeUndefined();
    const intakeAnswers = { documentPreset: 'illustrative-report', materialState: 'organize', notes: 'Testi già scritti, figure da scegliere.' };
    expect(DocumentSetupIntentSchema.parse({ ...legacy, intakeAnswers }).intakeAnswers).toEqual(intakeAnswers);
    expect(DocumentSetupIntentSchema.safeParse({ ...legacy, intakeAnswers: { ...intakeAnswers, materialState: 'invent-technical-content' } }).success).toBe(false);
    expect(DocumentSetupIntentSchema.safeParse({ ...legacy, intakeAnswers: { ...intakeAnswers, documentPreset: 'x'.repeat(121) } }).success).toBe(false);
    expect(DocumentSetupIntentSchema.safeParse({ ...legacy, intakeAnswers: { ...intakeAnswers, notes: 'x'.repeat(12_001) } }).success).toBe(false);
  });
  it('distinguishes an unanswered image question from an explicit decline and accepts project IDs rather than folder paths', () => {
    const base = { kind: 'free' };
    expect(DocumentSetupIntentSchema.parse(base).imageIntakeDecision).toBeUndefined();
    expect(DocumentSetupIntentSchema.parse({ ...base, imageIntakeConsent: false, imageIntakeDecision: 'declined' }).imageIntakeDecision).toBe('declined');
    expect(DocumentSetupIntentSchema.parse({ ...base, imageIntakeConsent: true }).imageIntakeConsent).toBe(true);
    expect(DocumentSetupIntentSchema.safeParse({ ...base, imageIntakeConsent: true, imageIntakeDecision: 'declined' }).success).toBe(false);
    expect(DocumentProjectReferencesRequestSchema.parse({ projectIds: ['project-123'] }).projectIds).toEqual(['project-123']);
    expect(DocumentProjectReferencesRequestSchema.safeParse({ projectIds: ['C:/private/folder'] }).success).toBe(false);
    expect(DocumentProjectReferencesRequestSchema.safeParse({ projectIds: ['..'] }).success).toBe(false);
  });
  it('keeps preparation dispatch identities optional and gives the agent a conversational first request', () => {
    const legacy = DocumentSetupIntentSchema.parse({ kind: 'free' });
    expect(legacy.preparationConversation).toBeUndefined();
    const marker = { requestId: 'prepare-123', dispatched: false, blockoutRequestId: 'blockout-123', blockoutDispatched: false };
    expect(DocumentSetupIntentSchema.parse({ kind: 'free', preparationConversation: marker }).preparationConversation).toEqual(marker);
    expect(DocumentSetupIntentSchema.safeParse({ kind: 'free', preparationConversation: { requestId: '', dispatched: false } }).success).toBe(false);
    const prompt = buildDocumentSetupPreparationPrompt({ intent: { ...legacy, kind: 'tender-offer' } } as DocumentSetup);
    expect(prompt).toContain('l’offerta di gara');
    expect(prompt.length).toBeLessThan(250);
    expect(prompt.match(/[.!?](?:\s|$)/g)).toHaveLength(2);
    expect(prompt).toContain('cartella scelta');
    expect(prompt).toContain('guidami nelle scelte necessarie');
    expect(prompt).not.toMatch(/editorialSettings|question-form|3–6|header|footer|JSON/);
  });
});
