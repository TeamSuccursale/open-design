/** SVG work has a per-turn quality floor, independent of the saved chat model. */
export const SVG_DEFAULT_MODEL = 'gpt-6.1-sol';

export interface SvgExecutionPolicy {
  model: string;
  reasoning: 'xhigh' | 'max' | 'ultra';
  complexity: 'standard' | 'complex';
}

export interface SvgExecutionInput {
  agentId?: string | null;
  prompt: string;
  attachments?: readonly string[];
  model?: string | null;
  reasoning?: string | null;
  previousPolicy?: SvgExecutionPolicy | null;
}

/** Route from the latest user turn and selected files, never the whole transcript. */
export function resolveSvgExecutionPolicy(input: SvgExecutionInput): SvgExecutionPolicy | null {
  if (input.agentId !== 'codex') return null;
  const prompt = input.prompt.toLocaleLowerCase();
  const attachments = input.attachments ?? [];
  const hasSvgFile = attachments.some((file) => /\.svg$/i.test(file));
  const mentionsVector = /\bsvg\b|vettorial|vector(?:ial|i[sz](?:e|ation))/.test(prompt);
  const requestsWork = /creat|generat|build|make|draw|render|produc|rework|reconstruct|trac(?:e|ing)|edit|fix|repair|refin|improv|convert|vectori[sz]|disegn|realizz|rielabor|ricostr|tracci|modific|corregg|miglior|propon|prepar|fammi|rifa|rendi/.test(prompt);
  const explicitSvgWork = hasSvgFile || (mentionsVector && requestsWork);
  const changesOutput = !mentionsVector && /\b(?:html|website|webpage|app|report|document|pdf|png|jpe?g|pptx|docx|xlsx)\b|sito\s+web|relazione|documento/.test(prompt);
  const continuingSvgWork = !explicitSvgWork && !changesOutput && Boolean(input.previousPolicy);
  if (!explicitSvgWork && !continuingSvgWork) return null;

  // Reconstructing an extracted figure is conservatively complex. A clean,
  // newly authored icon can start at XHigh; maps and fidelity work start at Max.
  const complex = (continuingSvgWork && input.previousPolicy?.complexity === 'complex')
    || attachments.some((file) => /(?:^|[\\/])intake-assets[\\/]/i.test(file))
    || /planimetr|key\s?map|floor\s?plan|cartograf|\bmap(?:pa|pe|s)?\b|dettagl|detail|fedel|faithful|accurat|precision|ricostr|reconstruct|tracc|trac(?:e|ing)|compless|complex|dens[eo]|raster|\bpdf\b/.test(prompt);
  const selectedModel = input.model?.trim() ?? '';
  const previousModel = continuingSvgWork ? input.previousPolicy?.model ?? '' : '';
  const model = previousModel.includes('-astra') && !selectedModel.includes('-astra') ? previousModel : selectedModel;
  const atLeastSol = /^(?:[^/]+\/)?gpt-6(?:\.\d+)?-(?:sol|astra)(?:-.+)?$/.test(model);
  const previousEffort = continuingSvgWork ? input.previousPolicy?.reasoning : null;
  const reasoning = input.reasoning === 'ultra' || previousEffort === 'ultra' ? 'ultra'
    : complex || input.reasoning === 'max' || previousEffort === 'max' ? 'max' : 'xhigh';
  return { model: atLeastSol ? model : SVG_DEFAULT_MODEL, reasoning, complexity: complex ? 'complex' : 'standard' };
}
