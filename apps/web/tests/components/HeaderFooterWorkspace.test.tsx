// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeaderFooterSet, HeaderFooterWorkspaceResponse } from '@open-design/contracts';
import { createDocumentPresentation } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { HeaderFooterWorkspace } from '../../src/components/header-footer/HeaderFooterWorkspace';

const mocks = vi.hoisted(() => ({ getHeaderFooterWorkspace: vi.fn(), getHeaderFooterSourceFiles: vi.fn(), importHeaderFooterSources: vi.fn(), retryHeaderFooterUpdates: vi.fn(), createHeaderFooterSet: vi.fn(), saveHeaderFooterDraft: vi.fn(), publishHeaderFooterSet: vi.fn(), applyHeaderFooterSet: vi.fn(), detachHeaderFooterSet: vi.fn(), disableHeaderFooter: vi.fn(), restoreHeaderFooterSet: vi.fn(), searchHeaderFooterLogo: vi.fn(), cancelHeaderFooterSearch: vi.fn(), retryHeaderFooterSearch: vi.fn(), chooseHeaderFooterCandidate: vi.fn(), uploadHeaderFooterFiles: vi.fn(), removeHeaderFooterAsset: vi.fn(), getHeaderFooterVersions: vi.fn(), restoreHeaderFooterDraft: vi.fn() }));
vi.mock('../../src/providers/header-footer', () => mocks);
const time = '2026-10-24T10:00:00.000Z';
function model(id = 'studio'): HeaderFooterSet {
  const variants = [{ id: 'a4', name: 'A4 verticale', pageWidthMm: 210, pageHeightMm: 297, headerHeightMm: 28, footerHeightMm: 20, blocks: [{ id: 'logo', region: 'header' as const, kind: 'logo' as const, x: .08, y: .2, width: .2, height: .5, assetId: 'logo-one', lockedRatio: true }, { id: 'document-name', region: 'footer' as const, kind: 'field' as const, field: 'documentName' as const, x: .1, y: .2, width: .7, height: .5 }] }];
  return { id, name: 'Studio tecnico', draft: { version: 1, name: 'Studio tecnico', guidance: 'Logo a sinistra, titolo nel piè di pagina.', stage: 'structural', variants }, draftVersion: 1, revision: 1, publishedRevision: { id: 1, setId: id, name: 'Studio tecnico', guidance: '', stage: 'graphic', variants, createdAt: time }, archivedAt: null, createdAt: time, updatedAt: time };
}
function workspace(): HeaderFooterWorkspaceResponse {
  const set = model();
  return { projectId: 'project', sets: [set], bindings: [{ documentId: 'report', setId: set.id, followUpdates: true, header: true, footer: true, showOnCover: false, version: 1, appliedRevision: 1, snapshot: set.publishedRevision, status: 'applied', updatedAt: time }], assets: [{ id: 'logo-one', name: 'Logo dello studio', filename: 'logo.svg', mimeType: 'image/svg+xml', sha256: 'a', size: 100, source: 'upload', createdAt: time, url: '/logo.svg' }], searches: [], documents: [{ id: 'report', projectId: 'project', workspaceProjectId: 'project', name: 'Relazione tecnica B', kind: 'document', workingDirectory: '/report', folderMode: 'managed', availability: 'available', conversationIds: [], archivedAt: null, createdAt: time, updatedAt: time }], transactions: [], history: [] };
}
function mount(props: Partial<Parameters<typeof HeaderFooterWorkspace>[0]> = {}) { return render(<I18nProvider initial="it"><HeaderFooterWorkspace projectId="project" documentId="report" onClose={vi.fn()} {...props} /></I18nProvider>); }
beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('Image', class {
    src = ''; fetchPriority = 'auto'; naturalWidth = 120; naturalHeight = 40;
    decode() { return Promise.resolve(); }
    removeAttribute() { this.src = ''; }
  });
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getHeaderFooterSourceFiles.mockResolvedValue({ files: [], truncated: false }); mocks.getHeaderFooterWorkspace.mockResolvedValue(workspace()); mocks.applyHeaderFooterSet.mockResolvedValue(workspace()); mocks.publishHeaderFooterSet.mockResolvedValue(workspace());
  mocks.saveHeaderFooterDraft.mockImplementation(async (_project: string, id: string, input: { draft: HeaderFooterSet['draft']; expectedDraftVersion: number }) => { const next = workspace(); if (!next.sets.some((set) => set.id === id)) next.sets.push(model(id)); next.sets = next.sets.map((set) => set.id === id ? { ...set, draft: input.draft, draftVersion: input.expectedDraftVersion + 1 } : set); return next; });
  mocks.getHeaderFooterVersions.mockResolvedValue({ revisions: [workspace().sets[0]!.publishedRevision], drafts: [] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

let readinessCase = 0;
function graphicWorkspace() {
  const state = workspace(); state.sets[0]!.draft.stage = 'graphic'; state.sets[0]!.publishedRevision = null; state.bindings = [];
  state.assets[0]!.url = `/preview-readiness-${++readinessCase}.svg`;
  state.assets[0]!.sha256 = String(readinessCase);
  return state;
}
function deferredPreviewImages() {
  const images: { ready(): void; fail(): void; src: string }[] = [];
  vi.stubGlobal('Image', class {
    src = ''; fetchPriority = 'auto'; naturalWidth = 120; naturalHeight = 40;
    private resolve!: () => void;
    private reject!: (error: unknown) => void;
    private pending = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    constructor() { images.push(this); }
    decode() { return this.pending; }
    removeAttribute() { this.src = ''; }
    ready() { this.resolve(); }
    fail() { this.reject(new Error('Decode failed')); }
  });
  return images;
}

describe('header and footer logo readiness gate', () => {
  const approval = () => screen.getByLabelText('Ho controllato intestazione e piè di pagina e approvo questa revisione.') as HTMLInputElement;
  const apply = () => screen.getByRole('button', { name: 'Applica intestazione e piè di pagina' }) as HTMLButtonElement;

  it('blocks approval and the publish handler while decode is pending', async () => {
    const state = graphicWorkspace(), images = deferredPreviewImages(); mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount({ startAt: 'editor', setId: 'studio' });
    await screen.findByText('Caricamento dei loghi per l’anteprima…');
    expect(approval()).toBeDisabled(); expect(apply()).toBeDisabled();
    // The handler remains guarded even if a stale caller bypasses the disabled control.
    await act(async () => { apply().disabled = false; fireEvent.click(apply()); });
    apply().disabled = true;
    expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled();
    await act(async () => images[0]!.ready());
    expect(approval()).toBeEnabled(); expect(approval()).not.toBeChecked(); expect(apply()).toBeDisabled();
    fireEvent.click(approval()); expect(apply()).toBeEnabled();
  });

  it('names the failed logo in Italian and retries the actual image before allowing approval', async () => {
    const state = graphicWorkspace(), images = deferredPreviewImages(); mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount({ startAt: 'editor', setId: 'studio' });
    await waitFor(() => expect(images).toHaveLength(1));
    await act(async () => images[0]!.fail());
    expect(screen.getByRole('alert')).toHaveTextContent('Il logo «Logo dello studio» non è stato caricato nell’anteprima. Riprova.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Decode failed');
    expect(approval()).toBeDisabled(); expect(apply()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova caricamento loghi' }));
    expect(images).toHaveLength(2); expect(approval()).toBeDisabled();
    await act(async () => images[1]!.ready());
    expect(approval()).toBeEnabled(); expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(approval()); fireEvent.click(apply());
    await waitFor(() => expect(mocks.publishHeaderFooterSet).toHaveBeenCalledOnce());
  });

  it('invalidates prior approval when Codex saves a new revision and requires a fresh review', async () => {
    const state = graphicWorkspace(), images = deferredPreviewImages(); mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount({ startAt: 'editor', setId: 'studio' });
    await waitFor(() => expect(images).toHaveLength(1)); await act(async () => images[0]!.ready());
    fireEvent.click(approval()); expect(apply()).toBeEnabled();
    const updated = structuredClone(state); updated.sets[0]!.draftVersion += 1; updated.sets[0]!.draft.guidance = 'Nuova revisione'; updated.assets[0]!.url += '?revision=2'; updated.assets[0]!.sha256 += '-2';
    mocks.getHeaderFooterWorkspace.mockResolvedValue(updated);
    await act(async () => { window.dispatchEvent(new CustomEvent('melillodesign:header-footer-updated', { detail: { projectId: 'project' } })); });
    await waitFor(() => expect(images).toHaveLength(2));
    expect(approval()).not.toBeChecked(); expect(approval()).toBeDisabled(); expect(apply()).toBeDisabled();
    await act(async () => images[1]!.ready());
    expect(approval()).toBeEnabled(); expect(approval()).not.toBeChecked(); expect(apply()).toBeDisabled();
    expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled();
  });

  it('blocks a missing logo in a different applied format even when the active preview has a valid logo', async () => {
    const state = graphicWorkspace(), images = deferredPreviewImages();
    const secondFormat = structuredClone(state.sets[0]!.draft.variants[0]!); secondFormat.id = 'a3'; secondFormat.name = 'A3'; secondFormat.pageWidthMm = 297; secondFormat.pageHeightMm = 420; secondFormat.blocks[0]!.assetId = 'missing-logo'; state.sets[0]!.draft.variants.push(secondFormat);
    mocks.getHeaderFooterWorkspace.mockResolvedValue(state); mount({ startAt: 'editor', setId: 'studio' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Il logo «missing-logo» non è disponibile.');
    expect(images).toHaveLength(0); expect(approval()).toBeDisabled(); expect(apply()).toBeDisabled();
    await act(async () => { apply().disabled = false; fireEvent.click(apply()); });
    apply().disabled = true; expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled();
  });

  it('guards an existing published model application while its logo is loading', async () => {
    const state = workspace(), images = deferredPreviewImages(); state.assets[0]!.url = `/published-readiness-${++readinessCase}.svg`; mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount();
    const button = await screen.findByRole('button', { name: 'Applica a Relazione tecnica B' }) as HTMLButtonElement;
    expect(button).toBeDisabled(); await act(async () => { button.disabled = false; fireEvent.click(button); });
    button.disabled = true; expect(mocks.applyHeaderFooterSet).not.toHaveBeenCalled();
    await act(async () => images[0]!.ready()); expect(button).toBeEnabled();
    fireEvent.click(button); await waitFor(() => expect(mocks.applyHeaderFooterSet).toHaveBeenCalledOnce());
  });
});

describe('header and footer workflow', () => {
  it('previews every known page before body generation and exposes applied/shared state in the same review', async () => {
    const state = workspace(), set = state.sets[0]!; set.draft.stage = 'graphic'; set.draft.guidance = set.publishedRevision!.guidance;
    state.bindings[0]!.snapshot = { ...set.publishedRevision!, variants: structuredClone(set.draft.variants) };
    set.draft.variants[0]!.blocks.push({ id: 'number', region: 'footer', kind: 'field', field: 'pageNumber', x: .8, y: .2, width: .1, height: .5 });
    state.documents[0]!.presentation = { ...createDocumentPresentation('Relazione tecnica B'), header: true, footer: true, cover: false, pageNumbers: true };
    state.pageContexts = [{ documentId: 'report', totalPages: 3, initialFormat: { widthMm: 210, heightMm: 297 } }]; mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount({ startAt: 'editor' });
    const select = await screen.findByLabelText('Pagina da controllare');
    expect(select.querySelectorAll('option')).toHaveLength(3);
    fireEvent.change(select, { target: { value: '2' } }); expect(screen.getByRole('button', { name: 'Piè di pagina: 3' })).toBeTruthy();
    const summary = screen.getByText('In uso · revisione 1 · aggiornamenti condivisi attivi'); fireEvent.click(summary);
    expect(screen.getByLabelText('Aggiorna se viene modificato in futuro')).toBeTruthy(); expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled();
  });
  it('bounds a queued initial read, aborts it, and allows a fresh initialisation on retry', async () => {
    vi.useFakeTimers();
    let queuedSignal: AbortSignal | undefined;
    mocks.getHeaderFooterWorkspace.mockImplementationOnce((_project, _context, signal: AbortSignal) => { queuedSignal = signal; return new Promise(() => undefined); });
    mount();
    expect(screen.getByText('Carico i modelli e i loghi di questo progetto…')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(queuedSignal?.aborted).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('non ha risposto in tempo');
    expect(screen.queryByText('Carico i modelli e i loghi di questo progetto…')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Riprova a caricare modelli e loghi' })); });
    expect(screen.getByRole('option', { name: /Studio tecnico/ })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.getHeaderFooterWorkspace).toHaveBeenCalledTimes(2);
  });
  it('explains stale comparison recovery and confirms only a completed retry', async () => {
    const pending = workspace(); pending.bindings[0]!.status = 'pending';
    pending.bindings[0]!.error = 'Comparison assessment does not match the document snapshot';
    mocks.getHeaderFooterWorkspace.mockResolvedValue(pending);
    mocks.retryHeaderFooterUpdates.mockResolvedValueOnce(pending).mockResolvedValueOnce(workspace());
    mount();
    const retry = await screen.findByRole('button', { name: 'Riprova aggiornamenti pendenti' });
    expect(screen.getByText(/L’anteprima deve essere aggiornata alla struttura salvata/)).toBeTruthy();
    expect(screen.queryByText(/Comparison assessment/)).toBeNull();
    fireEvent.click(retry);
    expect(await screen.findByText('Alcuni aggiornamenti richiedono ancora un controllo.')).toBeTruthy();
    expect(screen.queryByText('Intestazione e piè di pagina aggiornati alla struttura salvata.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova aggiornamenti pendenti' }));
    expect(await screen.findByText('Intestazione e piè di pagina aggiornati alla struttura salvata.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Riprova aggiornamenti pendenti' })).toBeNull();
    expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled();
  });
  it('checks a library choice without applying until the explicit use action', async () => {
    mount(); const option = await screen.findByRole('option', { name: /Studio tecnico/ });
    fireEvent.click(option); expect(option.getAttribute('aria-selected')).toBe('true'); expect(mocks.applyHeaderFooterSet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Aggiorna se viene modificato in futuro'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Applica a Relazione tecnica B' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Applica a Relazione tecnica B' }));
    await waitFor(() => expect(mocks.applyHeaderFooterSet).toHaveBeenCalledWith('project', 'report', expect.objectContaining({ setId: 'studio', followUpdates: false, header: true, footer: true }), undefined));
  });
  it('requires the actual graphic preview and a separate approval before publishing', async () => {
    mount({ startAt: 'editor' });
    await screen.findByRole('button', { name: 'Prepara l’anteprima grafica' });
    expect(screen.queryByRole('img', { name: 'Logo dello studio' })).toBeNull();
    fireEvent.click(screen.getByText('Altre azioni')); fireEvent.click(screen.getByRole('button', { name: 'Anteprima senza ulteriori ritocchi' }));
    expect(screen.getByTestId('header-footer-canonical-graphics').querySelector('image')?.getAttribute('href')).toBe('/logo.svg'); expect(screen.getByRole('button', { name: 'Intestazione: Logo dello studio' })).toBeTruthy(); expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Salva bozza' }));
    await waitFor(() => expect(mocks.saveHeaderFooterDraft).toHaveBeenCalled());
    const confirm = screen.getByLabelText('Ho controllato intestazione e piè di pagina e approvo questa revisione.') as HTMLInputElement;
    await waitFor(() => expect(confirm.disabled).toBe(false));
    const apply = screen.getByRole('button', { name: 'Applica intestazione e piè di pagina' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true); fireEvent.click(confirm); fireEvent.click(apply);
    await waitFor(() => expect(mocks.publishHeaderFooterSet).toHaveBeenCalledWith('project', 'studio', expect.objectContaining({ stage: 'graphic-approved', binding: expect.objectContaining({ documentId: 'report', followUpdates: true }) }), undefined));
  });
  it('persists edited guidance before closing with Escape without publishing it', async () => {
    const onClose = vi.fn(); mount({ startAt: 'editor', onClose });
    await screen.findByRole('button', { name: 'Modello' }); fireEvent.click(screen.getByRole('button', { name: 'Modello' }));
    fireEvent.change(screen.getByLabelText('Indicazioni'), { target: { value: 'Rendi il logo più piccolo.' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.saveHeaderFooterDraft).toHaveBeenCalledWith('project', 'studio', expect.objectContaining({ draft: expect.objectContaining({ guidance: 'Rendi il logo più piccolo.' }) }), undefined);
    expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled();
  });
  it('marks blocks crossing the safe area and prevents applying the draft', async () => {
    mount({ startAt: 'editor' });
    const logo = await screen.findByTestId('header-footer-block-logo'); fireEvent.click(logo);
    fireEvent.change(screen.getByLabelText('Posizione X (%)'), { target: { value: '-5' } });
    expect(screen.getByText(/L’elemento supera il bordo sicuro/)).toBeTruthy(); expect(logo.getAttribute('data-unsafe')).toBe('true');
    expect((screen.getByRole('button', { name: 'Prepara l’anteprima grafica' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('creates a private editable model from an independent snapshot', async () => {
    const independent = workspace(); independent.bindings[0]!.followUpdates = false; mocks.getHeaderFooterWorkspace.mockResolvedValue(independent);
    const fork = model('private'); const created = workspace(); created.sets.push(fork); mocks.createHeaderFooterSet.mockResolvedValue({ ...created, set: fork });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Modifica il modello in uso' }));
    await waitFor(() => expect(mocks.createHeaderFooterSet).toHaveBeenCalledWith('project', expect.objectContaining({ name: 'Studio tecnico — Relazione tecnica B', variants: independent.bindings[0]!.snapshot!.variants }), undefined));
    await waitFor(() => expect(mocks.saveHeaderFooterDraft).toHaveBeenCalledWith('project', 'private', expect.objectContaining({ draft: expect.objectContaining({ stage: 'graphic' }) }), undefined));
    expect(mocks.saveHeaderFooterDraft.mock.calls.every((call) => call[1] === 'private')).toBe(true); expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled();
    expect(screen.getByTestId('header-footer-canonical-graphics').querySelector('image')?.getAttribute('href')).toBe('/logo.svg');
  });
  it('lets users remove a pending logo before upload and preserves collected assets', async () => {
    const empty = workspace(); const draft = model('new'); draft.publishedRevision = null; empty.sets.push(draft); mocks.getHeaderFooterWorkspace.mockResolvedValue(empty);
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Scegli la composizione Studio tecnico' }));
    // This draft already has blocks, so use its asset collection entry.
    fireEvent.click(screen.getByRole('button', { name: 'Loghi e indicazioni' }));
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    fireEvent.change(input, { target: { files: [new File(['logo'], 'new-logo.svg', { type: 'image/svg+xml' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi new-logo.svg' }));
    expect(screen.queryByText('new-logo.svg')).toBeNull(); expect(screen.getByRole('img', { name: 'Logo dello studio' })).toBeTruthy(); expect(mocks.uploadHeaderFooterFiles).not.toHaveBeenCalled();
  });
  it('shows the targeted agent question with a visible block highlight', async () => {
    mount({ startAt: 'editor', highlight: { blockId: 'logo', question: 'Il logo deve restare a sinistra?' } });
    expect(await screen.findByText('Il logo deve restare a sinistra?')).toBeTruthy(); expect(screen.getByTestId('header-footer-block-logo').getAttribute('data-highlight')).toBe('true');
  });
  it('keeps the modal closable with a local recoverable draft when the server save fails', async () => {
    const onClose = vi.fn(); mocks.saveHeaderFooterDraft.mockRejectedValue(new Error('Connection unavailable'));
    mount({ startAt: 'editor', onClose }); await screen.findByRole('button', { name: 'Modello' }); fireEvent.click(screen.getByRole('button', { name: 'Modello' }));
    fireEvent.change(screen.getByLabelText('Indicazioni'), { target: { value: 'Conserva questo lavoro.' } }); fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(await screen.findByRole('button', { name: 'Chiudi conservando la bozza su questo browser' }));
    expect(onClose).toHaveBeenCalled(); expect(sessionStorage.getItem('melillodesign:header-footer-draft:project:studio')).toContain('Conserva questo lavoro.'); expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled();
  });
  it('waits for an ambiguous logo choice and does not present unselected candidates as received logos', async () => {
    const pending = workspace(); pending.searches.push({ id: 'search', target: 'Comune', status: 'candidate', model: 'gpt-6.1-sol', effort: 'low', attempt: 1, assetIds: ['logo-one'], candidates: [{ label: 'Comune candidato', sourceUrl: 'https://example.org/logo.svg', assetId: 'logo-one' }], createdAt: time, updatedAt: time });
    mocks.getHeaderFooterWorkspace.mockResolvedValue(pending); mount({ startAt: 'assets' });
    const propose = await screen.findByRole('button', { name: 'Chiedi una proposta all’agente' }) as HTMLButtonElement; expect(propose.disabled).toBe(true);
    expect(screen.queryByRole('img', { name: 'Logo dello studio' })).toBeNull(); expect(screen.getByRole('img', { name: 'Comune candidato' })).toBeTruthy(); expect(screen.getByRole('button', { name: 'Usa questo logo' })).toBeTruthy();
  });
  it('recognises an unchanged applied design instead of describing it as an unapplied draft', async () => {
    const applied = workspace(); const set = applied.sets[0]!; set.draft.stage = 'graphic'; set.draft.guidance = set.publishedRevision!.guidance; applied.bindings[0]!.snapshot = structuredClone(set.publishedRevision);
    mocks.getHeaderFooterWorkspace.mockResolvedValue(applied); mount({ startAt: 'editor' });
    expect(await screen.findByText('Revisione 1 già applicata — nessuna modifica')).toBeTruthy(); expect(screen.getByRole('button', { name: 'Torna alla chat' })).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Applica intestazione e piè di pagina' })).toBeNull();
  });
  it('flushes the edited draft before sending the docked question answer', async () => {
    let resolveSave!: (value: HeaderFooterWorkspaceResponse) => void;
    mocks.saveHeaderFooterDraft.mockImplementation(() => new Promise<HeaderFooterWorkspaceResponse>((resolve) => { resolveSave = resolve; })); const answered = vi.fn();
    mount({ startAt: 'editor', renderQuestion: (flushDraft) => <button type="button" onClick={() => void flushDraft().then(answered)}>Send targeted answer</button> });
    fireEvent.click(await screen.findByRole('button', { name: 'Modello' })); fireEvent.change(screen.getByLabelText('Indicazioni'), { target: { value: 'Logo ridotto prima della risposta.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send targeted answer' })); await waitFor(() => expect(mocks.saveHeaderFooterDraft).toHaveBeenCalled()); expect(answered).not.toHaveBeenCalled();
    resolveSave(workspace()); await waitFor(() => expect(answered).toHaveBeenCalled());
  });
  it('keeps the collected draft available while a busy agent finishes instead of dropping a request', async () => {
    mount({ startAt: 'assets', busy: true });
    expect((await screen.findByRole('button', { name: 'Attendi la risposta dell’agente' }) as HTMLButtonElement).disabled).toBe(true); expect(screen.getByLabelText('Indicazioni per intestazione e piè di pagina')).toBeTruthy();
  });
  it('shows generated structural alternatives as visual drafts and opens one without applying or publishing it', async () => {
    const first = model('first'), second = model('second'); first.name = first.draft.name = 'Loghi raccolti a sinistra'; second.name = second.draft.name = 'Titolo e loghi bilanciati'; first.publishedRevision = second.publishedRevision = null; first.revision = second.revision = 0;
    const state = workspace(); state.sets = [first, second]; state.bindings = []; mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount(); await screen.findByRole('heading', { name: 'Composizioni proposte' });
    expect(screen.getByRole('button', { name: 'Scegli la composizione Loghi raccolti a sinistra' }).querySelector('[data-testid="header-footer-page"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Scegli la composizione Titolo e loghi bilanciati' }).querySelector('[data-testid="header-footer-page"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Scegli la composizione Titolo e loghi bilanciati' }));
    expect(screen.getByRole('button', { name: 'Prepara l’anteprima grafica' })).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Applica a Relazione tecnica B' })).toBeNull();
    expect(mocks.applyHeaderFooterSet).not.toHaveBeenCalled(); expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled();
  });
  it('opens a single saved graphic proposal directly for review without applying it', async () => {
    const state = workspace(), set = state.sets[0]!;
    set.publishedRevision = null; set.revision = 0; set.draft.stage = 'graphic'; state.bindings = [];
    set.draft.variants[0]!.blocks.push({ id: 'rule', region: 'footer', kind: 'rule', x: .1, y: .1, width: .8, height: .02 });
    mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount();
    expect(await screen.findByLabelText('Ho controllato intestazione e piè di pagina e approvo questa revisione.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Rivedi la proposta' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Piè di pagina: Separatore' })).toBeTruthy();
    expect(screen.getByTestId('header-footer-canonical-graphics')).toBeTruthy();
    expect(screen.queryByText('Scelta del modello')).toBeNull(); expect(screen.queryByText('Composizione delle fasce')).toBeNull();
    expect(mocks.applyHeaderFooterSet).not.toHaveBeenCalled();
    expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled();
  });
  it('applies one approved proposal to every waiting document whose format it provides', async () => {
    const state = workspace(), set = state.sets[0]!;
    set.publishedRevision = null; set.revision = 0; set.draft.stage = 'graphic'; state.bindings = [];
    set.draft.variants.push({ ...structuredClone(set.draft.variants[0]!), id: 'a3', name: 'A3 orizzontale', pageWidthMm: 420, pageHeightMm: 297 });
    state.documents[0]!.presentation = { ...createDocumentPresentation('Relazione tecnica B'), header: true, footer: true };
    state.documents.push({ ...state.documents[0]!, id: 'booklet', name: 'Fascicolo grafico B', presentation: { ...createDocumentPresentation('Fascicolo grafico B'), header: false, footer: true } });
    state.pageContexts = [{ documentId: 'report', totalPages: 8, initialFormat: { widthMm: 210, heightMm: 297 } }, { documentId: 'booklet', totalPages: 4, initialFormat: { widthMm: 420, heightMm: 297 } }];
    mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    const published = structuredClone(state); published.sets[0]!.revision = 1; published.bindings = [{ documentId: 'report', setId: 'studio', followUpdates: true, header: true, footer: true, showOnCover: false, version: 1, appliedRevision: 1, snapshot: null, status: 'applied', updatedAt: time }];
    mocks.publishHeaderFooterSet.mockResolvedValue(published);
    mount();
    const scope = await screen.findByRole('region', { name: 'Ambito di applicazione' });
    expect(scope.textContent).toContain('Relazione tecnica B'); expect(scope.textContent).toContain('Fascicolo grafico B');
    // The other document's version is reached through the document picker; a format switch alone keeps this document's name and pages.
    expect(screen.getByText(/scegli in alto l’altro documento per vedere la sua versione/)).toBeTruthy();
    const confirm = screen.getByLabelText('Ho controllato intestazione e piè di pagina e approvo questa revisione.') as HTMLInputElement;
    await waitFor(() => expect(confirm.disabled).toBe(false)); fireEvent.click(confirm);
    fireEvent.click(screen.getByRole('button', { name: 'Applica intestazione e piè di pagina' }));
    await waitFor(() => expect(mocks.applyHeaderFooterSet).toHaveBeenCalledWith('project', 'booklet', expect.objectContaining({ setId: 'studio', revision: 1, followUpdates: true, header: false, footer: true }), undefined));
    expect(mocks.publishHeaderFooterSet).toHaveBeenCalledWith('project', 'studio', expect.objectContaining({ binding: expect.objectContaining({ documentId: 'report' }) }), undefined);
    // Applying re-renders pages already laid out; the notice must not suggest a separate update.
    expect(await screen.findByText('Applicato a 2 documenti, comprese le pagine già impostate.')).toBeTruthy();
  });
  it('names the regions a proposal applies, so a header switched off in the brief does not read as missing', async () => {
    const state = workspace(), set = state.sets[0]!;
    set.publishedRevision = null; set.revision = 0; set.draft.stage = 'graphic'; state.bindings = [];
    state.documents[0]!.presentation = { ...createDocumentPresentation('Relazione tecnica B'), header: false, footer: true };
    mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount();
    const scope = await screen.findByRole('region', { name: 'Ambito di applicazione' });
    await waitFor(() => expect(scope.textContent).toContain('Applica il piè di pagina a'));
    expect(scope.textContent).toContain('senza intestazione');
  });
  it('hands a requested change to the chat with the draft saved instead of applying it', async () => {
    const state = workspace(), set = state.sets[0]!; set.publishedRevision = null; set.revision = 0; set.draft.stage = 'graphic'; state.bindings = [];
    mocks.getHeaderFooterWorkspace.mockResolvedValue(state); const onEditInChat = vi.fn();
    mount({ onEditInChat });
    fireEvent.click(await screen.findByRole('button', { name: 'Chiedi una modifica in chat' }));
    await waitFor(() => expect(onEditInChat).toHaveBeenCalledOnce());
    expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled(); expect(mocks.applyHeaderFooterSet).not.toHaveBeenCalled();
  });
  it('does not credit the agent with the engineer’s own save when the server re-serialises the draft', async () => {
    mocks.saveHeaderFooterDraft.mockImplementation(async (_project: string, id: string, input: { draft: HeaderFooterSet['draft']; expectedDraftVersion: number }) => {
      const next = workspace(); const { variants, stage, guidance, name, version, ...rest } = input.draft;
      next.sets = next.sets.map((item) => item.id === id ? { ...item, draft: { variants, stage, ...rest, guidance, name, version }, draftVersion: input.expectedDraftVersion + 1 } : item);
      mocks.getHeaderFooterWorkspace.mockResolvedValue(next); return next;
    });
    mount({ startAt: 'editor' }); fireEvent.click(await screen.findByRole('button', { name: 'Modello' }));
    fireEvent.change(screen.getByLabelText('Indicazioni'), { target: { value: 'Filetto sottile sopra.' } });
    await waitFor(() => expect(mocks.saveHeaderFooterDraft).toHaveBeenCalled(), { timeout: 3000 });
    await act(async () => { window.dispatchEvent(new CustomEvent('melillodesign:header-footer-updated', { detail: { projectId: 'project' } })); });
    await waitFor(() => expect(mocks.getHeaderFooterWorkspace.mock.calls.length).toBeGreaterThan(1));
    expect(screen.queryByText('Composizione aggiornata dall’agente. Controlla la nuova bozza prima di applicarla.')).toBeNull();
    expect((screen.getByLabelText('Indicazioni') as HTMLTextAreaElement).value).toBe('Filetto sottile sopra.');
  });
  it('places visual proposals before secondary creation and keeps saved agent instructions out of their cards', async () => {
    const state = workspace(), set = state.sets[0]!; set.publishedRevision = null; set.draft.guidance = 'INTERNAL MODEL POLICY: preserve every saved field'; state.bindings = []; mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount(); await screen.findByRole('heading', { name: 'Composizioni proposte' });
    expect(screen.queryByText('Un modello per questo documento')).toBeNull();
    expect(screen.queryByText(set.draft.guidance)).toBeNull();
    const preview = screen.getByRole('button', { name: 'Scegli la composizione Studio tecnico' });
    const create = screen.getByText('Crea un altro modello');
    expect(preview.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const help = screen.getByText('Come funzionano gli aggiornamenti').closest('details')!;
    expect(help.open).toBe(false); expect(help.textContent).toContain('anche da un altro documento');
  });
  it('explains first application, later reuse and question answers without implying an instant preview switch', async () => {
    const state = workspace(); state.bindings = []; state.documents[0]!.presentation = { version: 1, status: 'draft', name: 'Relazione tecnica B', header: true, footer: true, cover: null, pageNumbers: null, numberOnCover: null, coverCountsTowardPageLimit: null, coverCountsInNumbering: null, numberingStart: 1 }; state.documents.push({ ...state.documents[0]!, id: 'booklet', name: 'Fascicolo grafico B' }); mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount({ startAt: 'editor', setId: 'studio', highlight: { question: 'Logo più piccolo?' } });
    expect(await screen.findByRole('region', { name: 'Ambito di applicazione' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Ambito di applicazione' }).textContent).toContain('Relazione tecnica B'); expect(screen.getByRole('region', { name: 'Ambito di applicazione' }).textContent).not.toContain('Fascicolo grafico B'); expect(screen.getByText(/Le opzioni della domanda non cambiano subito la pagina/)).toBeTruthy();
  });
  it('refreshes the saved native agent draft when the agent finishes without reopening the modal', async () => {
    const view = mount({ startAt: 'editor', busy: true }); await screen.findByRole('button', { name: 'Attendi l’agente' });
    const changed = workspace(); changed.sets[0]!.draft.stage = 'graphic'; changed.sets[0]!.draftVersion = 2; mocks.getHeaderFooterWorkspace.mockResolvedValue(changed);
    view.rerender(<I18nProvider initial="it"><HeaderFooterWorkspace projectId="project" documentId="report" startAt="editor" busy={false} onClose={vi.fn()} /></I18nProvider>);
    expect(await screen.findByText('Composizione aggiornata dall’agente. Controlla la nuova bozza prima di applicarla.')).toBeTruthy();
    expect(screen.getByLabelText('Ho controllato intestazione e piè di pagina e approvo questa revisione.')).toBeTruthy(); expect(screen.getByTestId('header-footer-canonical-graphics')).toBeTruthy(); expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled();
  });
  it('preserves local edits and warns about the concurrent agent revision', async () => {
    mount({ startAt: 'editor' }); fireEvent.click(await screen.findByRole('button', { name: 'Modello' })); fireEvent.change(screen.getByLabelText('Indicazioni'), { target: { value: 'Mia indicazione locale.' } });
    const changed = workspace(); changed.sets[0]!.draft.guidance = 'Indicazione modificata da Codex'; changed.sets[0]!.draftVersion = 2; mocks.getHeaderFooterWorkspace.mockResolvedValue(changed);
    window.dispatchEvent(new CustomEvent('melillodesign:header-footer-updated', { detail: { projectId: 'project' } }));
    expect(await screen.findByText(/L’agente ha aggiornato la composizione, ma hai modifiche locali/)).toBeTruthy(); expect((screen.getByLabelText('Indicazioni') as HTMLTextAreaElement).value).toBe('Mia indicazione locale.');
  });
  it('shows an unknown page total until the actual document count becomes available', async () => {
    const state = workspace(); state.sets[0]!.draft.variants[0]!.blocks.push({ id: 'total', region: 'footer', kind: 'field', field: 'totalPages', x: .8, y: .2, width: .1, height: .5 }); mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    const view = mount({ startAt: 'editor' });
    expect((await screen.findByTestId('header-footer-block-total')).textContent).toBe('—');
    view.rerender(<I18nProvider initial="it"><HeaderFooterWorkspace projectId="project" documentId="report" startAt="editor" totalPages={2} onClose={vi.fn()} /></I18nProvider>);
    expect(screen.getByTestId('header-footer-block-total').textContent).toBe('2');
  });
  it('opens and republishes the corrected pending draft after a first application failed without a snapshot', async () => {
    const state = workspace(); state.bindings[0]!.status = 'pending'; state.bindings[0]!.snapshot = null; state.bindings[0]!.appliedRevision = null; state.bindings[0]!.error = 'Unsupported page geometry'; state.sets[0]!.draft.stage = 'graphic'; state.sets[0]!.draftVersion = 7; mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount(); expect(await screen.findByText(/Aggiornamento da completare.*Unsupported page geometry/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Correggi il modello in attesa' }));
    expect(screen.getByTestId('header-footer-canonical-graphics')).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Ho controllato intestazione e piè di pagina e approvo questa revisione.')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Ho controllato intestazione e piè di pagina e approvo questa revisione.'));
    fireEvent.click(screen.getByRole('button', { name: 'Applica intestazione e piè di pagina' }));
    await waitFor(() => expect(mocks.publishHeaderFooterSet).toHaveBeenCalledWith('project', 'studio', expect.objectContaining({ stage: 'graphic-approved', expectedDraftVersion: 7 }), undefined));
  });
  it('previews the document’s A3 landscape format in both published and proposed library cards', async () => {
    const state = workspace(), published = state.sets[0]!;
    const a3 = { ...structuredClone(published.draft.variants[0]!), id: 'a3', name: 'A3 orizzontale', pageWidthMm: 420, pageHeightMm: 297 };
    published.draft.variants.push(a3); published.publishedRevision!.variants.push(structuredClone(a3));
    const proposed = structuredClone(published); proposed.id = 'new'; proposed.name = 'Proposta nuova'; proposed.publishedRevision = null; state.sets.push(proposed); mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount({ initialFormat: { widthMm: 420, heightMm: 297 } });
    const publishedCard = await screen.findByRole('option', { name: /Studio tecnico/ });
    expect(publishedCard.querySelector('[data-testid="header-footer-page"]')?.getAttribute('data-width-mm')).toBe('420');
    expect(publishedCard.querySelector('svg[viewBox="0 0 420 297"]')).toBeTruthy();
    const proposedCard = screen.getByRole('button', { name: 'Scegli la composizione Proposta nuova' });
    expect(proposedCard.querySelector('[data-testid="header-footer-page"]')?.getAttribute('data-width-mm')).toBe('420');
    expect(proposedCard.querySelector('[data-testid="header-footer-page"]')?.getAttribute('data-height-mm')).toBe('297');
  });
  it.each([false, true])('only offers recurring graphics on a cover when the document can have one: cover=%s', async (cover) => {
    const state = workspace(); state.documents[0]!.presentation = { ...createDocumentPresentation('Relazione tecnica B'), cover }; mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount(); await screen.findByRole('option', { name: /Studio tecnico/ });
    expect(Boolean(screen.queryByLabelText('Mostra anche in copertina'))).toBe(cover);
    fireEvent.click(screen.getByRole('button', { name: 'Modifica il modello in uso' })); fireEvent.click(screen.getByRole('button', { name: 'Modello' }));
    expect(Boolean(screen.queryByLabelText('Mostra anche in copertina'))).toBe(cover); expect(mocks.applyHeaderFooterSet).not.toHaveBeenCalled();
  });
  it('saves local work before switching the clearly named document target', async () => {
    const state = workspace(); state.documents[0]!.presentation = { ...createDocumentPresentation('Relazione tecnica B'), header: true, footer: true }; state.documents.push({ ...state.documents[0]!, id: 'booklet', name: 'Fascicolo grafico' }); mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    const onDocumentChange = vi.fn(); mount({ startAt: 'editor', onDocumentChange });
    fireEvent.click(await screen.findByRole('button', { name: 'Modello' })); fireEvent.change(screen.getByLabelText('Indicazioni'), { target: { value: 'Bozza del documento prima del cambio.' } });
    fireEvent.change(screen.getByLabelText('Documento delle fasce'), { target: { value: 'booklet' } });
    await waitFor(() => expect(onDocumentChange).toHaveBeenCalledWith('booklet'));
    expect(mocks.saveHeaderFooterDraft).toHaveBeenCalledWith('project', 'studio', expect.objectContaining({ draft: expect.objectContaining({ guidance: 'Bozza del documento prima del cambio.' }) }), undefined);
  });
  it('keeps the shared draft open when the picker shows another document that uses it', async () => {
    const state = workspace(); state.documents[0]!.presentation = { ...createDocumentPresentation('Relazione tecnica B'), header: false, footer: true };
    state.documents.push({ ...state.documents[0]!, id: 'booklet', name: 'Fascicolo grafico B', presentation: { ...createDocumentPresentation('Fascicolo grafico B'), header: false, footer: true } });
    state.bindings[0]!.header = false; state.bindings.push({ ...state.bindings[0]!, documentId: 'booklet' });
    mocks.getHeaderFooterWorkspace.mockImplementation(async () => structuredClone(state));
    mocks.saveHeaderFooterDraft.mockImplementation(async (_project: string, _id: string, input: { draft: HeaderFooterSet['draft']; expectedDraftVersion: number }) => { state.sets[0] = { ...state.sets[0]!, draft: input.draft, draftVersion: input.expectedDraftVersion + 1 }; return structuredClone(state); });
    const onDocumentChange = vi.fn((id: string) => { view.rerender(<I18nProvider initial="it"><HeaderFooterWorkspace projectId="project" documentId={id} onClose={vi.fn()} onDocumentChange={onDocumentChange} /></I18nProvider>); });
    const view = mount({ onDocumentChange });
    fireEvent.click(await screen.findByRole('button', { name: 'Modifica il modello in uso' }));
    fireEvent.click(screen.getByRole('button', { name: 'Campo dinamico' }));
    fireEvent.change(screen.getByLabelText('Documento delle fasce'), { target: { value: 'booklet' } });
    await waitFor(() => expect(onDocumentChange).toHaveBeenCalledWith('booklet'));
    // The review help sends the engineer to the picker to see the other document's version of the same draft.
    // The name field now shows the booklet, and the field added before the switch is still there.
    expect(await screen.findAllByRole('button', { name: 'Piè di pagina: Fascicolo grafico B' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Piè di pagina: Nome progetto' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Modifica il modello in uso' })).toBeNull();
  });
  it('adds a dynamic field the strip does not show yet in the widest free gap of that strip', async () => {
    mount({ startAt: 'editor' });
    fireEvent.click(await screen.findByTestId('header-footer-block-document-name'));
    fireEvent.click(screen.getByRole('button', { name: 'Campo dinamico' }));
    const field = () => (screen.getByLabelText(/^Valore del documento/) as HTMLSelectElement).value;
    const span = () => [Number((screen.getByLabelText('Posizione X (%)') as HTMLInputElement).value), Number((screen.getByLabelText('Larghezza (%)') as HTMLInputElement).value)] as const;
    expect((screen.getByLabelText('Fascia') as HTMLSelectElement).value).toBe('footer');
    // The footer already shows the document name across 10–80 %: the next field is another one, in the wider right-hand gap.
    expect(field()).toBe('projectName');
    let [x, width] = span(); expect(x).toBeGreaterThanOrEqual(80); expect(x + width).toBeLessThanOrEqual(100);
    fireEvent.click(screen.getByRole('button', { name: 'Campo dinamico' }));
    // With the right end taken too, the widest gap left is before the name.
    expect(field()).toBe('pageNumber');
    [x, width] = span(); expect(x).toBeGreaterThanOrEqual(0); expect(x + width).toBeLessThanOrEqual(10);
    expect(screen.queryByText(/L’elemento supera il bordo sicuro/)).toBeNull();
  });
  it('shows which formats lack the selected element and copies it there at the same printed size and edge distance', async () => {
    const state = workspace(), set = state.sets[0]!;
    set.draft.variants.push({ ...structuredClone(set.draft.variants[0]!), id: 'a3', name: 'A3 orizzontale', pageWidthMm: 420, pageHeightMm: 297 });
    set.draft.variants[0]!.blocks.push({ id: 'date', region: 'footer', kind: 'field', field: 'date', x: .82, y: .2, width: .16, height: .5 });
    mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount({ startAt: 'editor' });
    fireEvent.click(await screen.findByTestId('header-footer-block-date'));
    expect(screen.getByText('Questo elemento manca in A3 orizzontale.').getAttribute('role')).toBe('status');
    // An element both formats already show is not offered for copying.
    fireEvent.click(screen.getByTestId('header-footer-block-document-name'));
    expect(screen.getByText('Presente anche in A3 orizzontale.').getAttribute('role')).toBe('status');
    expect(screen.queryByRole('button', { name: /^Copia in/ })).toBeNull();
    fireEvent.click(screen.getByTestId('header-footer-block-date'));
    fireEvent.click(screen.getByRole('button', { name: 'Copia in A3 orizzontale' }));
    expect(screen.getByText('Presente anche in A3 orizzontale.').getAttribute('role')).toBe('status');
    fireEvent.change(screen.getByLabelText('Formato'), { target: { value: 'a3' } });
    fireEvent.click(screen.getByTestId('header-footer-block-date'));
    expect((screen.getByLabelText(/^Valore del documento/) as HTMLSelectElement).value).toBe('date');
    // 4.2 mm from the right edge and 33.6 mm wide, as in A4, on a page twice as wide.
    expect(Number((screen.getByLabelText('Posizione X (%)') as HTMLInputElement).value)).toBe(91);
    expect(Number((screen.getByLabelText('Larghezza (%)') as HTMLInputElement).value)).toBe(8);
    expect(Number((screen.getByLabelText('Posizione Y (%)') as HTMLInputElement).value)).toBe(20);
    await waitFor(() => expect(mocks.saveHeaderFooterDraft).toHaveBeenCalledWith('project', 'studio', expect.objectContaining({ draft: expect.objectContaining({ variants: expect.arrayContaining([expect.objectContaining({ id: 'a3', blocks: expect.arrayContaining([expect.objectContaining({ kind: 'field', field: 'date' })]) })]) }) }), undefined), { timeout: 3000 });
    expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled();
  });
  it('keeps a copied element inside a shorter strip of the other format', async () => {
    const state = workspace(), set = state.sets[0]!;
    set.draft.variants.push({ ...structuredClone(set.draft.variants[0]!), id: 'a3', name: 'A3 orizzontale', pageWidthMm: 420, pageHeightMm: 297, footerHeightMm: 8 });
    set.draft.variants[0]!.blocks.push({ id: 'date', region: 'footer', kind: 'field', field: 'date', x: .82, y: .2, width: .16, height: .5 });
    mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount({ startAt: 'editor' });
    fireEvent.click(await screen.findByTestId('header-footer-block-date'));
    fireEvent.click(screen.getByRole('button', { name: 'Copia in A3 orizzontale' }));
    fireEvent.change(screen.getByLabelText('Formato'), { target: { value: 'a3' } });
    fireEvent.click(screen.getByTestId('header-footer-block-date'));
    const value = (label: string) => Number((screen.getByLabelText(label) as HTMLInputElement).value);
    expect(value('Posizione Y (%)')).toBeGreaterThanOrEqual(0); expect(value('Posizione Y (%)') + value('Altezza (%)')).toBeLessThanOrEqual(100);
    expect(value('Posizione X (%)') + value('Larghezza (%)')).toBeLessThanOrEqual(100);
    expect(screen.queryByText(/L’elemento supera il bordo sicuro/)).toBeNull();
  });
  it('names only the footer on the apply action when the header is off', async () => {
    const state = workspace(), set = state.sets[0]!; set.publishedRevision = null; set.revision = 0; set.draft.stage = 'graphic'; state.bindings = [];
    state.documents[0]!.presentation = { ...createDocumentPresentation('Relazione tecnica B'), header: false, footer: true };
    mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount();
    expect(await screen.findByRole('button', { name: 'Applica il piè di pagina' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Applica intestazione e piè di pagina' })).toBeNull();
  });
  it('announces the same date the applied graphic prints', async () => {
    const state = workspace(); const date = { id: 'date', region: 'footer' as const, kind: 'field' as const, field: 'date' as const, x: .5, y: .2, width: .2, height: .5 };
    state.sets[0]!.draft.stage = 'graphic'; state.sets[0]!.draft.variants[0]!.blocks.push(date); state.sets[0]!.publishedRevision!.variants[0]!.blocks.push(date);
    state.sets[0]!.publishedRevision!.stage = 'graphic'; state.sets[0]!.publishedRevision!.guidance = state.sets[0]!.draft.guidance; state.bindings[0]!.snapshot = state.sets[0]!.publishedRevision;
    mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount({ startAt: 'editor' });
    expect((await screen.findAllByRole('button', { name: 'Piè di pagina: 24/10/2026' })).length).toBeGreaterThan(0);
    expect(screen.getByTestId('header-footer-canonical-graphics').innerHTML).toContain('>24/10/2026</tspan>');
  });
  it('shows saved structural drafts instead of a first-model empty state', async () => {
    const state = workspace(); state.sets[0]!.publishedRevision = null; state.bindings = []; mocks.getHeaderFooterWorkspace.mockResolvedValue(state); mount();
    await screen.findByRole('heading', { name: 'Composizioni proposte' }); expect(screen.queryByText('Il primo modello di questo progetto')).toBeNull(); expect(screen.getByRole('button', { name: 'Crea un nuovo modello' }).closest('details')?.open).toBe(false);
  });
  it('uses the confirmed project, name and numbering for a new model without retyping them', async () => {
    const state = workspace(); state.sets = []; state.bindings = []; state.assets = []; state.documents[0]!.presentation = { ...createDocumentPresentation('Relazione tecnica B'), cover: true, pageNumbers: true, numberOnCover: false, coverCountsInNumbering: false }; mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mocks.createHeaderFooterSet.mockImplementation(async (_project: string, input: { name: string; guidance: string }) => { const created = model('new'); created.draft.guidance = input.guidance; return { ...state, sets: [created], set: created }; });
    mount({ projectName: 'Progetto Antro', totalPages: 8 }); fireEvent.click(await screen.findByRole('button', { name: 'Crea un nuovo modello' }));
    await screen.findByRole('region', { name: 'Contesto del documento' }); expect(mocks.createHeaderFooterSet).toHaveBeenCalledWith('project', expect.objectContaining({ guidance: expect.stringContaining('Progetto: Progetto Antro') }), undefined);
    expect(screen.getByText('Pagine: 8')).toBeTruthy(); expect(screen.getByText('Documento: Relazione tecnica B')).toBeTruthy();
  });
  it.each(['Senza loghi', 'Li aggiungerò dopo'])('continues with an explicit %s choice and persists it without logo intake', async (choice) => {
    const state = workspace(); state.assets = []; state.sets[0]!.draft.variants[0]!.blocks = []; mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount({ startAt: 'assets' }); const selected = await screen.findByRole('radio', { name: choice }); fireEvent.click(selected);
    expect((screen.getByRole('button', { name: 'Chiedi una proposta all’agente' }) as HTMLButtonElement).disabled).toBe(false); expect(document.querySelector('input[type=file]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chiedi una proposta all’agente' }));
    await waitFor(() => expect(mocks.saveHeaderFooterDraft).toHaveBeenCalledWith('project', 'studio', expect.objectContaining({ draft: expect.objectContaining({ logoPlan: choice === 'Senza loghi' ? 'none' : 'later' }) }), undefined)); expect(mocks.searchHeaderFooterLogo).not.toHaveBeenCalled(); expect(mocks.uploadHeaderFooterFiles).not.toHaveBeenCalled();
  });
  it('offers one structural next step and keeps the manual preview secondary', async () => {
    mount({ startAt: 'editor' }); await screen.findByRole('button', { name: 'Prepara l’anteprima grafica' });
    expect(screen.queryByRole('button', { name: 'Sviluppa con Codex' })).toBeNull(); expect(screen.getByRole('button', { name: 'Anteprima senza ulteriori ritocchi' }).closest('details')?.open).toBe(false);
    fireEvent.click(screen.getByText('Altre azioni')); expect(screen.getByRole('button', { name: 'Anteprima senza ulteriori ritocchi' })).toBeTruthy(); expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled();
  });
  it('lets the user inspect actual cover visibility and subsequent page numbering before applying', async () => {
    const state = workspace(); state.documents[0]!.presentation = { ...createDocumentPresentation('Relazione tecnica B'), cover: true, pageNumbers: true, numberOnCover: false, coverCountsInNumbering: false }; state.sets[0]!.draft.stage = 'graphic'; state.sets[0]!.draft.variants[0]!.blocks.push({ id: 'number', region: 'footer', kind: 'field', field: 'pageNumber', x: .8, y: .2, width: .1, height: .5 }); mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount({ startAt: 'editor', totalPages: 8 }); await screen.findByLabelText('Pagina da controllare');
    expect(screen.getByTestId('header-footer-page').getAttribute('data-page-index')).toBe('1'); expect(screen.getByRole('button', { name: 'Piè di pagina: 1' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Pagina da controllare'), { target: { value: '0' } }); expect(screen.getByTestId('header-footer-page').getAttribute('data-cover')).toBe('true'); expect(screen.queryByTestId('header-footer-block-logo')).toBeNull(); expect(screen.getByTestId('header-footer-canonical-graphics').querySelector('image')).toBeNull();
    fireEvent.change(screen.getByLabelText('Pagina da controllare'), { target: { value: '7' } }); expect(screen.getByRole('button', { name: 'Piè di pagina: 7' })).toBeTruthy(); expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled();
  });
  it('offers a print-size zoom, so the texts can be read at the size they will print', async () => {
    // At "Adatta" an A4 page is about 240 px wide and 10 pt footer text renders about 4 px tall.
    const state = workspace(); state.sets[0]!.draft.stage = 'graphic'; mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount({ startAt: 'editor', totalPages: 8 }); const zoom = await screen.findByLabelText('Zoom della pagina') as HTMLSelectElement;
    fireEvent.change(zoom, { target: { value: 'print' } });
    expect(parseFloat(screen.getByTestId('header-footer-page').style.width)).toBeCloseTo(210 * 96 / 25.4);
    expect(screen.getByText(/100% stampa/, { selector: 'option' })).toBeTruthy();
  });
  it('prints as total the number the last page carries when the cover stays out of the sequence', async () => {
    // Flow run 27 Oct 2026: 8 pages with the cover excluded from numbering read "Pagina 7 di 8" on the last page.
    const state = workspace(); state.documents[0]!.presentation = { ...createDocumentPresentation('Relazione tecnica B'), cover: true, pageNumbers: true, numberOnCover: false, coverCountsInNumbering: false }; state.sets[0]!.draft.stage = 'graphic'; state.sets[0]!.draft.variants[0]!.blocks.push({ id: 'total', region: 'footer', kind: 'field', field: 'totalPages', x: .8, y: .2, width: .1, height: .5 }); mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    mount({ startAt: 'editor', totalPages: 8 }); await screen.findByLabelText('Pagina da controllare');
    fireEvent.change(screen.getByLabelText('Pagina da controllare'), { target: { value: '7' } });
    expect(screen.getByTestId('header-footer-block-total').getAttribute('aria-label')).toBe('Piè di pagina: 7');
  });
  it('offers the next named unconfigured document after an applied design instead of an ambiguous return', async () => {
    const state = workspace(), set = state.sets[0]!; set.draft.stage = 'graphic'; set.draft.guidance = set.publishedRevision!.guidance; state.bindings[0]!.snapshot = structuredClone(set.publishedRevision);
    state.documents[0]!.presentation = { ...createDocumentPresentation('Relazione tecnica B'), header: true, footer: true }; state.documents.push({ ...state.documents[0]!, id: 'booklet', name: 'Fascicolo grafico' }); mocks.getHeaderFooterWorkspace.mockResolvedValue(state);
    const onDocumentChange = vi.fn(); mount({ startAt: 'editor', onDocumentChange });
    fireEvent.click(await screen.findByRole('button', { name: 'Imposta Fascicolo grafico' })); await waitFor(() => expect(onDocumentChange).toHaveBeenCalledWith('booklet'));
    expect(mocks.applyHeaderFooterSet).not.toHaveBeenCalled(); expect(mocks.publishHeaderFooterSet).not.toHaveBeenCalled();
  });
});
