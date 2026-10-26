import type { HeaderFooterWorkspaceResponse } from '@open-design/contracts';

/** Idempotency identity follows applied state, not a modal click or its draft version. */
export function headerFooterContinuationKey(projectId: string, documentId: string, workspace: HeaderFooterWorkspaceResponse | undefined): string | null {
  const binding = workspace?.bindings.find((item) => item.documentId === documentId);
  if (binding?.status !== 'applied' || !binding.snapshot || !binding.appliedRevision) return null;
  return `${projectId}:${documentId}:${binding.setId ?? 'independent'}:${binding.appliedRevision}`;
}

export function buildFastHeaderFooterContinuationPrompt(documentName: string): string {
  return `Intestazione e piè di pagina di «${documentName}» sono stati applicati e approvati nell’editor. Riprendi la richiesta di documento già confermata in questa chat, usando il binding pubblicato, le scelte editoriali e il contesto salvato. Non ripetere l’intervista, l’approvazione delle fasce o l’intake. Se la richiesta comprendeva il Blockout del corpo, prosegui con quello: blocchi funzionali vuoti e modificabili, nel formato e numero di pagine già richiesti, senza inventare contenuti tecnici o riempirli con immagini reali. Se era stata richiesta soltanto intestazione e piè di pagina, conferma la conclusione senza creare pagine o altri elaborati.`;
}
