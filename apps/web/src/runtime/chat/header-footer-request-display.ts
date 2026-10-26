/** Recognize the existing editor-generated request only; never change the stored prompt.
 * "Proponi la struttura" is the earlier wording, kept so older transcripts still read well. */
export function headerFooterRequestDisplay(content: string): { action: 'propose' | 'refine'; name: string } | null {
  const match = /^(Proponi la grafica|Proponi la struttura|Sviluppa la grafica effettiva) dell’intestazione e del piè di pagina del documento ([^\n]{1,240})\. Usa il modello [a-zA-Z0-9_-]+ e la sua bozza salvata, le indicazioni e soltanto i loghi pertinenti del progetto\. /u.exec(content);
  if (!match || !content.includes('Non generare il Blockout del corpo delle pagine finché questo passaggio non è applicato.')) return null;
  return { action: match[1] === 'Sviluppa la grafica effettiva' ? 'refine' : 'propose', name: match[2]! };
}
