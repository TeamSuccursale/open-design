import { describe, expect, it } from 'vitest';
import { headerFooterRequestDisplay } from '../../../src/runtime/chat/header-footer-request-display';
const tail = 'Non generare il Blockout del corpo delle pagine finché questo passaggio non è applicato.';
describe('header/footer editor request display', () => {
  it.each(['Proponi la struttura', 'Sviluppa la grafica effettiva'])('recognizes the complete generated %s request with the actual document name', (verb) => {
    const content = `${verb} dell’intestazione e del piè di pagina del documento Relazione B.1. Usa il modello design-123 e la sua bozza salvata, le indicazioni e soltanto i loghi pertinenti del progetto. Altre istruzioni. ${tail}`;
    expect(headerFooterRequestDisplay(content)).toEqual({ action: verb === 'Proponi la struttura' ? 'propose' : 'refine', name: 'Relazione B.1' });
  });
  it.each(['Please prepare a header and footer.', 'Sviluppa la grafica effettiva dell’intestazione e del piè di pagina del documento Relazione B.', `Quoted request:\nProponi la struttura ${tail}`])('does not summarize ordinary or incomplete user text', (content) => {
    expect(headerFooterRequestDisplay(content)).toBeNull();
  });
});
