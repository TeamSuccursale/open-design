import type { DocumentSetup } from '@open-design/contracts';

/** Resume from saved answers; a retired chat form is never the workflow authority. */
export function buildDocumentPreparationResumePrompt(setup: DocumentSetup): string {
  const documents = (setup.intent.editorialSettings ?? []).map((setting) => setting.presentation.name).filter(Boolean);
  return `Riprendiamo la preparazione${documents.length ? ` di ${documents.map((name) => `«${name}»`).join(' e ')}` : ' del documento'} dal brief e dalle risposte già salvate. Conserva le scelte di formato, pagine, copertina e numerazione, e le intestazioni e i piè di pagina già applicati. Non farmi rispondere di nuovo alle scelte completate e non rimandarmi a una vecchia domanda della chat. Se manca soltanto la conferma finale, mostrami il riepilogo aggiornato e chiedimi in una nuova domanda se confermo il brief e voglio tre strutture complete per ogni documento oppure disegnare i blocchi. Se manca ancora una scelta necessaria, chiedi soltanto quella. Non confermare al posto mio e non generare pagine prima della mia risposta.`;
}

export function hasPendingHeaderFooter(setup: DocumentSetup): boolean {
  return (setup.intent.editorialSettings ?? setup.confirmed?.editorialSettings ?? []).some((setting) =>
    (setting.presentation.header === true || setting.presentation.footer === true) && !setting.presentation.headerFooter);
}
