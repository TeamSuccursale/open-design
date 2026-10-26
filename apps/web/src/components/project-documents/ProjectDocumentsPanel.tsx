import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Input, Select } from '@open-design/components';
import { createDocumentPresentation, DocumentPresentationSchema, projectDocumentForConversation, type CreateProjectDocumentRequest, type DocumentPresentation, type ProjectDocument, type WorkspaceCollabContext } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { openFolderDialog } from '../../providers/registry';
import { createProjectDocument, openProjectDocument, updateProjectDocument } from '../../providers/project-documents';
import { Icon } from '../Icon';
import { DocumentPresentationEditor } from '../document-presentation/DocumentPresentationEditor';
import { useProjectDocuments } from './useProjectDocuments';
import styles from './ProjectDocumentsPanel.module.css';

const it = {
  title: 'Documenti del progetto', intro: 'Ogni documento o design ha un nome, una conversazione e una cartella di lavoro. Le cartelle possono trovarsi in posizioni diverse.',
  project: 'Progetto', close: 'Chiudi documenti', add: 'Aggiungi documento o design', name: 'Nome', nameHint: 'Per esempio: Relazione descrittiva B', needsOwner: 'L’autore deve aprire questo documento una prima volta per preparare la sua conversazione. I file restano consultabili.',
  kind: 'Che cosa vuoi creare?', document: 'Documento tecnico', design: 'Design libero', type: 'Tipo di documento', report: 'Relazione', boards: 'Elaborato grafico / tavole', offer: 'Offerta di gara', form: 'Modulo di gara', other: 'Altro documento', free: 'Documento libero',
  folder: 'Dove lavoriamo?', managed: 'Crea una cartella per questo documento', linked: 'Collega una cartella esistente', folderHint: 'Il collegamento mantiene i file nella loro cartella. Puoi riutilizzare materiali da altri documenti con @ nella chat.',
  path: 'Cartella del documento', browse: 'Scegli cartella', create: 'Crea e apri', cancel: 'Annulla', save: 'Salva modifiche', saving: 'Salvataggio…', open: 'Apri documento', resume: 'Continua il brief', preparing: 'Brief da completare', rename: 'Rinomina',
  empty: 'Qui raccogli i documenti e i design del progetto. Aggiungi il primo per iniziare.', loading: 'Caricamento dei documenti…', loadError: 'Non è stato possibile leggere i documenti. Riprova.', retry: 'Riprova', refresh: 'Aggiorna elenco',
  registering: 'Preparazione del primo documento', registeringHint: 'Codex sta lavorando alla richiesta nella chat. Il documento comparirà qui appena sarà registrato.', backToChat: 'Torna alla chat',
  waitingAnswer: 'Completa la preparazione nella chat', waitingAnswerHint: 'Codex attende la tua risposta prima di creare il primo documento.',
  creating: 'Documento in preparazione', resumeCreation: 'Riprendi la creazione', creatingHint: 'Riprendi questo documento: verranno conservati la stessa cartella e la stessa chat.',
  error: 'Non è stato possibile completare l’operazione. Controlla il nome e la cartella, poi riprova.', unavailable: 'Cartella non disponibile', available: 'Cartella collegata', own: 'Cartella del documento',
  active: 'Documento aperto', settings: 'Intestazione, copertina e numerazione', settingsHint: 'Salva aggiorna il brief e lo schema dei blocchi di pagina (Blockout) di questo documento. Per adattare le pagine grafiche già prodotte, chiedilo a Codex in chat.',
  saved: 'Impostazioni salvate nel documento.', remove: 'Rimuovi dal progetto', confirmRemove: 'Rimuovere il collegamento a questo documento? I suoi file restano nella cartella.', removeNow: 'Rimuovi collegamento',
  removed: 'Elementi rimossi', restore: 'Ricollega al progetto', linkedFiles: 'I file restano nella cartella collegata.', pending: 'In chat Codex ti chiederà formato, pagine, intestazione, piè di pagina, copertina e numerazione.', readOnly: 'Accesso in sola lettura', choicesError: 'Rispondi a tutte le scelte visibili prima di salvare. La copertina con numero deve far avanzare la numerazione.',
} as const;
const en: Record<keyof typeof it, string> = {
  title:'Project documents', intro:'Each document or design has a name, a conversation and a working folder. Folders can be in different locations.', project:'Project', close:'Close documents', add:'Add document or design', name:'Name', nameHint:'For example: Criterion B report', needsOwner:'The author needs to open this document once to prepare its conversation. Its files remain readable.',
  kind:'What are you creating?',document:'Technical document',design:'Free design',type:'Document type',report:'Report',boards:'Graphic boards / booklet',offer:'Tender offer',form:'Tender form',other:'Other document',free:'Free document',
  folder:'Where will you work?',managed:'Create a folder for this document',linked:'Link an existing folder',folderHint:'Linking keeps files in their folder. Reference other project documents with @ in chat.',path:'Document folder',browse:'Choose folder',create:'Create and open',cancel:'Cancel',save:'Save changes',saving:'Saving…',open:'Open document',resume:'Continue the brief',preparing:'Brief in preparation',rename:'Rename',
  empty:'Collect this project’s documents and designs here. Add the first one to begin.',loading:'Loading documents…',loadError:'Documents could not load. Retry.',retry:'Retry',refresh:'Refresh list',error:'The operation could not finish. Check the name and folder, then retry.',unavailable:'Folder unavailable',available:'Linked folder',own:'Document folder',active:'Open document',
  registering:'Preparing the first document',registeringHint:'Codex is working on your chat request. The document will appear here once registered.',backToChat:'Back to chat',
  waitingAnswer:'Complete preparation in chat',waitingAnswerHint:'Codex is waiting for your answer before creating the first document.',
  creating:'Document preparation in progress',resumeCreation:'Resume creation',creatingHint:'Resume this document using the same folder and conversation.',
  settings:'Header, cover and page numbering',settingsHint:'Save updates this document’s brief and page-block plan (Blockout). To adapt graphic pages already produced, ask Codex in chat.',saved:'Document settings saved.',remove:'Remove from project',confirmRemove:'Remove the link to this document? Its files stay in their folder.',removeNow:'Remove link',removed:'Removed items',restore:'Link back to project',linkedFiles:'Files stay in the linked folder.',pending:'In chat, Codex will ask about format, page count, header, footer, cover and numbering.',readOnly:'Read-only access',choicesError:'Answer every visible choice before saving. A numbered cover must advance the numbering sequence.',
};
type Mode = { kind: 'create' } | { kind: 'rename' | 'settings'; document: ProjectDocument } | null;
const needsPreparation = (document: ProjectDocument) => document.kind === 'document' && document.workspaceProjectId === document.projectId && document.presentation?.status !== 'confirmed' && Boolean(document.preparationConversationIds?.length);

export function ProjectDocumentsPanel({ projectId, projectName, activeDocumentId, workspaceContext, readOnly = false, initialPreparationRunning = false, initialPreparationAwaitingAnswer = false, onClose, onOpen }: {
  projectId: string; projectName: string; activeDocumentId?: string | null; workspaceContext?: WorkspaceCollabContext | null; readOnly?: boolean; initialPreparationRunning?: boolean; initialPreparationAwaitingAnswer?: boolean;
  onClose: () => void; onOpen: (document: ProjectDocument) => Promise<void>;
}) {
  const { locale } = useI18n(), c = locale === 'it' ? it : en;
  const library = useProjectDocuments(projectId, workspaceContext);
  const [mode, setMode] = useState<Mode>(null), [name, setName] = useState(''), [kind, setKind] = useState<'document' | 'design'>('document');
  const [documentType, setDocumentType] = useState<'report' | 'tender-offer' | 'tender-form' | 'other' | 'free' | 'boards'>('report');
  const [location, setLocation] = useState<'managed' | 'linked'>('managed'), [folder, setFolder] = useState('');
  const [presentation, setPresentation] = useState<DocumentPresentation>(() => createDocumentPresentation());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [removeId, setRemoveId] = useState<string | null>(null);
  const documents = library.documents.filter((item) => !item.archivedAt), archived = library.documents.filter((item) => item.archivedAt);
  const pendingCreations = library.pendingCreations ?? [];
  const createRequest = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const createdDocument = useRef<ProjectDocument | null>(null);
  const awaitingFirstDocument = (initialPreparationRunning || initialPreparationAwaitingAnswer) && !library.documents.length;
  useEffect(() => {
    if ((!awaitingFirstDocument && !pendingCreations.length) || library.loading) return;
    const timer = setInterval(library.refresh, 3_000);
    return () => clearInterval(timer);
  }, [awaitingFirstDocument, pendingCreations.length, library.loading, library.refresh]);
  const previousPreparationRunning = useRef(initialPreparationRunning);
  useEffect(() => {
    if (previousPreparationRunning.current && !initialPreparationRunning) library.refresh();
    previousPreparationRunning.current = initialPreparationRunning;
  }, [initialPreparationRunning, library.refresh]);
  const settingsUnchanged = mode?.kind === 'settings' && presentation.status === 'confirmed'
    && JSON.stringify(presentation) === JSON.stringify(mode.document.presentation);
  function edit(value: Mode) {
    setMode(value); setError(''); setNotice(''); setRemoveId(null);
    if (value?.kind === 'create') { createRequest.current = null; createdDocument.current = null; }
    setName(value && value.kind !== 'create' ? value.document.name : '');
    if (value?.kind === 'settings') setPresentation(value.document.presentation ?? createDocumentPresentation(value.document.name));
  }
  async function chooseFolder() {
    setError('');
    try { const selected = await openFolderDialog({ throwOnError: true }); if (selected) setFolder(selected); }
    catch { setError(c.error); }
  }
  async function open(document: ProjectDocument) {
    if (readOnly && projectDocumentForConversation(library.documents, document.workspaceProjectId, document.conversationIds[0])?.id !== document.id) { setError(c.needsOwner); return; }
    setBusy(true); setError('');
    try {
      const opened = readOnly ? document : await openProjectDocument(projectId, document.id, workspaceContext);
      // Until the collection brief is confirmed, return to its live preparation
      // conversation instead of an empty editing chat with only generated assets.
      const preparationId = needsPreparation(document) && document.preparationConversationIds?.[0];
      await onOpen(preparationId ? { ...opened, entryFile: undefined, conversationIds: [preparationId] } : opened);
      onClose();
    }
    catch { setError(c.error); } finally { setBusy(false); }
  }
  async function save() {
    if (!mode || readOnly || busy || settingsUnchanged) return;
    let confirmedPresentation = presentation;
    if (mode.kind === 'settings') {
      const parsed = DocumentPresentationSchema.safeParse({ ...presentation, status:'confirmed', confirmedAt:new Date().toISOString() });
      if (!parsed.success) { setError(c.choicesError); return; }
      confirmedPresentation = parsed.data;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode.kind === 'create') {
        const subtype = { boards:c.boards,report:c.report,'tender-offer':c.offer,'tender-form':c.form,other:c.other,free:c.free }[documentType];
        const input: CreateProjectDocumentRequest = { name:name.trim(),kind,select:true,
          location:location === 'managed' ? { mode:'managed' } : { mode:'link-existing',path:folder.trim(),authorized:true },
          ...(kind === 'document' ? { presentation:createDocumentPresentation(name.trim()),documentType:{kind:documentType === 'boards' ? 'other' : documentType,subtype} } : {}),
        };
        const fingerprint = JSON.stringify(input);
        if (createRequest.current?.fingerprint !== fingerprint) { createRequest.current = { fingerprint, requestId: crypto.randomUUID() }; createdDocument.current = null; }
        // Opening can fail after creation has committed. Keep the returned
        // document and retry opening it rather than submitting another create.
        const document = createdDocument.current ?? await createProjectDocument(projectId, { ...input, requestId: createRequest.current.requestId }, workspaceContext);
        createdDocument.current = document;
        await onOpen(document); onClose();
      } else {
        await updateProjectDocument(projectId, mode.document.id, mode.kind === 'rename' ? { name:name.trim() } : { presentation:confirmedPresentation }, workspaceContext);
        setMode(null); setNotice(c.saved); library.refresh();
      }
    } catch { setError(c.error); library.refresh(); } finally { setBusy(false); }
  }
  async function resumeCreation(request: CreateProjectDocumentRequest) {
    if (busy || readOnly) return;
    setBusy(true); setError('');
    try { const document = await createProjectDocument(projectId, request, workspaceContext); await onOpen(document); onClose(); }
    catch { setError(c.error); library.refresh(); } finally { setBusy(false); }
  }
  async function archive(document: ProjectDocument, archived: boolean) {
    setBusy(true); setError('');
    try { await updateProjectDocument(projectId,document.id,{archived},workspaceContext); setRemoveId(null); library.refresh(); }
    catch { setError(c.error); } finally { setBusy(false); }
  }
  return <Dialog ariaLabel={c.title} onClose={onClose} className={styles.panel} backdropClassName={styles.backdrop}>
    <header className={styles.header}><div><h2>{c.title}</h2><p>{projectName}</p></div><Button variant="ghost" aria-label={c.close} onClick={onClose}><Icon name="close" size={18}/></Button></header>
    <div className={styles.body}>
      <p className={styles.intro}>{c.intro}</p>
      {readOnly && <p>{c.readOnly}</p>}
      {error && <p role="alert" className={styles.message}>{error}</p>}{notice && <p role="status" className={styles.message}>{notice}</p>}
      {!mode && <>
        <div className={styles.toolbar}><Button variant="primary" disabled={readOnly || busy || awaitingFirstDocument || library.loading || library.error || pendingCreations.length > 0} onClick={() => edit({kind:'create'})}><Icon name="plus" size={16}/>{c.add}</Button><Button variant="ghost" disabled={library.loading} onClick={library.refresh}><Icon name="refresh" size={16}/>{library.error ? c.retry : c.refresh}</Button></div>
        {library.loading && <p role="status">{c.loading}</p>}{library.error && <p role="alert">{c.loadError}</p>}
        {pendingCreations.map((pending) => <div key={pending.requestId} className={styles.empty} role="status"><strong>{c.creating} · {pending.name}</strong><p>{c.creatingHint}</p><Button variant="secondary" disabled={readOnly || busy} onClick={() => void resumeCreation(pending.request)}>{c.resumeCreation}</Button></div>)}
        {awaitingFirstDocument && <div className={styles.empty} role="status"><Icon name="file" size={28}/><strong>{initialPreparationRunning ? c.registering : c.waitingAnswer}</strong><p>{initialPreparationRunning ? c.registeringHint : c.waitingAnswerHint}</p><Button variant="secondary" onClick={onClose}>{c.backToChat}</Button></div>}
        {!awaitingFirstDocument && !pendingCreations.length && !library.loading && !library.error && !documents.length && <div className={styles.empty}><Icon name="folder" size={28}/><p>{c.empty}</p></div>}
        {(['document','design'] as const).map((group) => documents.some((item) => item.kind === group) && <section key={group} className={styles.group}><h3>{group === 'document' ? c.document : c.design}</h3><ul>{documents.filter((item) => item.kind === group).map((document) => <li key={document.id} data-active={activeDocumentId === document.id || undefined}>
          <div className={styles.row}><div className={styles.identity}><Icon name={document.kind === 'document' ? 'file' : 'palette'} size={20}/><div><h4>{document.name}</h4><p>{needsPreparation(document) ? c.preparing : document.availability === 'available' ? document.folderMode === 'linked' ? c.available : c.own : c.unavailable}{activeDocumentId === document.id ? ` · ${c.active}` : ''}</p></div></div><Button variant="secondary" disabled={busy || document.availability !== 'available'} onClick={() => void open(document)}>{needsPreparation(document) ? c.resume : c.open}<Icon name="arrow-right" size={14}/></Button></div>
          <details className={styles.folder}><summary>{c.path}</summary><p>{document.workingDirectory}</p><p>{c.linkedFiles}</p></details>
          <div className={styles.rowActions}><Button variant="ghost" disabled={readOnly || busy} onClick={() => edit({kind:'rename',document})}>{c.rename}</Button>{document.kind === 'document' && <Button variant="ghost" disabled={readOnly || busy} onClick={() => edit({kind:'settings',document})}>{c.settings}</Button>}<Button variant="ghost" disabled={readOnly || busy} onClick={() => setRemoveId(document.id)}>{c.remove}</Button></div>
          {removeId === document.id && <div className={styles.confirm}><p>{c.confirmRemove}</p><Button variant="ghost" onClick={() => setRemoveId(null)}>{c.cancel}</Button><Button variant="secondary" disabled={busy} onClick={() => void archive(document,true)}>{c.removeNow}</Button></div>}
        </li>)}</ul></section>)}
        {archived.length > 0 && <details className={styles.archived}><summary>{c.removed} · {archived.length}</summary>{archived.map((document) => <div key={document.id} className={styles.row}><span>{document.name}</span><Button variant="ghost" disabled={readOnly || busy} onClick={() => void archive(document,false)}>{c.restore}</Button></div>)}</details>}
      </>}
      {mode && <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <h3>{mode.kind === 'create' ? c.add : mode.kind === 'rename' ? c.rename : `${c.settings} · ${mode.document.name}`}</h3>
        {mode.kind !== 'settings' ? <label>{c.name}<Input autoFocus value={name} maxLength={240} placeholder={c.nameHint} onChange={(event) => setName(event.target.value)} disabled={busy}/></label> : <><p>{c.settingsHint}</p><DocumentPresentationEditor hideConfirmationAction value={presentation} onChange={setPresentation} disabled={busy}/></>}
        {mode.kind === 'create' && <>
          <label>{c.kind}<Select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} disabled={busy}><option value="document">{c.document}</option><option value="design">{c.design}</option></Select></label>
          {kind === 'document' && <label>{c.type}<Select value={documentType} onChange={(event) => setDocumentType(event.target.value as typeof documentType)} disabled={busy}>{([['report',c.report],['boards',c.boards],['tender-offer',c.offer],['tender-form',c.form],['other',c.other],['free',c.free]] as const).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</Select></label>}
          <fieldset className={styles.location}><legend>{c.folder}</legend><label><input type="radio" name="doc-location" checked={location === 'managed'} onChange={() => setLocation('managed')} disabled={busy}/>{c.managed}</label><label><input type="radio" name="doc-location" checked={location === 'linked'} onChange={() => setLocation('linked')} disabled={busy}/>{c.linked}</label></fieldset>
          {location === 'linked' && <div className={styles.folderInput}><label>{c.path}<Input value={folder} onChange={(event) => setFolder(event.target.value)} disabled={busy}/></label><Button variant="secondary" disabled={busy} onClick={() => void chooseFolder()}>{c.browse}</Button></div>}
          <p className={styles.hint}>{c.folderHint}</p>{kind === 'document' && <p className={styles.hint}>{c.pending}</p>}
        </>}
        <footer className={styles.formActions}><Button variant="ghost" disabled={busy} onClick={() => edit(null)}>{c.cancel}</Button><Button variant="primary" type="submit" disabled={busy || settingsUnchanged || (mode.kind !== 'settings' && !name.trim()) || (mode.kind === 'create' && location === 'linked' && !folder.trim())}>{busy ? c.saving : mode.kind === 'create' ? c.create : c.save}</Button></footer>
      </form>}
    </div>
  </Dialog>;
}
