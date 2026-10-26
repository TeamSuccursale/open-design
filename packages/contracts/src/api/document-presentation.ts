import { z } from 'zod';
import { AppliedHeaderFooterSchema } from './header-footer-presentation.js';

const choice = z.boolean().nullable().default(null);
const fields = {
  version: z.literal(1).default(1), status: z.enum(['draft', 'confirmed']).default('draft'), name: z.string().trim().max(240).default(''),
  header: choice, footer: choice, cover: choice, pageNumbers: choice, numberOnCover: choice,
  coverCountsTowardPageLimit: choice, coverCountsInNumbering: choice,
  numberingStart: z.number().int().positive().max(10_000).default(1), confirmedAt: z.string().optional(),
  headerFooter: AppliedHeaderFooterSchema.optional(),
};
export type DocumentPresentationChoice = 'name' | 'header' | 'footer' | 'cover' | 'pageNumbers' | 'numberOnCover' | 'coverCountsTowardPageLimit' | 'coverCountsInNumbering';
export function documentPresentationMissingChoices(value: z.infer<z.ZodObject<typeof fields>>): DocumentPresentationChoice[] {
  const missing: DocumentPresentationChoice[] = value.name.trim() ? [] : ['name'];
  for (const key of ['header', 'footer', 'cover', 'pageNumbers'] as const) if (value[key] === null) missing.push(key);
  if (value.cover === true) {
    if (value.coverCountsTowardPageLimit === null) missing.push('coverCountsTowardPageLimit');
    if (value.pageNumbers === true) for (const key of ['numberOnCover', 'coverCountsInNumbering'] as const) if (value[key] === null) missing.push(key);
  }
  return missing;
}
export const DocumentPresentationSchema = z.object(fields).superRefine((value, context) => {
  if (value.status !== 'confirmed') return;
  for (const key of documentPresentationMissingChoices(value)) context.addIssue({ code: 'custom', path: [key], message: 'Confirm this editorial choice explicitly' });
  if (value.cover === true && value.pageNumbers === true && value.numberOnCover === true && value.coverCountsInNumbering === false) context.addIssue({ code: 'custom', path: ['coverCountsInNumbering'], message: 'A printed cover number must belong to the numbering sequence' });
});
export type DocumentPresentation = z.infer<typeof DocumentPresentationSchema>;
/** Draft defaults never turn an unanswered question into a yes/no decision. */
export function createDocumentPresentation(name = ''): DocumentPresentation { return DocumentPresentationSchema.parse({ name }); }

export function documentPresentationPageState(presentation: DocumentPresentation | undefined, page: { index: number; role?: string }) {
  const isCover = presentation?.cover === true && page.index === 0 || page.role === 'cover' && presentation?.cover !== false;
  const countsTowardPageLimit = isCover ? presentation?.coverCountsTowardPageLimit ?? null : true;
  let sequenceNumber: number | null = null;
  if (presentation?.pageNumbers === true) {
    if (isCover) sequenceNumber = presentation.coverCountsInNumbering === true ? presentation.numberingStart : null;
    else if (presentation.cover !== true || presentation.coverCountsInNumbering !== null) sequenceNumber = presentation.numberingStart + page.index - (presentation.cover === true && presentation.coverCountsInNumbering === false ? 1 : 0);
  }
  return { isCover, header: presentation?.header ?? null, footer: presentation?.footer ?? null, countsTowardPageLimit, sequenceNumber,
    visibleNumber: isCover && presentation?.numberOnCover !== true ? null : sequenceNumber };
}

export const DOCUMENT_PRESENTATION_GROUPING_PROMPT = 'Keep each named output’s related editorial choices together: include its conditional cover-counting and numbering controls in the same grouped form as its header/footer/cover choices when relevant. For conditional cover controls use showWhen:{questionId:"cover-question-id",equals:"yes"} (or equals:true for a switch), matching the controlling question’s exact answer value. Hidden controls are neither required nor submitted. Do not ask cover-dependent questions when cover was already explicitly declined. This document-specific group may contain up to ten related controls; do not split it solely to meet a generic discovery question cap. Reuse the answers already given and include source-supported values once in the final summary instead of asking the same count or orientation twice. Ordinary font, spacing and margin choices without a source prescription or stated user preference are graphical decisions for the designer; propose them rather than adding another setup interview.';
export const DOCUMENT_PRESENTATION_PROMPT = [
  'EDITORIAL SETUP PER NAMED OUTPUT: before final confirmation, ask the engineer to name EACH selected document and explicitly choose header yes/no, footer yes/no, cover yes/no and page numbering yes/no. Use related grouped question-form fields in chat; keep the folder/type wizard unchanged. Do not merge a report and graphical booklet into one editorial configuration.',
  DOCUMENT_PRESENTATION_GROUPING_PROMPT,
  'If that document has a cover, ask separately whether it counts toward its source page limit. If it also has page numbering, ask whether to print the cover number and whether the cover advances the numbering sequence even when its number is hidden. Hidden numbering and exclusion from the page limit are independent decisions: do not infer either from the other. A printed cover number belongs to the sequence; clarify a contradictory answer instead of silently correcting it.',
  'Use nullable booleans for unresolved editorial choices and status:"draft" until the engineer answers; never default unanswered choices to yes/no. Save each named output in editorialSettings:[{documentId,presentation,constraints?,pageTarget?}], with stable document IDs, that output’s own applicable source constraints and explicit page target. presentation fields are {version:1,status:"draft"|"confirmed",name,header,footer,cover,pageNumbers,numberOnCover,coverCountsTowardPageLimit,coverCountsInNumbering,numberingStart:1}. Source-prescribed editorial rules remain binding source findings: cite them and ask about any conflict with the user’s preference, without silently replacing or transferring them.',
  'When the engineer confirms the final per-output brief, persist presentation.status:"confirmed" for every selected named output and include the complete editorialSettings in document-setup confirm. A final confirmation with missing editorial choices must not be reported as complete. Reuse saved answers; ask only unresolved questions. A named output’s 8 A4 report pages and another output’s 4 A3 graphical sheets retain separate limits, targets, cover counts and numbering.',
].join('\n');
