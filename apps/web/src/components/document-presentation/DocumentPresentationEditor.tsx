import { useId, useState } from 'react';
import { DocumentPresentationSchema, documentPresentationMissingChoices, documentPresentationPageState, type DocumentPresentation } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import styles from './DocumentPresentationEditor.module.css';

export interface DocumentPresentationEditorProps {
  value: DocumentPresentation;
  onChange: (value: DocumentPresentation) => void;
  disabled?: boolean;
  hideConfirmationAction?: boolean;
}
const copy = {
  en: {
    title: 'Document presentation', name: 'Document name', header: 'Header', footer: 'Footer', cover: 'Cover page', pageNumbers: 'Page numbers',
    unknown: 'Choose…', yes: 'Yes', no: 'No', coverTitle: 'How the cover is counted',
    coverCountsTowardPageLimit: 'Include the cover in the page limit?', numberOnCover: 'Print a number on the cover?', coverCountsInNumbering: 'Does the cover advance the numbering sequence?',
    coverHint: 'A hidden cover number can still advance the sequence. This choice is separate from the page limit.', numberingStart: 'First number in the sequence', numberingExample: 'The first page after the cover will show {number}.',
    confirm: 'Confirm these settings', confirmed: 'Editorial choices confirmed', draft: 'Choices to confirm', incomplete: 'Choices to complete', unsaved: 'Choices not saved yet', chromeHint: 'Header and footer reserve space on the page. Their text and style will be defined with Codex during graphic design.', invalid: 'Name the document and answer each visible question. A printed cover number must belong to the numbering sequence.',
    source: 'Formatting rules prescribed by the source documents still apply. Resolve any conflicting choice in chat before continuing.',
  },
  it: {
    title: 'Presentazione del documento', name: 'Nome del documento', header: 'Intestazione', footer: 'Piè di pagina', cover: 'Copertina', pageNumbers: 'Numeri di pagina',
    unknown: 'Scegli…', yes: 'Sì', no: 'No', coverTitle: 'Come contare la copertina',
    coverCountsTowardPageLimit: 'La copertina rientra nel limite di pagine?', numberOnCover: 'Mostrare il numero sulla copertina?', coverCountsInNumbering: 'La copertina fa avanzare la numerazione?',
    coverHint: 'Il numero può restare nascosto e far avanzare la sequenza. Questa scelta è distinta dal limite di pagine.', numberingStart: 'Primo numero della sequenza', numberingExample: 'La prima pagina dopo la copertina mostrerà il numero {number}.',
    confirm: 'Conferma queste impostazioni', confirmed: 'Scelte editoriali confermate', draft: 'Scelte da confermare', incomplete: 'Scelte da completare', unsaved: 'Scelte non ancora salvate', chromeHint: 'Intestazione e piè di pagina riservano spazio nella pagina. Testi e stile si definiranno con Codex nella fase grafica.', invalid: 'Dai un nome al documento e rispondi alle domande visibili. Un numero stampato sulla copertina deve appartenere alla sequenza.',
    source: 'Restano valide le regole di formato prescritte dai documenti di riferimento. Chiarisci in chat eventuali scelte in conflitto prima di proseguire.',
  },
};
type Choice = 'header' | 'footer' | 'cover' | 'pageNumbers' | 'numberOnCover' | 'coverCountsTowardPageLimit' | 'coverCountsInNumbering';

/** Controlled editor for an existing named document; initial setup stays in chat. */
export function DocumentPresentationEditor({ value, onChange, disabled = false, hideConfirmationAction = false }: DocumentPresentationEditorProps) {
  const { locale } = useI18n(), c = copy[locale === 'it' ? 'it' : 'en'], id = useId();
  const [invalid, setInvalid] = useState(false);
  const update = (patch: Partial<DocumentPresentation>) => {
    const { confirmedAt: _confirmedAt, ...next } = value;
    setInvalid(false); onChange({ ...next, ...patch, status: 'draft' });
  };
  const choose = (key: Choice) => <label className={styles.choice} key={key}>
    <span>{c[key]}</span>
    <select disabled={disabled} value={value[key] === null ? '' : value[key] ? 'yes' : 'no'} onChange={(event) => update({ [key]: event.target.value === '' ? null : event.target.value === 'yes' })}>
      <option value="">{c.unknown}</option><option value="yes">{c.yes}</option><option value="no">{c.no}</option>
    </select>
  </label>;
  const confirm = () => {
    const result = DocumentPresentationSchema.safeParse({ ...value, status: 'confirmed', confirmedAt: new Date().toISOString() });
    setInvalid(!result.success); if (result.success) onChange(result.data);
  };
  return <section className={styles.editor} aria-labelledby={`${id}-title`}>
    <div className={styles.heading}><h3 id={`${id}-title`}>{c.title}</h3><span role="status">{value.status === 'confirmed' ? c.confirmed : documentPresentationMissingChoices(value).length ? c.incomplete : hideConfirmationAction ? c.unsaved : c.draft}</span></div>
    <label className={styles.name}><span>{c.name}</span><input disabled={disabled} value={value.name} maxLength={240} onChange={(event) => update({ name: event.target.value })} /></label>
    <div className={styles.grid}>{(['header', 'footer', 'cover', 'pageNumbers'] as const).map(choose)}</div>
    <p className={styles.source}>{c.chromeHint}</p>
    {value.cover === true && <fieldset className={styles.cover}><legend>{c.coverTitle}</legend>
      {choose('coverCountsTowardPageLimit')}
      {value.pageNumbers === true && <>{choose('numberOnCover')}{choose('coverCountsInNumbering')}<p>{c.coverHint}</p></>}
    </fieldset>}
    {value.pageNumbers === true && <label className={styles.number}><span>{c.numberingStart}</span><input type="number" min={1} max={10000} disabled={disabled} value={value.numberingStart} onChange={(event) => { const number = Number(event.target.value); if (Number.isInteger(number) && number > 0 && number <= 10000) update({ numberingStart: number }); }} /></label>}
    {value.pageNumbers === true && value.cover === true && value.coverCountsInNumbering !== null && <p className={styles.source}>{c.numberingExample.replace('{number}', String(documentPresentationPageState(value, { index: 1, role: 'body' }).visibleNumber))}</p>}
    <p className={styles.source}>{c.source}</p>
    {invalid && <p className={styles.error} role="alert">{c.invalid}</p>}
    {!hideConfirmationAction && <button className={styles.confirm} type="button" disabled={disabled || value.status === 'confirmed'} onClick={confirm}>{c.confirm}</button>}
  </section>;
}
