import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { headerFooterTextOverflow } from './header-footer-fit.js';
import { replaceFileAtomically } from '../storage/atomic-file.js';
import {
  ApplyHeaderFooterRequestSchema, CreateHeaderFooterSetRequestSchema, HeaderFooterIdSchema,
  HeaderFooterSearchRequestSchema, PublishHeaderFooterRequestSchema, RestoreHeaderFooterRequestSchema, SaveHeaderFooterDraftRequestSchema, ValidateHeaderFooterRequestSchema,
  headerFooterBlockWarnings, headerFooterVariantForFormat,
  type ApplyHeaderFooterRequest, type CreateHeaderFooterSetRequest, type HeaderFooterAsset, type HeaderFooterBinding,
  type HeaderFooterDraft, type HeaderFooterDraftVersion, type HeaderFooterHistoryEntry, type HeaderFooterRevision, type HeaderFooterSearch, type HeaderFooterSearchRequest,
  type HeaderFooterSet, type HeaderFooterTransaction, type HeaderFooterWorkspaceResponse, type HeaderFooterPageContext, type ProjectDocument,
  type PublishHeaderFooterRequest, type RestoreHeaderFooterRequest, type SaveHeaderFooterDraftRequest, type ValidateHeaderFooterRequest, type ValidateHeaderFooterResponse,
} from '@open-design/contracts';

export class HeaderFooterError extends Error {
  constructor(message: string, public readonly statusCode = 400, public readonly code = 'HEADER_FOOTER_INVALID_REQUEST') { super(message); }
}
interface Library {
  version: 1; projectId: string; sets: HeaderFooterSet[]; bindings: HeaderFooterBinding[]; assets: HeaderFooterAsset[];
  searches: HeaderFooterSearch[]; transactions: HeaderFooterTransaction[]; history: HeaderFooterHistoryEntry[];
  uploadErrors?: { name: string; error: string; createdAt: string }[];
}
export interface HeaderFooterStoreOptions {
  dataRoot: string; projectId: string; projectRoot: string; documents(): Promise<ProjectDocument[]>;
  sourceRoots?(): Promise<string[]>;
  pageContexts?(documents: ProjectDocument[]): Promise<HeaderFooterPageContext[]>;
  format?(document: ProjectDocument): Promise<{ widthMm: number; heightMm: number } | null>;
  formats?(document: ProjectDocument): Promise<{ widthMm: number; heightMm: number }[]>;
  validateApply?(document: ProjectDocument, binding: HeaderFooterBinding, revision: HeaderFooterRevision): Promise<void>;
  onApply?(document: ProjectDocument, binding: HeaderFooterBinding, revision: HeaderFooterRevision | null): Promise<{ needsReview?: boolean } | void>;
  beforeRestore?(): Promise<void>;
  now?: () => number;
}
const queues = new Map<string, Promise<unknown>>();
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const inside = (root: string, target: string) => { const rel = path.relative(root, target); return !rel || !rel.startsWith('..') && !path.isAbsolute(rel); };
const copy = <T>(value: T): T => structuredClone(value);

/** A project-scoped registry, immutable publications and recovery saves, independent of user Git and document folders. */
export class HeaderFooterStore {
  private root = '';
  private readonly now: () => number;
  constructor(private readonly options: HeaderFooterStoreOptions) {
    if (!path.isAbsolute(options.dataRoot) || !path.isAbsolute(options.projectRoot) || !options.projectId || options.projectId.length > 240) throw new HeaderFooterError('Explicit daemon root and project identity are required');
    this.now = options.now ?? Date.now;
  }
  get identity(): string { return this.options.projectId; }
  private time(): string { return new Date(this.now()).toISOString(); }
  private async initialize(): Promise<void> {
    if (this.root) return;
    await mkdir(this.options.dataRoot, { recursive: true });
    const dataRoot = await realpath(this.options.dataRoot), projectRoot = await realpath(this.options.projectRoot);
    this.root = path.join(dataRoot, 'header-footer', createHash('sha256').update(this.options.projectId).digest('hex'));
    if (inside(projectRoot, this.root)) throw new HeaderFooterError('The header/footer registry must stay outside the selected project');
    for (const folder of [path.dirname(this.root), this.root, path.join(this.root, 'recovery'), path.join(this.root, 'revisions'), path.join(this.root, 'assets')]) {
      await mkdir(folder, { recursive: true }); if ((await lstat(folder)).isSymbolicLink() || !inside(dataRoot, await realpath(folder))) throw new HeaderFooterError('The header/footer storage cannot use symbolic links');
    }
  }
  private async serial<T>(work: () => Promise<T>): Promise<T> {
    const key = `${path.resolve(this.options.dataRoot)}\0${this.options.projectId}`;
    const task = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => { await this.initialize(); return work(); }); queues.set(key, task);
    try { return await task; } finally { if (queues.get(key) === task) queues.delete(key); }
  }
  private async read(): Promise<Library> {
    try {
      const file = path.join(this.root, 'library.json'), info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 20_000_000) throw new HeaderFooterError('Header/footer registry is invalid', 503);
      const value = JSON.parse(await readFile(file, 'utf8')) as Library;
      if (value.version !== 1 || value.projectId !== this.identity || !['sets', 'bindings', 'assets', 'searches', 'transactions', 'history'].every((key) => Array.isArray(value[key as keyof Library]))) throw new HeaderFooterError('Header/footer registry ownership is invalid', 503);
      return value;
    } catch (error) { if (!absent(error)) throw error; return { version: 1, projectId: this.identity, sets: [], bindings: [], assets: [], searches: [], transactions: [], history: [] }; }
  }
  private async atomic(file: string, value: unknown, immutable = false): Promise<void> {
    const payload = `${JSON.stringify(value, null, 2)}\n`, temporary = `${file}.${randomUUID()}.tmp`;
    if (Buffer.byteLength(payload) > 20_000_000) throw new HeaderFooterError('Header/footer registry exceeds its size limit', 413);
    if (immutable) { const output = await open(file, 'wx', 0o600); try { await output.writeFile(payload); await output.sync(); } finally { await output.close(); } return; }
    const previous = await lstat(file).catch((error) => { if (absent(error)) return null; throw error; });
    if (previous?.isSymbolicLink()) throw new HeaderFooterError('Cannot overwrite a linked registry file');
    const output = await open(temporary, 'wx', 0o600);
    try { await output.writeFile(payload); await output.sync(); } finally { await output.close(); }
    try { await replaceFileAtomically(temporary, file); } finally { await unlink(temporary).catch(() => undefined); }
  }
  private async write(state: Library, event?: Omit<HeaderFooterHistoryEntry, 'id' | 'createdAt'>): Promise<void> {
    if (event) {
      const entry: HeaderFooterHistoryEntry = { ...event, id: randomUUID(), createdAt: this.time() };
      state.history.unshift(entry);
      // Each acknowledged save has an immutable full recovery state, including overwritten drafts and bindings.
      await this.atomic(path.join(this.root, 'recovery', `${entry.id}.json`), state, true);
    }
    await this.atomic(path.join(this.root, 'library.json'), state);
  }
  private set(state: Library, id: string): HeaderFooterSet {
    HeaderFooterIdSchema.parse(id); const set = state.sets.find((item) => item.id === id);
    if (!set) throw new HeaderFooterError('Header/footer design not found in this project', 404); return set;
  }
  private async document(documentId: string): Promise<ProjectDocument> {
    HeaderFooterIdSchema.parse(documentId); const document = (await this.options.documents()).find((item) => item.id === documentId);
    if (!document || document.projectId !== this.identity) throw new HeaderFooterError('Document not found in this project', 404); return document;
  }
  private async workspace(state: Library): Promise<HeaderFooterWorkspaceResponse> {
    const documents = await this.options.documents();
    return copy({ ...state, documents, ...(this.options.pageContexts ? { pageContexts: await this.options.pageContexts(documents) } : {}) });
  }
  async sourceRoots(): Promise<string[]> { return this.options.sourceRoots ? this.options.sourceRoots() : [this.options.projectRoot]; }
  private conflict(condition: boolean, message: string): void { if (condition) throw new HeaderFooterError(message, 409, 'HEADER_FOOTER_CONFLICT'); }
  async list(): Promise<HeaderFooterWorkspaceResponse> { return this.serial(async () => this.workspace(await this.read())); }
  async getBinding(documentId: string): Promise<HeaderFooterBinding | null> { return this.serial(async () => { await this.document(documentId); return copy((await this.read()).bindings.find((item) => item.documentId === documentId) ?? null); }); }
  async create(input: CreateHeaderFooterSetRequest): Promise<HeaderFooterWorkspaceResponse & { set: HeaderFooterSet }> {
    return this.serial(async () => {
      const request = CreateHeaderFooterSetRequestSchema.parse(input), state = await this.read(), time = this.time(), id = randomUUID();
      const variants = request.variants ?? [{ id: 'a4-portrait', name: 'A4 verticale', pageWidthMm: 210, pageHeightMm: 297, headerHeightMm: 20, footerHeightMm: 15, blocks: [] }, { id: 'a3-landscape', name: 'A3 orizzontale', pageWidthMm: 420, pageHeightMm: 297, headerHeightMm: 20, footerHeightMm: 15, blocks: [] }];
      const set: HeaderFooterSet = { id, name: request.name, draft: { version: 1, name: request.name, guidance: request.guidance ?? '', stage: 'structural', variants }, draftVersion: 1, revision: 0, publishedRevision: null, archivedAt: null, createdAt: time, updatedAt: time };
      state.sets.push(set); await this.write(state, { action: 'create', setId: id, documentIds: [] }); return { ...await this.workspace(state), set: copy(set) };
    });
  }
  async saveDraft(setId: string, input: SaveHeaderFooterDraftRequest): Promise<HeaderFooterWorkspaceResponse> {
    return this.serial(async () => {
      const request = SaveHeaderFooterDraftRequestSchema.parse(input), state = await this.read(), set = this.set(state, setId);
      this.conflict(set.draftVersion !== request.expectedDraftVersion, 'This draft changed elsewhere. Reload it before saving; your local draft has not been applied.');
      this.validateDraftIdentities(request.draft); set.draft = copy(request.draft); set.name = request.draft.name; set.draftVersion++; set.updatedAt = this.time();
      await this.write(state, { action: 'draft-save', setId, documentIds: [] }); return this.workspace(state);
    });
  }
  async archive(setId: string, archived: boolean, expectedRevision: number): Promise<HeaderFooterWorkspaceResponse> { return this.serial(async () => { const state = await this.read(), set = this.set(state, setId); this.conflict(set.revision !== expectedRevision, 'The design changed before this library update'); set.archivedAt = archived ? this.time() : null; set.updatedAt = this.time(); await this.write(state, { action: archived ? 'archive' : 'unarchive', setId, documentIds: [] }); return this.workspace(state); }); }
  private validateDraftIdentities(draft: HeaderFooterDraft): void {
    if (new Set(draft.variants.map((variant) => variant.id)).size !== draft.variants.length || draft.variants.some((variant) => new Set(variant.blocks.map((block) => block.id)).size !== variant.blocks.length)) throw new HeaderFooterError('Variants and blocks need unique identities');
  }
  private validatePublication(state: Library, draft: HeaderFooterDraft): void {
    this.validateDraftIdentities(draft);
    if (draft.stage !== 'graphic') throw new HeaderFooterError('Review the actual graphic preview before applying the header/footer');
    if (!draft.variants.some((variant) => variant.blocks.length)) throw new HeaderFooterError('Add a header or footer block before applying');
    for (const variant of draft.variants) {
      if (variant.headerHeightMm + variant.footerHeightMm > variant.pageHeightMm * 0.45) throw new HeaderFooterError(`The recurring regions leave too little page body in ${variant.name}`);
      for (const block of variant.blocks) {
        const warnings = headerFooterBlockWarnings(block); if (warnings.length) throw new HeaderFooterError(`${variant.name}: ${warnings.join(' ')}`);
        if ((block.region === 'header' ? variant.headerHeightMm : variant.footerHeightMm) <= 0) throw new HeaderFooterError('A block needs a nonzero region height');
        if (block.assetId && !state.assets.some((asset) => asset.id === block.assetId)) throw new HeaderFooterError('A selected logo is no longer available');
        if (block.assetId && state.searches.some((search) => search.status !== 'ready' && search.assetIds.includes(block.assetId!))) throw new HeaderFooterError('Resolve the logo candidate in the collection before applying this design', 409, 'HEADER_FOOTER_LOGO_UNRESOLVED');
        // Catch text that cannot fit even a single line; final rendering performs document-local fit checks.
        const regionHeight = block.region === 'header' ? variant.headerHeightMm : variant.footerHeightMm;
        const fontMm = (block.fontSize ?? 10) * 25.4 / 72;
        if ((block.kind === 'text' || block.kind === 'field') && regionHeight * block.height < fontMm * 1.05) throw new HeaderFooterError(`Text height does not fit ${variant.name}; enlarge the block or reduce its type size`);
      }
    }
    const overflow = headerFooterTextOverflow(draft.variants);
    if (overflow) throw new HeaderFooterError(`Il testo “${overflow.value.slice(0, 70)}” non entra nella fascia ${overflow.variantName}. Allarga il blocco o riduci il carattere prima di applicare.`, 409, 'HEADER_FOOTER_TEXT_OVERFLOW');
  }
  private binding(state: Library, documentId: string, input: ApplyHeaderFooterRequest, revision: HeaderFooterRevision): HeaderFooterBinding {
    const previous = state.bindings.find((item) => item.documentId === documentId);
    if (input.expectedBindingVersion !== undefined) this.conflict((previous?.version ?? 0) !== input.expectedBindingVersion, 'This document’s header/footer selection changed elsewhere');
    return { documentId, setId: input.setId, followUpdates: input.followUpdates, header: input.header, footer: input.footer, showOnCover: input.showOnCover,
      version: (previous?.version ?? 0) + 1, appliedRevision: previous?.appliedRevision ?? null, snapshot: previous?.snapshot ?? null,
      pendingRevision: revision.id, status: 'pending', updatedAt: this.time() };
  }
  private supersedePending(state: Library, documentId: string): void {
    for (const transaction of state.transactions) {
      for (const target of transaction.documents) if (target.documentId === documentId && target.status === 'pending') { target.status = 'superseded'; delete target.error; }
      if (!transaction.documents.some((target) => target.status === 'pending')) transaction.status = 'applied';
    }
  }
  private async validateTargets(revision: HeaderFooterRevision, bindings: HeaderFooterBinding[]): Promise<ProjectDocument[]> {
    const documents: ProjectDocument[] = [];
    for (const binding of bindings) {
      const document = await this.document(binding.documentId); documents.push(document);
      if (document.archivedAt || document.availability !== 'available') continue;
      const first = this.options.formats ? null : await this.options.format?.(document), formats = this.options.formats ? await this.options.formats(document) : first ? [first] : [];
      for (const format of formats) {
        const variant = headerFooterVariantForFormat(revision.variants, format.widthMm, format.heightMm);
        if (!variant) throw new HeaderFooterError(`Adapt the header/footer to ${document.name} (${format.widthMm} × ${format.heightMm} mm) before applying`, 409, 'HEADER_FOOTER_FORMAT_REQUIRED');
        for (const region of ['header', 'footer'] as const) if (binding[region] && !variant.blocks.some((block) => block.region === region)) throw new HeaderFooterError(`Add the enabled ${region} to the ${variant.name} version for ${document.name}, or disable that region explicitly`, 409, 'HEADER_FOOTER_REGION_EMPTY');
      }
      await this.options.validateApply?.(document, binding, revision);
    }
    return documents;
  }
  private async revision(setId: string, id: number): Promise<HeaderFooterRevision> {
    if (!Number.isInteger(id) || id <= 0) throw new HeaderFooterError('Choose a published revision'); HeaderFooterIdSchema.parse(setId);
    const target = path.join(this.root, 'revisions', `${setId}-${id}.json`);
    try { const info = await lstat(target); if (info.isSymbolicLink() || !info.isFile() || info.size > 5_000_000) throw new HeaderFooterError('Invalid published revision'); return JSON.parse(await readFile(target, 'utf8')) as HeaderFooterRevision; }
    catch (error) { if (absent(error)) throw new HeaderFooterError('Published revision not found', 404); throw error; }
  }
  private async persistRevision(revision: HeaderFooterRevision): Promise<HeaderFooterRevision> {
    const target = path.join(this.root, 'revisions', `${revision.setId}-${revision.id}.json`);
    try {
      const previous = await this.revision(revision.setId, revision.id);
      const identity = (value: HeaderFooterRevision) => JSON.stringify({ name: value.name, guidance: value.guidance, variants: value.variants, originDocumentId: value.originDocumentId });
      if (identity(previous) === identity(revision)) return previous;
      // A crash before the library transaction was committed can leave an unreferenced revision file.
      // Preserve it as recovery evidence; it was never published or used by a binding.
      await rename(target, `${target}.unpublished-${randomUUID()}`);
    } catch (error) { if (!(error instanceof HeaderFooterError && error.statusCode === 404)) throw error; }
    await this.atomic(target, revision, true); return revision;
  }
  private async assetMetadata(state: Library, id: string): Promise<HeaderFooterAsset | null> {
    const current = state.assets.find((asset) => asset.id === id); if (current) return current;
    try { return JSON.parse(await readFile(path.join(this.root, 'assets', `${HeaderFooterIdSchema.parse(id)}.metadata.json`), 'utf8')) as HeaderFooterAsset; }
    catch (error) { if (!absent(error)) throw error; }
    // Older saved assets remain recoverable through the immutable library saves.
    for (const entry of state.history.filter((item) => item.action === 'asset-save')) {
      const saved = JSON.parse(await readFile(path.join(this.root, 'recovery', `${entry.id}.json`), 'utf8')) as Library;
      const asset = saved.assets.find((item) => item.id === id); if (asset) return asset;
    }
    return null;
  }
  private async recoverDraftAssets(state: Library, draft: HeaderFooterDraft): Promise<void> {
    for (const id of new Set(draft.variants.flatMap((variant) => variant.blocks.flatMap((block) => block.kind === 'logo' && block.assetId ? [block.assetId] : [])))) {
      if (state.assets.some((asset) => asset.id === id)) continue;
      const asset = await this.assetMetadata(state, id); if (!asset) throw new HeaderFooterError('A logo from this saved design is unavailable', 409); state.assets.push(asset);
    }
  }
  private async propagate(state: Library, transaction: HeaderFooterTransaction, revision: HeaderFooterRevision): Promise<void> {
    for (const target of transaction.documents) {
      if (target.status !== 'pending') continue;
      const binding = state.bindings.find((item) => item.documentId === target.documentId && item.pendingRevision === revision.id && item.setId === revision.setId);
      if (!binding) { target.status = 'superseded'; delete target.error; continue; }
      try {
        const document = await this.document(binding.documentId);
        if (document.archivedAt || document.availability !== 'available') throw new HeaderFooterError('The document folder is unavailable; the update will resume when it is reopened', 503);
        const proposed = { ...binding, appliedRevision: revision.id, snapshot: copy(revision), status: 'applied' as const }; delete proposed.pendingRevision;
        const result = await this.options.onApply?.(document, proposed, revision);
        Object.assign(binding, proposed, { status: result?.needsReview ? 'needs-review' : 'applied' }); delete binding.pendingRevision; delete binding.error;
        target.status = result?.needsReview ? 'needs-review' : 'applied'; delete target.error;
      } catch (error) { target.error = error instanceof Error ? error.message : String(error); binding.error = target.error; binding.status = 'pending'; }
      await this.write(state, { action: 'document-apply', setId: revision.setId, documentIds: [target.documentId], revision: revision.id, ...(transaction.originDocumentId ? { originDocumentId: transaction.originDocumentId } : {}) });
    }
    transaction.status = transaction.documents.some((item) => item.status === 'pending') ? 'pending' : 'applied'; await this.write(state);
  }
  async publish(setId: string, input: PublishHeaderFooterRequest): Promise<HeaderFooterWorkspaceResponse> {
    return this.serial(async () => {
      const request = PublishHeaderFooterRequestSchema.parse(input), state = await this.read(), set = this.set(state, setId);
      if (set.archivedAt) throw new HeaderFooterError('Restore this archived design to the library before publishing changes', 409);
      this.conflict(set.draftVersion !== request.expectedDraftVersion || set.revision !== request.expectedRevision, 'The shared design changed elsewhere. Reload before publishing.');
      this.validatePublication(state, set.draft); if (request.originDocumentId) await this.document(request.originDocumentId);
      let revision: HeaderFooterRevision = { id: set.revision + 1, setId, name: set.draft.name, guidance: set.draft.guidance, stage: 'graphic', variants: copy(set.draft.variants), createdAt: this.time(), ...(request.originDocumentId ? { originDocumentId: request.originDocumentId } : {}) };
      const targets: HeaderFooterBinding[] = state.bindings.filter((item) => item.setId === setId && item.followUpdates && item.status !== 'disabled').map((item) => ({ ...item, pendingRevision: revision.id, status: 'pending' as const, version: item.version + 1, updatedAt: this.time() }));
      if (request.binding) {
        await this.document(request.binding.documentId);
        const binding = this.binding(state, request.binding.documentId, { ...request.binding, setId }, revision);
        const previousIndex = targets.findIndex((item) => item.documentId === binding.documentId); if (previousIndex >= 0) targets[previousIndex] = binding; else targets.push(binding);
      }
      await this.validateTargets(revision, targets);
      revision = await this.persistRevision(revision);
      set.revision = revision.id; set.publishedRevision = revision; set.updatedAt = this.time();
      // A corrected publication replaces only the destinations it actually targets.
      // Older revisions and their recovery history remain immutable; independent
      // pending selections keep their own transaction and can still be retried.
      for (const binding of targets) { this.supersedePending(state, binding.documentId); state.bindings = state.bindings.filter((item) => item.documentId !== binding.documentId); state.bindings.push(binding); }
      const transaction: HeaderFooterTransaction = { id: randomUUID(), setId, revision: revision.id, createdAt: this.time(), status: 'applying', documents: targets.map((item) => ({ documentId: item.documentId, status: 'pending' })), ...(request.originDocumentId ? { originDocumentId: request.originDocumentId } : {}) };
      state.transactions.unshift(transaction); await this.write(state, { action: 'publish', setId, revision: revision.id, documentIds: targets.map((item) => item.documentId), ...(request.originDocumentId ? { originDocumentId: request.originDocumentId } : {}) });
      await this.propagate(state, transaction, revision); return this.workspace(state);
    });
  }
  async validate(setId: string, input: ValidateHeaderFooterRequest = {}): Promise<ValidateHeaderFooterResponse> {
    return this.serial(async () => {
      const request = ValidateHeaderFooterRequestSchema.parse(input), state = await this.read(), set = this.set(state, setId);
      if (request.expectedDraftVersion !== undefined) this.conflict(set.draftVersion !== request.expectedDraftVersion, 'This draft changed elsewhere. Reload before validating.');
      this.validatePublication(state, set.draft);
      const revision: HeaderFooterRevision = { id: set.revision + 1, setId, name: set.draft.name, guidance: set.draft.guidance, stage: 'graphic', variants: copy(set.draft.variants), createdAt: this.time() };
      const targets = state.bindings.filter((item) => item.setId === setId && item.followUpdates && item.status !== 'disabled').map(copy);
      if (request.documentId && !targets.some((item) => item.documentId === request.documentId)) {
        const document = await this.document(request.documentId), previous = state.bindings.find((item) => item.documentId === document.id && item.setId === setId);
        targets.push(previous ? copy(previous) : this.binding(state, document.id, { setId, followUpdates: true, header: document.presentation?.header ?? true, footer: document.presentation?.footer ?? true, showOnCover: false }, revision));
      }
      await this.validateTargets(revision, targets);
      return { valid: true, setId, draftVersion: set.draftVersion, documentIds: targets.map((item) => item.documentId) };
    });
  }
  async apply(documentId: string, input: ApplyHeaderFooterRequest): Promise<HeaderFooterWorkspaceResponse> {
    return this.serial(async () => {
      const request = ApplyHeaderFooterRequestSchema.parse(input), state = await this.read(), set = this.set(state, request.setId); await this.document(documentId);
      if (set.archivedAt) throw new HeaderFooterError('Choose an active header/footer design', 409);
      const revision = await this.revision(set.id, request.revision ?? set.revision), binding = this.binding(state, documentId, request, revision);
      await this.validateTargets(revision, [binding]); this.supersedePending(state, documentId); state.bindings = state.bindings.filter((item) => item.documentId !== documentId); state.bindings.push(binding);
      const transaction: HeaderFooterTransaction = { id: randomUUID(), setId: set.id, revision: revision.id, createdAt: this.time(), status: 'applying', documents: [{ documentId, status: 'pending' }], originDocumentId: documentId };
      state.transactions.unshift(transaction); await this.write(state, { action: 'bind', setId: set.id, documentIds: [documentId], revision: revision.id, originDocumentId: documentId });
      await this.propagate(state, transaction, revision); return this.workspace(state);
    });
  }
  async detach(documentId: string, expectedBindingVersion: number): Promise<HeaderFooterWorkspaceResponse> {
    return this.serial(async () => {
      await this.document(documentId); const state = await this.read(), binding = state.bindings.find((item) => item.documentId === documentId);
      if (!binding) throw new HeaderFooterError('This document has no header/footer selection', 404);
      this.conflict(binding.version !== expectedBindingVersion, 'This selection changed elsewhere');
      this.conflict(binding.status === 'pending', 'Finish the pending update before making an independent copy');
      binding.followUpdates = false; binding.version++; binding.updatedAt = this.time();
      await this.write(state, { action: 'detach', ...(binding.setId ? { setId: binding.setId } : {}), documentIds: [documentId], ...(binding.appliedRevision ? { revision: binding.appliedRevision } : {}) }); return this.workspace(state);
    });
  }
  async disable(documentId: string, expectedBindingVersion: number): Promise<HeaderFooterWorkspaceResponse> {
    return this.serial(async () => {
      const document = await this.document(documentId), state = await this.read(), previous = state.bindings.find((item) => item.documentId === documentId);
      this.conflict((previous?.version ?? 0) !== expectedBindingVersion, 'This selection changed elsewhere');
      const binding: HeaderFooterBinding = { documentId, setId: null, followUpdates: false, header: false, footer: false, showOnCover: false, version: (previous?.version ?? 0) + 1, appliedRevision: null, snapshot: null, status: 'disabled', updatedAt: this.time() };
      await this.options.onApply?.(document, binding, null); this.supersedePending(state, documentId); state.bindings = state.bindings.filter((item) => item.documentId !== documentId); state.bindings.push(binding);
      await this.write(state, { action: 'disable', documentIds: [documentId] }); return this.workspace(state);
    });
  }
  async retry(): Promise<HeaderFooterWorkspaceResponse> { return this.serial(async () => { const state = await this.read(); for (const transaction of [...state.transactions].reverse()) if (transaction.status !== 'applied') await this.propagate(state, transaction, await this.revision(transaction.setId, transaction.revision)); return this.workspace(state); }); }
  async restore(setId: string, input: RestoreHeaderFooterRequest): Promise<HeaderFooterWorkspaceResponse> {
    const request = RestoreHeaderFooterRequestSchema.parse(input);
    await this.options.beforeRestore?.();
    if (request.documentId) {
      const current = await this.list(), set = current.sets.find((item) => item.id === setId);
      this.conflict(!set || set.revision !== request.expectedRevision || set.draftVersion !== request.expectedDraftVersion, 'The design changed before restore');
      const binding = current.bindings.find((item) => item.documentId === request.documentId);
      return this.apply(request.documentId, { setId, revision: request.revision, followUpdates: false, header: binding?.header ?? true, footer: binding?.footer ?? true, showOnCover: binding?.showOnCover ?? false, expectedBindingVersion: binding?.version ?? 0 });
    }
    const saved = await this.serial(async () => { const state = await this.read(), set = this.set(state, setId); this.conflict(set.revision !== request.expectedRevision || set.draftVersion !== request.expectedDraftVersion, 'The shared design changed before restore'); const revision = await this.revision(setId, request.revision); set.draft = { version: 1, name: revision.name, guidance: revision.guidance, stage: 'graphic', variants: copy(revision.variants) }; await this.recoverDraftAssets(state, set.draft); set.draftVersion++; await this.write(state, { action: 'restore-draft', setId, documentIds: [], revision: request.revision }); return set.draftVersion; });
    return this.publish(setId, { expectedDraftVersion: saved, expectedRevision: request.expectedRevision, stage: 'graphic-approved', ...(request.originDocumentId ? { originDocumentId: request.originDocumentId } : {}) });
  }
  async revisionHistory(setId: string): Promise<HeaderFooterRevision[]> { return this.serial(async () => { const state = await this.read(), set = this.set(state, setId), result: HeaderFooterRevision[] = []; for (let revision = 1; revision <= set.revision; revision++) result.push(await this.revision(setId, revision)); return copy(result.reverse()); }); }
  async draftHistory(setId: string): Promise<HeaderFooterDraftVersion[]> { return this.serial(async () => { const state = await this.read(); this.set(state, setId); const result: HeaderFooterDraftVersion[] = []; for (const entry of state.history.filter((item) => item.setId === setId && ['create', 'draft-save', 'restore-draft'].includes(item.action))) { const saved = JSON.parse(await readFile(path.join(this.root, 'recovery', `${entry.id}.json`), 'utf8')) as Library; const set = saved.sets.find((item) => item.id === setId); if (set) result.push({ id: entry.id, draft: set.draft, draftVersion: set.draftVersion, createdAt: entry.createdAt }); } return copy(result); }); }
  async restoreDraft(setId: string, entryId: string, expectedDraftVersion: number): Promise<HeaderFooterWorkspaceResponse> { await this.options.beforeRestore?.(); return this.serial(async () => { const state = await this.read(), set = this.set(state, setId); this.conflict(set.draftVersion !== expectedDraftVersion, 'The draft changed before restore'); const entry = state.history.find((item) => item.id === entryId && item.setId === setId && ['create', 'draft-save', 'restore-draft'].includes(item.action)); if (!entry) throw new HeaderFooterError('Saved draft not found in this design', 404); const recovered = JSON.parse(await readFile(path.join(this.root, 'recovery', `${entry.id}.json`), 'utf8')) as Library; const saved = recovered.sets.find((item) => item.id === setId); if (!saved) throw new HeaderFooterError('Saved draft is unavailable', 404); set.draft = copy(saved.draft); await this.recoverDraftAssets(state, set.draft); set.name = set.draft.name; set.draftVersion++; set.updatedAt = this.time(); await this.write(state, { action: 'restore-draft', setId, documentIds: [] }); return this.workspace(state); }); }
  async assetDirectory(): Promise<string> { await this.initialize(); return path.join(this.root, 'assets'); }
  async recordUploadErrors(errors: { name: string; error: string }[]): Promise<void> { if (!errors.length) return; return this.serial(async () => { const state = await this.read(); state.uploadErrors = [...errors.map((item) => ({ name: item.name.slice(0, 240), error: item.error.slice(0, 1800), createdAt: this.time() })), ...(state.uploadErrors ?? [])].slice(0, 100); await this.write(state, { action: 'asset-upload-error', documentIds: [] }); }); }
  async addAsset(input: Omit<HeaderFooterAsset, 'id' | 'sha256' | 'size' | 'createdAt' | 'url'>, bytes: Buffer): Promise<HeaderFooterAsset> {
    return this.serial(async () => {
      if (!bytes.length || bytes.length > 25_000_000 || !['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'].includes(input.mimeType)) throw new HeaderFooterError('Choose a supported logo smaller than 25 MB', 413);
      const state = await this.read(), hash = createHash('sha256').update(bytes).digest('hex'), existing = state.assets.find((item) => item.sha256 === hash && item.sourceUrl === input.sourceUrl);
      if (existing) return copy(existing);
      const id = randomUUID(), filename = path.basename(input.filename).replace(/[\x00-\x1f]/g, '').slice(0, 240);
      const asset: HeaderFooterAsset = { ...input, name: input.name.slice(0, 240), filename, id, sha256: hash, size: bytes.length, createdAt: this.time(), url: `/api/projects/${encodeURIComponent(this.identity)}/header-footer/assets/${id}/content` };
      const output = await open(path.join(this.root, 'assets', id), 'wx', 0o600); try { await output.writeFile(bytes); await output.sync(); } finally { await output.close(); }
      await this.atomic(path.join(this.root, 'assets', `${id}.metadata.json`), asset, true);
      state.assets.push(asset); await this.write(state, { action: 'asset-save', documentIds: [] }); return copy(asset);
    });
  }
  // Immutable asset reads also work from onApply while the publication lock is held.
  async readAsset(id: string): Promise<{ asset: HeaderFooterAsset; path: string }> { await this.initialize(); HeaderFooterIdSchema.parse(id); const asset = await this.assetMetadata(await this.read(), id); if (!asset) throw new HeaderFooterError('Logo not found in this project', 404); const target = path.join(this.root, 'assets', id), info = await lstat(target); if (!info.isFile() || info.isSymbolicLink()) throw new HeaderFooterError('Logo file is unavailable', 503); return { asset: copy(asset), path: target }; }
  async removeAsset(id: string): Promise<HeaderFooterWorkspaceResponse> { return this.serial(async () => { HeaderFooterIdSchema.parse(id); const state = await this.read(); if (!state.assets.some((item) => item.id === id)) throw new HeaderFooterError('Logo not found', 404); if (state.sets.some((set) => set.draft.variants.some((variant) => variant.blocks.some((block) => block.assetId === id))) || state.bindings.some((binding) => binding.snapshot?.variants.some((variant) => variant.blocks.some((block) => block.assetId === id)))) throw new HeaderFooterError('This logo is used by a design. Replace it there before removing it from the collection', 409); state.assets = state.assets.filter((item) => item.id !== id); await this.write(state, { action: 'asset-remove', documentIds: [] }); return this.workspace(state); }); }
  async listSearches(): Promise<HeaderFooterSearch[]> { return (await this.list()).searches; }
  async getSearch(id: string): Promise<HeaderFooterSearch> { const search = (await this.listSearches()).find((item) => item.id === id); if (!search) throw new HeaderFooterError('Logo search not found', 404); return search; }
  async createSearch(input: HeaderFooterSearchRequest): Promise<HeaderFooterSearch> { return this.serial(async () => { const request = HeaderFooterSearchRequestSchema.parse(input), state = await this.read(), time = this.time(); const search: HeaderFooterSearch = { target: request.target, ...(request.website ? { website: request.website } : {}), ...(request.guidance ? { guidance: request.guidance } : {}), id: randomUUID(), status: 'queued', model: 'gpt-6.1-sol', effort: 'low', attempt: 0, assetIds: [], createdAt: time, updatedAt: time }; state.searches.push(search); await this.write(state, { action: 'logo-search-created', documentIds: [] }); return copy(search); }); }
  async updateSearch(id: string, input: Partial<HeaderFooterSearch>): Promise<HeaderFooterSearch> { return this.serial(async () => { const state = await this.read(), search = state.searches.find((item) => item.id === id); if (!search) throw new HeaderFooterError('Logo search not found', 404); Object.assign(search, input, { id: search.id, model: 'gpt-6.1-sol', effort: 'low', createdAt: search.createdAt, updatedAt: this.time() }); await this.write(state, { action: 'logo-search-update', documentIds: [] }); return copy(search); }); }
}
