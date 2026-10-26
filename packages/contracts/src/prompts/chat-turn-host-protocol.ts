import { renderArtifactFocusInstruction } from '../api/artifact-focus-marker.js';
import { renderDoneMarker } from '../api/done-marker.js';
import { renderOdNextProductionReadyInstructions } from './od-next-production-marker.js';
import { renderNextStepMarkerExample } from '../api/next-step-marker.js';
import {
  PROMPT_LOCALE_EXEMPT_TERMS_SENTENCE,
  normalizePromptLocale,
  promptLanguageName,
} from './ui-locale.js';

/**
 * `od_next_confirmed_request` is the request turn of a run the host itself
 * dispatched after the engineer accepted a saved brief in a host form. That
 * acceptance is the plan approval, so the request turn produces directly and
 * carries the production protocols; no planning turn or marker precedes it.
 */
/**
 * The planning rules sit in the cached prompt head, which cannot know whether a
 * turn is a confirmed-brief dispatch. Every rule that requires a planning turn
 * carries this sentence verbatim, so the per-turn gate below does not contradict
 * it: the OD Next recipe imports it, and tests hold the core and orchestration
 * assets to the same words.
 */
export const OD_NEXT_CONFIRMED_BRIEF_EXCEPTION = "Exception: when this turn's host protocol is headed Confirmed-brief production, the engineer has already accepted the brief and its approach in a host form. That acceptance takes the place of the planning turn: produce in this turn and emit no production-ready marker.";

export type ChatTurnHostProtocolPolicy =
  | 'ordinary'
  | 'od_next_request'
  | 'od_next_confirmed_request'
  | 'od_next_production';

export interface ChatTurnHostProtocolInstructions {
  doneMarker: string;
  nextSteps: string;
  artifactFocus: string;
  text: string;
}

function odNextStageGate(policy: ChatTurnHostProtocolPolicy): string {
  if (policy === 'od_next_request') {
    return [
      'OD Next host handoff gate:',
      'Use the three keyed host protocols below only when this request-stage response declares route=direct_edit, inputStage=request, and outcome=completed.',
      'For full_plan, plan_ready, clarification_required, blocked, failed, or canceled responses, omit all three protocols.',
    ].join('\n');
  }
  if (policy === 'od_next_confirmed_request') {
    return [
      'Confirmed-brief production:',
      'The engineer accepted the saved brief and its Blockout approach in the host confirmation form, and the host dispatched this request itself. That acceptance authorizes production: this request turn is the production turn.',
      'Do not write a separate planning response, do not ask to confirm the plan, and do not end with an od-production-ready line; no further production turn follows this one.',
      'Produce the requested deliverables now with the loaded Skills and documented tools, then describe the files actually produced and any remaining gaps in prose. If an essential answer is missing, ask it through a question-form.',
      'Use the three keyed host protocols below when the requested work is done and the actual deliverables have been written.',
      'If work is blocked, failed, canceled, or awaiting an essential answer, omit all three protocols.',
    ].join('\n');
  }
  if (policy === 'od_next_production') {
    return [
      'OD Next host handoff gate:',
      'Use the three keyed host protocols below when the requested work is done and the actual deliverables have been written.',
      'If work is blocked, failed, canceled, or awaiting an essential answer, omit all three protocols. Describe any remaining gaps in normal prose; no structured state declaration is required.',
    ].join('\n');
  }
  return '';
}

/**
 * The output-language rule for the three follow-up suggestions.
 *
 * The suggestions are user-visible chat prose — clicking one sends it verbatim
 * as the user's next message — so they follow the run's UI locale like every
 * other user-visible string. Two things make this rule need its own sentence
 * here rather than inheriting the one in `# UI locale override`:
 *
 *  · That section rides the cache-stable prompt head, which `server.ts` drops
 *    on every resume turn to protect the upstream prompt cache. This block is
 *    re-sent every turn because of its nonce. Inheriting would mean the rule
 *    is present exactly on the turns that need it least.
 *  · That section ends with "Keep machine-readable ids and object option
 *    `value` fields exact and unlocalized" — scoped to `<question-form>`, but
 *    a marker whose suggestion also travels in a `value="…"` attribute reads
 *    like it is covered. Saying "user-visible chat prose" here settles it.
 *
 * With no locale (or an English one) this returns the original
 * infer-from-context wording, byte for byte: the fix is "follow the run's
 * locale", not "always write another language".
 */
function nextStepLanguageRule(locale: string | undefined): string {
  const normalized = normalizePromptLocale(locale);
  if (!normalized) {
    return 'Write them in the language the user is speaking, and keep each under 120 characters.';
  }
  return [
    `Write all three in ${promptLanguageName(normalized)}: the OpenDesign UI locale for this`
    + ` run is \`${normalized}\`, and these three lines are user-visible chat prose, not`
    + ' machine-readable values. The markers above show the marker format only, not the'
    + ' output language.',
    PROMPT_LOCALE_EXEMPT_TERMS_SENTENCE,
    'Keep each under 120 characters.',
  ].join('\n');
}

/**
 * Render the keyed, per-turn protocol that hands a completed model turn back to
 * the chat host. The nonce keeps this text out of every cache-stable prompt
 * head; callers inject it into the request/continuation slice only.
 *
 * `locale` is the run's UI locale (`ChatRequest.locale`). Callers that have it
 * must pass it; see `nextStepLanguageRule` for why this block restates a rule
 * the stable prompt head already carries.
 */
export function renderChatTurnHostProtocolInstructions(
  key: string,
  policy: ChatTurnHostProtocolPolicy = 'ordinary',
  locale?: string | undefined,
): ChatTurnHostProtocolInstructions {
  if (policy === 'od_next_request') {
    return { doneMarker: '', nextSteps: '', artifactFocus: '', text: renderOdNextProductionReadyInstructions(key) };
  }
  if (!key) {
    return { doneMarker: '', nextSteps: '', artifactFocus: '', text: '' };
  }

  const doneMarker = [
    'Turn completion marker:',
    `This turn's key is ${key}.`,
    'When you finish working and are about to write the part the user actually reads — your answer, summary, or delivery note — emit exactly one marker immediately before it:',
    renderDoneMarker(key),
    'Everything before the marker is filed as working narration into a collapsed execution log; everything after it is shown to the user directly. Emit it at most once, and only when the work is done.',
    'The key is different every turn: copy the one above verbatim, never reuse an earlier one, and never invent one.',
    'Skip the marker when you are ending the turn with a <question-form> or an <artifact> block — those already close the working phase on their own.',
    'The marker is protocol, not prose: do not mention it, do not explain it, and do not wrap it in a code fence (a fenced marker is deliberately ignored).',
  ].join('\n');
  const nextSteps = [
    'Follow-up suggestions:',
    'As the very last thing in this turn — after your summary, delivery note, or <artifact> block — emit exactly three self-closing follow-up markers:',
    renderNextStepMarkerExample(key, [
      'Add an orders list page',
      'Switch the product cards to a two-column layout',
      'Add a dark mode',
    ]),
    'Rules: exactly three markers, one suggestion in each value attribute, no bullets, no numbering, no trailing punctuation, and no paired opening/closing tag.',
    'Each line is a concrete next action on what THIS turn actually produced, worded so the user could send it verbatim as their next message — not a topic, not a question, not an offer of help.',
    nextStepLanguageRule(locale),
    `This turn's key is ${key}: copy it verbatim, never reuse an earlier one, and never invent one.`,
    'Skip all three markers when the turn produced nothing to iterate on — a greeting, a plain answer, a turn ending in a <question-form> — or when you have no useful suggestion. Omitting them is fine; padding them with filler is not.',
    'The markers are protocol, not prose: do not mention them, do not explain them, and do not wrap them in a code fence.',
  ].join('\n');
  const artifactFocus = renderArtifactFocusInstruction(key);
  const text = [
    odNextStageGate(policy),
    doneMarker,
    nextSteps,
    artifactFocus,
  ].filter(Boolean).join('\n\n---\n\n');

  return { doneMarker, nextSteps, artifactFocus, text };
}
