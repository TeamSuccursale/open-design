import { Button } from '@open-design/components';
import type { ProjectDocument } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { Icon } from '../Icon';
import styles from './HeaderFooterDocumentEntry.module.css';

export function HeaderFooterDocumentEntry({ documents, onOpen }: { documents: ProjectDocument[]; onOpen: (id: string) => void }) {
  const { locale } = useI18n(), it = locale === 'it';
  const pending = documents.filter((document) => !document.archivedAt && (document.presentation?.header === true || document.presentation?.footer === true) && !document.presentation.headerFooter);
  if (!pending.length) return null;
  return <section className={styles.entry} aria-label={it ? 'Prima delle pagine' : 'Before page planning'}>
    <h3>{it ? 'Prima definiamo intestazione e piè di pagina' : 'First, design the header and footer'}</h3>
    <p>{it ? 'Qui puoi rivedere loghi e indicazioni, confrontare le composizioni e scegliere un modello del progetto. Il Blockout delle pagine viene dopo l’applicazione delle fasce.' : 'Review logos and guidance, compare compositions and choose a project design here. Page Blockout follows after applying the header and footer.'}</p>
    {pending.map((document) => <div className={styles.document} key={document.id}><span><strong>{document.name}</strong><small>{it ? 'Intestazione e piè di pagina non ancora applicati' : 'Header and footer not yet applied'}</small></span><Button variant="secondary" onClick={() => onOpen(document.id)}><Icon name="layout" size={14} />{it ? 'Apri intestazione e piè di pagina' : 'Open header and footer'}</Button></div>)}
  </section>;
}
