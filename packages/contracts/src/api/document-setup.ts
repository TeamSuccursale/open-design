import { z } from 'zod';
import { DocumentPresentationSchema, DOCUMENT_PRESENTATION_PROMPT } from './document-presentation.js';

export const DOCUMENT_SETUP_PATH = '.melillodesign/document-setup.json';
/** The app's own folder inside a working folder: preparation state, extracted text and the agent's
 *  helper scripts. Nothing under it is ever a deliverable. */
export function isMelilloDesignInternalPath(path: string): boolean {
  const clean = path.replaceAll('\\', '/').replace(/^\.\//, '');
  return clean === '.melillodesign' || clean.startsWith('.melillodesign/');
}
export function documentSetupPath(projectId?: string): string {
  if (!projectId) return DOCUMENT_SETUP_PATH;
  if (projectId.length > 120 || !/^(?!\.{1,2}$)[\w.-]+$/.test(projectId)) throw new Error('Invalid document setup project identity');
  return `.melillodesign/projects/${projectId}/document-setup.json`;
}
export const DocumentLayoutConstraintSchema = z.object({
  id: z.string().min(1).max(120), kind: z.enum(['page-limit', 'paper', 'orientation', 'typography', 'margins', 'template', 'other']),
  value: z.string().trim().min(1).max(2000), status: z.enum(['suggested', 'confirmed', 'conflict']),
  sourceIds: z.array(z.string().min(1).max(120)).max(30),
});
export type DocumentLayoutConstraint = z.infer<typeof DocumentLayoutConstraintSchema>;
export const DocumentEditorialSettingsSchema = z.object({
  documentId: z.string().min(1).max(120).regex(/^(?!\.{1,2}$)[\w.-]+$/), presentation: DocumentPresentationSchema,
  constraints: z.array(DocumentLayoutConstraintSchema).max(80).optional(), pageTarget: z.number().int().positive().max(10_000).optional(),
});
export type DocumentEditorialSettings = z.infer<typeof DocumentEditorialSettingsSchema>;
export const DocumentEditorialSettingsListSchema = z.array(DocumentEditorialSettingsSchema).min(1).max(50).superRefine((entries, context) => {
  if (new Set(entries.map((entry) => entry.documentId)).size !== entries.length) context.addIssue({ code: 'custom', message: 'Each named output needs its own document identity' });
});
export const DocumentSetupIntentSchema = z.object({
  kind: z.enum(['report', 'tender-offer', 'tender-form', 'other', 'free']),
  subtype: z.string().trim().max(240).default(''),
  documentName: z.string().trim().min(1).max(240).optional(),
  purpose: z.string().trim().max(12_000).default(''),
  editorialSettings: DocumentEditorialSettingsListSchema.optional(),
  contextRoots: z.array(z.string().min(1).max(2000)).max(20).default([]),
  imageIntakeConsent: z.boolean().default(false),
  imageIntakeDecision: z.enum(['accepted', 'declined']).optional(),
  contextProjectIds: z.array(z.string().min(1).max(120).regex(/^(?!\.{1,2}$)[\w.-]+$/)).max(10).optional(),
  preparationConversation: z.object({
    requestId: z.string().min(1).max(160), dispatched: z.boolean(),
    blockoutRequestId: z.string().min(1).max(160).optional(), blockoutDispatched: z.boolean().optional(),
    headerFooterRequestId: z.string().min(1).max(160).optional(), headerFooterDispatched: z.boolean().optional(),
    resumeRequestId: z.string().min(1).max(160).optional(), resumeDispatched: z.boolean().optional(),
  }).optional(),
  intakeAnswers: z.object({
    documentPreset: z.string().max(120),
    materialState: z.enum(['ready', 'organize', 'draft', 'unsure']),
    notes: z.string().max(12_000),
  }).optional(),
}).superRefine((intent, ctx) => {
  if (intent.kind !== 'free' && !intent.subtype) ctx.addIssue({ code: 'custom', path: ['subtype'], message: 'Specify the document type' });
  if ((intent.imageIntakeDecision === 'accepted' && !intent.imageIntakeConsent) || (intent.imageIntakeDecision === 'declined' && intent.imageIntakeConsent)) ctx.addIssue({ code: 'custom', path: ['imageIntakeDecision'], message: 'Image intake decision must match explicit consent' });
});
export type DocumentSetupIntent = z.infer<typeof DocumentSetupIntentSchema>;
export const DocumentProjectContextSchema = z.object({ projectId: z.string().min(1).max(120), name: z.string().max(500), workingDirectory: z.string().min(1).max(2000) });
export type DocumentProjectContext = z.infer<typeof DocumentProjectContextSchema>;
export const DocumentProjectReferencesRequestSchema = z.object({ projectIds: z.array(z.string().min(1).max(120).regex(/^(?!\.{1,2}$)[\w.-]+$/)).max(10) });
export const DocumentProjectReferencesResponseSchema = z.object({ references: z.array(DocumentProjectContextSchema).max(10) });
export type DocumentProjectReferencesResponse = z.infer<typeof DocumentProjectReferencesResponseSchema>;
export const DocumentTextContextSchema = z.object({
  title: z.string().max(500), root: z.string().max(2000), sourcePath: z.string().max(2000),
  textPath: z.string().max(2000), pagesRead: z.number().int().nonnegative(), pagesTotal: z.number().int().nonnegative(),
  complete: z.boolean(), truncated: z.boolean(),
});
export type DocumentTextContext = z.infer<typeof DocumentTextContextSchema>;
export const DocumentContextSourceSchema = z.object({
  id: z.string().min(1).max(120), path: z.string().max(2000), root: z.string().max(2000),
  page: z.number().int().positive().optional(), title: z.string().max(500), excerpt: z.string().max(1600),
  readable: z.boolean(), role: z.enum(['rules', 'reference', 'template']).default('reference'),
});
export type DocumentContextSource = z.infer<typeof DocumentContextSourceSchema>;
export const DocumentSetupConfirmationSchema = z.object({
  purpose: z.string().trim().min(1).max(12_000),
  constraints: z.array(DocumentLayoutConstraintSchema).max(80),
  blockoutApproach: z.enum(['manual', 'agent']),
  editorialSettings: DocumentEditorialSettingsListSchema.optional(),
  pageTarget: z.number().int().positive().max(10_000).optional(),
});
export type DocumentSetupConfirmation = z.infer<typeof DocumentSetupConfirmationSchema>;
/** The host confirms the brief the agent already saved, exactly as saved; only the engineer's choice of approach is new. */
export const DocumentSetupSavedBriefConfirmationSchema = z.object({ source: z.literal('saved-brief'), blockoutApproach: z.enum(['manual', 'agent']) });
export type DocumentSetupSavedBriefConfirmation = z.infer<typeof DocumentSetupSavedBriefConfirmationSchema>;

/**
 * The final brief confirmation is a host-owned question form: fixed ids and
 * option values, so the host can record an accepted answer itself and start
 * the next step without an agent turn that only copies the saved brief.
 */
export const DOCUMENT_SETUP_CONFIRMATION_FORM = {
  id: 'document-setup-confirmation', confirmQuestionId: 'confirm-brief', approachQuestionId: 'blockout-approach',
  confirm: { yes: 'yes', no: 'no' }, approach: { agent: 'agent', manual: 'manual' },
} as const;
export function renderDocumentSetupConfirmationForm(): string {
  const form = DOCUMENT_SETUP_CONFIRMATION_FORM;
  // Accepting it saves the brief and seeds every document's pages before the Blockout request starts.
  const body = { lang: 'it', layout: 'grouped', submittingLabel: 'Registro il brief e preparo le pagine…', questions: [
    { id: form.confirmQuestionId, label: 'Confermi il brief così riepilogato?', type: 'radio', required: true, options: [
      { label: 'Sì, confermo il brief', value: form.confirm.yes }, { label: 'No, voglio cambiare qualcosa', value: form.confirm.no }] },
    { id: form.approachQuestionId, label: 'Come impostiamo le pagine?', type: 'radio', required: true, showWhen: { questionId: form.confirmQuestionId, equals: form.confirm.yes }, options: [
      { label: 'Tre strutture complete per ogni documento', value: form.approach.agent }, { label: 'Disegno io i primi blocchi', value: form.approach.manual }] },
  ] };
  return `<question-form id="${form.id}" title="Conferma del brief">\n${JSON.stringify(body)}\n</question-form>`;
}
/** The saved-brief confirmation an answered host form asks for, or null when the agent must handle the answer. */
export function documentSetupConfirmationFromAnswers(formId: string | undefined, answers: Readonly<Record<string, unknown>> | undefined): DocumentSetupSavedBriefConfirmation | null {
  const form = DOCUMENT_SETUP_CONFIRMATION_FORM;
  if (formId !== form.id || answers?.[form.confirmQuestionId] !== form.confirm.yes) return null;
  const approach = answers[form.approachQuestionId];
  return approach === form.approach.agent || approach === form.approach.manual ? { source: 'saved-brief', blockoutApproach: approach } : null;
}
export const DocumentContextScanSchema = z.object({ status: z.enum(['not-run', 'complete']), sources: z.array(DocumentContextSourceSchema).max(100),
  constraints: z.array(DocumentLayoutConstraintSchema).max(80), warnings: z.array(z.string().max(2000)).max(100),
  scannedAt: z.string().optional(), coverage: z.string().max(2000).optional(), textDocuments: z.array(DocumentTextContextSchema).max(12).optional() });
export type DocumentContextScan = z.infer<typeof DocumentContextScanSchema>;
export const DocumentSetupSchema = z.object({
  projectId: z.string().min(1).max(120).optional(),
  version: z.literal(1), status: z.enum(['draft', 'review', 'confirmed']), intent: DocumentSetupIntentSchema,
  workingDirectory: z.string().min(1).max(2000),
  projectContexts: z.array(DocumentProjectContextSchema).max(10).optional(),
  scan: DocumentContextScanSchema,
  confirmed: DocumentSetupConfirmationSchema.extend({ confirmedAt: z.string() }).optional(),
  updatedAt: z.string(),
});
export type DocumentSetup = z.infer<typeof DocumentSetupSchema>;
export interface DocumentSetupResponse { setup: DocumentSetup | null }

/** Shared scope policy for preparation and the confirmed graphical handoff. */
export const DOCUMENT_SETUP_DELIVERABLE_SCOPE = [
  DOCUMENT_PRESENTATION_PROMPT,
  'SCOPE DEFAULTS: when the supplied instructions request complementary report and graphical outputs, do not preselect deferral of the second output merely because the wizard started with Report. Offer the complete source-supported scope first, with an explicit initial/default value matching the known request; the engineer can choose a narrower scope deliberately. The visible selected options and the submitted grouped answers must agree.',
  'DELIVERABLE SCOPE: within the criterion or document scope the engineer is actually preparing, consult the relevant source rows, headings, notes and counting exceptions, then inventory EVERY distinct required deliverable by name with its own page allowance, paper, orientation, typography/template rules and file/page evidence before asking which work to undertake. Do not expand a criterion-specific setup into an inventory of unrelated criteria. A written report and graphical sheets can be complementary required outputs, not alternative formats; treat them as alternatives only when the source explicitly says so.',
  'Explain all discovered outputs before offering written, graphical or both as the scope of this work. Keep the engineer’s choice separate from the source obligation: an unselected output is deferred or outside this work, not deleted from the requirements. If a previous answer selected only one output without acknowledging the others, explain the omitted obligation and ask whether the engineer wants to keep that narrower scope or include the other output.',
  'Bind every constraint to its named deliverable in the constraint value and source IDs. Never transfer a report’s font, line spacing, page cap or paper to graphical sheets without supporting evidence. Different output formats or caps are not a single global conflict, and their allowances must not be added into one uniform-format page count.',
  'When both outputs are selected, preserve separate document briefs, output folders and Blockout editor documents, each with its own format and budget. Persist the complete named output inventory and selected/deferred scope in intent purpose/intakeAnswers.notes, and structured confirmed per-output presentation, constraints and pageTarget in editorialSettings. The setup confirmation seeds each selected named document independently; empty initialization pages do not complete the structural proposals.',
  'In the final chat choice, call the agent option "Tre strutture complete per ogni documento" (or its localized equivalent) and explain that each alternative contains all pages of that named document. Do not use an ambiguous "per ciascuno" without its object, or imply that three alternatives are generated separately for every individual page. A Blockout is the empty functional arrangement of the complete document, before actual body content and graphic refinement.',
  'GENERATION COMPLETION: in agent-proposal mode, generate EVERY selected output whose settings the engineer has confirmed before ending the Blockout run. Create each output as a separate named editor document/catalog entry with its own source allowance, chosen target, paper/orientation and complete A/B/C page sequences; verify every required workspace and proposal through the normal Blockout capability. A second selected/confirmed output is remaining work in this same run, not a deferred brief. Only the engineer’s explicit choice to postpone or exclude an output makes it deferred; do not generate deliberately deferred outputs. If a selected output still has unresolved settings, ask a focused grouped clarification instead of silently postponing it. Never claim that one seeded document completes a multi-document request or flatten several briefs into one.',
].join('\n');

/** Visible first chat request; detailed preparation state is supplied privately. */
export function buildDocumentSetupPreparationPrompt(setup: DocumentSetup): string {
  const label = { report: 'la relazione', 'tender-offer': 'l’offerta di gara', 'tender-form': 'il modulo di gara', other: 'il documento', free: 'il documento libero' }[setup.intent.kind];
  return `Vorrei preparare ${label} nella cartella scelta. Controlla i documenti e guidami nelle scelte necessarie prima di impostare le pagine.`;
}

/** Exact generated request, shared so the UI can disclose its full instructions on demand. */
export const DOCUMENT_BLOCKOUT_PROPOSALS_PROMPT = 'Il contesto è confermato. Prepara tre proposte parallele di struttura per ciascun elaborato selezionato con impostazioni già confermate. Usa blocchi vuoti che descrivono funzione, gerarchia e contenuti attesi, secondo il tipo di documento e il numero di pagine: non riempirli con immagini del progetto, testi integrali o tabelle reali. Puoi leggere un breve campione di testo per capire il documento. Prevedi eventuali figure, note, sfondi o filigrane come segnaposto spiegati. L’inventario delle immagini può proseguire separatamente e non blocca questa fase. Rispetta per ciascun elaborato il nome e le scelte editoriali confermate in editorialSettings: testata, piè di pagina, copertina, conteggio della copertina nel limite e numerazione visibile o meno. Se queste scelte mancano, chiedile in chat prima di procedere. Salva ogni elaborato come documento distinto nell’editor, con i propri limiti, formato e pagine navigabili, e completa tutti gli elaborati selezionati prima di concludere. Lascia in sospeso soltanto quelli che ho esplicitamente rinviato. Mostrami il confronto delle strutture e attendi la mia scelta e l’accettazione esplicita prima di sviluppare la grafica con i contenuti reali.';

/** Human-facing request; confirmed constraints are supplied separately as private context. */
export function buildDocumentSetupStartPrompt(setup: DocumentSetup): string {
  if (setup.status !== 'confirmed' || !setup.confirmed) throw new Error('Confirm the document context first');
  const recurring = (setup.intent?.editorialSettings ?? setup.confirmed.editorialSettings)?.filter((setting) => (setting.presentation.header === true || setting.presentation.footer === true) && !setting.presentation.headerFooter) ?? [];
  if (recurring.length) return `Il contesto è confermato. Prima del Blockout delle pagine prepariamo intestazione e piè di pagina per: ${recurring.map((setting) => setting.presentation.name).join('; ')}. Se non ti ho ancora detto cosa devono contenere o se servono loghi, chiedimelo in un solo modulo raggruppato; altrimenti proponi subito la grafica reale per tutti questi documenti, validala e fermati: la rivedo e la approvo nell’editor dedicato, che si apre sulla tua proposta. Le proposte delle pagine partiranno dopo l’applicazione; conserva il brief e le scelte già confermate.`;
  return setup.confirmed.blockoutApproach === 'manual'
    ? 'Il contesto del documento è confermato. Imposterò la struttura nell’editor Blockout; attendi le mie modifiche prima di proporre la grafica.'
    : DOCUMENT_BLOCKOUT_PROPOSALS_PROMPT;
}
