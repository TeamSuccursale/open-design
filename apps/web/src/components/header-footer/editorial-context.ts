import { documentPresentationPageState, type DocumentPresentation } from '@open-design/contracts';

export function recurringBrief(presentation: DocumentPresentation | undefined, projectName: string | undefined, totalPages: number | undefined, italian: boolean): string[] {
  const c = (it: string, en: string) => italian ? it : en;
  return [projectName ? `${c('Progetto', 'Project')}: ${projectName}` : '', presentation?.name ? `${c('Documento', 'Document')}: ${presentation.name}` : '',
    totalPages ? `${c('Pagine', 'Pages')}: ${totalPages}` : '',
    presentation?.cover === true ? c('Copertina prevista', 'Cover included') : presentation?.cover === false ? c('Senza copertina', 'No cover') : '',
    presentation?.pageNumbers === true ? `${c('Numerazione da', 'Numbering starts at')} ${presentation.numberingStart}${presentation.cover === true ? presentation.numberOnCover === false ? c(' · numero nascosto in copertina', ' · cover number hidden') : presentation.numberOnCover === true ? c(' · copertina numerata', ' · cover numbered') : '' : ''}` : presentation?.pageNumbers === false ? c('Senza numeri di pagina', 'No page numbers') : '',
    presentation?.cover === true && presentation.pageNumbers === true && presentation.coverCountsInNumbering === false ? c('La copertina non fa avanzare la numerazione', 'Cover does not advance numbering') : '',
  ].filter(Boolean);
}

export function recurringPreviewPages(presentation: DocumentPresentation | undefined, totalPages: number | undefined, italian: boolean) {
  const count = Math.max(1, Math.min(10_000, totalPages ?? (presentation?.cover === true ? 2 : 1)));
  return Array.from({ length: count }, (_, index) => {
    const state = documentPresentationPageState(presentation, { index });
    const name = state.isCover ? italian ? 'Copertina' : 'Cover' : totalPages ? `${italian ? 'Pagina' : 'Page'} ${index + 1}` : italian ? 'Pagina campione' : 'Sample page';
    const number = presentation?.pageNumbers == null ? italian ? 'numerazione da confermare' : 'numbering unconfirmed' : state.visibleNumber === null ? italian ? 'senza numero' : 'no number' : `${italian ? 'numero' : 'number'} ${state.visibleNumber}`;
    return { index, ...state, label: `${name} · ${number}` };
  });
}
