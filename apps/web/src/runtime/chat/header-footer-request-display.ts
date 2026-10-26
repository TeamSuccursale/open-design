/** Recognize the existing editor-generated request only; never change the stored prompt. */
export function headerFooterRequestDisplay(content: string): { action: 'propose' | 'refine'; name: string } | null {
  const match = /^(Proponi la struttura|Sviluppa la grafica effettiva) dell’intestazione e del piè di pagina del documento ([^\n]{1,240})\. Usa il modello [a-zA-Z0-9_-]+ e la sua bozza salvata, le indicazioni e soltanto i loghi pertinenti del progetto\. /u.exec(content);
  if (!match || !content.includes('Non generare il Blockout del corpo delle pagine finché questo passaggio non è applicato.')) return null;
  return { action: match[1] === 'Proponi la struttura' ? 'propose' : 'refine', name: match[2]! };
}
