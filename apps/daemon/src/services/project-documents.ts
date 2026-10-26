import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile, realpath, rename, stat, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { CreateProjectDocumentRequestSchema, ProjectDocumentIdSchema, ProjectDocumentSchema, UpdateProjectDocumentRequestSchema, blockoutComparisonFilePath, blockoutWorkspacePath, createDocumentPresentation, type CreateProjectDocumentRequest, type ProjectDocument, type ProjectDocumentContextResponse, type ProjectDocumentMutationResponse, type ProjectDocumentsResponse, type ProjectDocumentWorkspaceBootstrap, type ProjectDocumentWorkspaceResult, type UpdateProjectDocumentRequest } from '@open-design/contracts';
import { listBlockoutWorkspaces, readBlockoutWorkspace } from './blockout-workspaces.js';
import { createDocumentDirectory, documentContextFiles, documentFolderInside, documentRelativePath, ProjectDocumentError, safeDocumentPath, sameDocumentFolder, validateDocumentDirectory } from './project-document-folders.js';

export { ProjectDocumentError } from './project-document-folders.js';
interface CreationRequest { requestId: string; documentId: string; fingerprint: string; input: CreateProjectDocumentRequest; startedAt: string; completed?: boolean }
interface Registry { version: 1; projectId: string; documents: ProjectDocument[]; selectedDocumentId: string | null; provisionalDocumentIds?: string[]; creationRequests?: CreationRequest[] }
export type ProjectDocumentBootstrap = (input: ProjectDocumentWorkspaceBootstrap) => Promise<ProjectDocumentWorkspaceResult>;
export interface InitialProjectDocument { id: string; name: string; presentation?: ProjectDocument['presentation']; documentType?: ProjectDocument['documentType']; conversationIds?: string[]; preparationConversationIds?: string[]; provisional?: boolean }
const pending = new Map<string, Promise<unknown>>();
const creations = new Map<string, { fingerprint: string; task: Promise<ProjectDocumentMutationResponse> }>();
const registryRelativePath = (projectId: string) => `project-documents/${createHash('sha256').update(projectId).digest('hex')}`;

async function readRegistry(target: string, projectId: string): Promise<Registry> {
  try {
    const info = await lstat(target); if (!info.isFile() || info.isSymbolicLink() || info.size > 4_000_000) throw new ProjectDocumentError('Invalid document registry');
    const value = JSON.parse(await readFile(target, 'utf8')) as Registry;
    if (value.version !== 1 || value.projectId !== projectId || !Array.isArray(value.documents) || value.documents.length > 1000 || !(value.selectedDocumentId === null || typeof value.selectedDocumentId === 'string')) throw new ProjectDocumentError('Invalid document registry');
    const documents = value.documents.map((item) => ProjectDocumentSchema.parse(item));
    if (value.creationRequests !== undefined && (!Array.isArray(value.creationRequests) || value.creationRequests.length > 1000)) throw new ProjectDocumentError('Invalid document creation registry');
    for (const creation of value.creationRequests ?? []) {
      if (!creation || !CreateProjectDocumentRequestSchema.safeParse(creation.input).success || creation.input.requestId !== creation.requestId || !ProjectDocumentIdSchema.safeParse(creation.documentId).success || typeof creation.fingerprint !== 'string' || typeof creation.startedAt !== 'string') throw new ProjectDocumentError('Invalid document creation registry');
    }
    if (value.provisionalDocumentIds !== undefined && (!Array.isArray(value.provisionalDocumentIds) || value.provisionalDocumentIds.length > 1000 || value.provisionalDocumentIds.some((id) => !documents.some((item) => item.id === id)))) throw new ProjectDocumentError('Invalid provisional document registry');
    if (new Set(documents.map((item) => item.id)).size !== documents.length || documents.some((item) => item.projectId !== projectId) || (value.selectedDocumentId && !documents.some((item) => item.id === value.selectedDocumentId && !item.archivedAt))) throw new ProjectDocumentError('Invalid document registry ownership');
    return { ...value, documents };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, projectId, documents: [], selectedDocumentId: null }; throw error; }
}

/** Reads persisted associations only: no seeding, directories or alias repair. */
export async function readProjectDocumentsSnapshot(dataRoot: string, projectId: string): Promise<readonly ProjectDocument[]> {
  if (!path.isAbsolute(dataRoot) || !projectId || projectId.length > 240) throw new ProjectDocumentError('Explicit daemon root and project are required');
  let root: string;
  try { root = await realpath(dataRoot); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const target = await safeDocumentPath(root, `${registryRelativePath(projectId)}/registry.json`);
  return (await readRegistry(target, projectId)).documents;
}

function stableRequest(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

/** The CLI's optional subtype uses the document name as the setup fallback.
 * Normalize before both workspace bootstrap and registry commit so the later
 * setup reconciliation receives the same valid type that bootstrap accepted. */
function normalizeDocumentType(value: ProjectDocument['documentType'], name: string): ProjectDocument['documentType'] {
  return value ? { ...value, subtype: value.subtype || (value.kind === 'free' ? '' : name) } : undefined;
}

/** App-owned names and associations; document contents remain in their registered folders. */
export class ProjectDocumentsStore {
  private registryRoot = '';
  private root = '';
  private dataRoot = '';
  private readonly now: () => number;
  constructor(private readonly options: { dataRoot: string; projectId: string; projectRoot: string; now?: () => number; initialDocuments?: InitialProjectDocument[];
    ensureEditingConversations?: (document: ProjectDocument, documents: readonly ProjectDocument[]) => Promise<Pick<ProjectDocument, 'conversationIds' | 'preparationConversationIds'>> }) {
    if (!path.isAbsolute(options.dataRoot) || !path.isAbsolute(options.projectRoot) || !options.projectId || options.projectId.length > 240) throw new ProjectDocumentError('Explicit project and daemon roots are required');
    this.now = options.now ?? Date.now;
  }
  private async serial<T>(work: () => Promise<T>): Promise<T> {
    const key = `${path.resolve(this.options.dataRoot)}\0${this.options.projectId}`;
    const task = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => { await this.initialize(); return work(); }); pending.set(key, task);
    try { return await task; } finally { if (pending.get(key) === task) pending.delete(key); }
  }
  private async initialize(): Promise<void> {
    if (this.registryRoot) return;
    this.root = await realpath(this.options.projectRoot);
    if ((await lstat(this.options.projectRoot)).isSymbolicLink() || !(await stat(this.root)).isDirectory()) throw new ProjectDocumentError('Choose a real project folder');
    // The root is supplied by the daemon, not a client-provided context path.
    const { mkdir } = await import('node:fs/promises'); await mkdir(this.options.dataRoot, { recursive: true });
    this.dataRoot = await realpath(this.options.dataRoot);
    const relative = registryRelativePath(this.options.projectId);
    if (documentFolderInside(this.root, path.join(this.dataRoot, relative))) throw new ProjectDocumentError('The app document registry must stay outside the user project');
    this.registryRoot = await createDocumentDirectory(this.dataRoot, relative);
    await createDocumentDirectory(this.registryRoot, 'links');
  }
  private async read(): Promise<Registry> {
    return readRegistry(path.join(this.registryRoot, 'registry.json'), this.options.projectId);
  }
  private async write(registry: Registry): Promise<void> {
    const target = path.join(this.registryRoot, 'registry.json'), temporary = path.join(this.registryRoot, `registry-${randomUUID()}.tmp`);
    const content = `${JSON.stringify(registry, null, 2)}\n`; if (Buffer.byteLength(content) > 4_000_000) throw new ProjectDocumentError('Document registry exceeds its size limit', 413);
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
    try { await rename(temporary, target); } finally { await unlink(temporary).catch(() => undefined); }
  }
  private async folder(input: CreateProjectDocumentRequest['location'], documentId: string): Promise<{ workingDirectory: string; folderMode: ProjectDocument['folderMode'] }> {
    if (input?.mode === 'link-existing') return { workingDirectory: await validateDocumentDirectory(input.path, this.dataRoot, this.root), folderMode: 'linked' };
    return { workingDirectory: await createDocumentDirectory(this.root, `documents/${ProjectDocumentIdSchema.parse(documentId)}`), folderMode: 'managed' };
  }
  private async available(document: ProjectDocument): Promise<ProjectDocument> {
    const { availabilityMessage: _message, aliasPath: _alias, ...value } = document;
    try {
      const info = await lstat(document.workingDirectory);
      if (!info.isDirectory() || info.isSymbolicLink() || !sameDocumentFolder(await realpath(document.workingDirectory), document.workingDirectory)) throw new Error('The registered directory is linked or changed');
    } catch { return { ...value, availability: 'unavailable', availabilityMessage: 'La cartella registrata non è disponibile. Collega la nuova posizione per ritrovare questo documento.' }; }
    if (document.folderMode !== 'linked') return { ...value, availability: 'available' };
    const alias = path.join(this.registryRoot, 'links', document.id);
    try {
      const existing = await lstat(alias).catch((error) => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
      if (existing && !existing.isSymbolicLink()) throw new Error('The alias is not a registry link');
      if (existing && !sameDocumentFolder(await realpath(alias).catch(() => ''), document.workingDirectory)) await unlink(alias);
      if (!existing || !sameDocumentFolder(await realpath(alias).catch(() => ''), document.workingDirectory)) await symlink(document.workingDirectory, alias, process.platform === 'win32' ? 'junction' : 'dir');
      return { ...value, availability: 'available', aliasPath: alias };
    } catch { return { ...value, availability: 'broken-link', aliasPath: alias, availabilityMessage: 'La cartella esiste, ma il collegamento nell’app richiede riparazione. Riprova a collegare la cartella.' }; }
  }
  private async seed(registry: Registry): Promise<void> {
    const catalog = await listBlockoutWorkspaces(this.root); let changed = false;
    for (const item of catalog.documents) {
      const workspace = await readBlockoutWorkspace(this.root, item.id);
      if (!workspace.document && !item.title.trim()) continue;
      const existing = registry.documents.find((record) => record.blockoutDocumentId === item.id || record.id === item.id);
      if (existing) { if (!existing.blockoutDocumentId && workspace.document) { existing.blockoutDocumentId = item.id; changed = true; } continue; }
      const title = item.title.trim() || workspace.document?.title.trim() || 'Documento';
      let directory: string;
      const comparisonFile = blockoutComparisonFilePath({ title, documentId: item.id }), comparison = path.posix.dirname(comparisonFile);
      try {
        const candidate = path.join(this.root, ...comparison.split('/'));
        if (!(await lstat(candidate)).isDirectory()) throw new Error('Missing folder');
        directory = await validateDocumentDirectory(candidate, this.dataRoot, this.root);
      } catch { directory = this.root; }
      const time = new Date(this.now()).toISOString();
      const entryFile = await safeDocumentPath(this.root, comparisonFile).then(async (target) => (await stat(target)).isFile() ? comparisonFile : undefined).catch(() => undefined);
      registry.documents.push({ id: item.id, projectId: this.options.projectId, workspaceProjectId: this.options.projectId, name: title, kind: 'document', workingDirectory: directory, folderMode: 'managed', availability: 'available', blockoutDocumentId: item.id, ...(entryFile ? { entryFile } : {}), conversationIds: [], ...(workspace.document?.presentation ? { presentation: workspace.document.presentation } : {}), createdAt: time, updatedAt: time, archivedAt: null }); changed = true;
    }
    for (const initial of this.options.initialDocuments ?? []) {
      if (registry.documents.some((item) => item.id === initial.id)) continue;
      // A generic pre-Blockout intent represents the first output only. Do not
      // add a phantom document-1 beside an already named legacy catalog.
      if (initial.provisional && registry.documents.length) continue;
      const time = new Date(this.now()).toISOString();
      registry.documents.push(ProjectDocumentSchema.parse({ id: initial.id, projectId: this.options.projectId, workspaceProjectId: this.options.projectId, name: initial.name, kind: 'document', workingDirectory: this.root, folderMode: 'managed', availability: 'available', conversationIds: initial.conversationIds ?? [], ...(initial.preparationConversationIds?.length ? { preparationConversationIds: initial.preparationConversationIds } : {}), presentation: initial.presentation ?? createDocumentPresentation(initial.name), ...(initial.documentType ? { documentType: initial.documentType } : {}), createdAt: time, updatedAt: time, archivedAt: null })); changed = true;
      if (initial.provisional) registry.provisionalDocumentIds = [...(registry.provisionalDocumentIds ?? []), initial.id];
    }
    const explicit = (this.options.initialDocuments ?? []).filter((item) => !item.provisional);
    if (explicit.length && registry.provisionalDocumentIds?.length) {
      for (const id of registry.provisionalDocumentIds) {
        const record = registry.documents.find((item) => item.id === id);
        if (!record || explicit.some((item) => item.id === id) || record.blockoutDocumentId || record.archivedAt) continue;
        record.archivedAt = new Date(this.now()).toISOString(); record.updatedAt = record.archivedAt;
        if (registry.selectedDocumentId === id) registry.selectedDocumentId = null;
      }
      registry.provisionalDocumentIds = []; changed = true;
    }
    // The runtime supplies this callback only on an authorized mutation/open.
    // Listing a collection, including by a shared read-only viewer, never creates chats.
    const previousBindings = registry.documents.map((document) => ({ ...document, conversationIds: [...document.conversationIds] }));
    if (this.options.ensureEditingConversations) for (const document of registry.documents) {
      if (document.archivedAt || document.workspaceProjectId !== this.options.projectId
        || (registry.provisionalDocumentIds?.includes(document.id) && !document.blockoutDocumentId)) continue;
      const binding = await this.options.ensureEditingConversations(document, previousBindings);
      if (JSON.stringify(binding.conversationIds) !== JSON.stringify(document.conversationIds)
        || JSON.stringify(binding.preparationConversationIds ?? []) !== JSON.stringify(document.preparationConversationIds ?? [])) {
        Object.assign(document, binding); document.updatedAt = new Date(this.now()).toISOString(); changed = true;
      }
    }
    if (changed && !registry.selectedDocumentId) { const first = registry.documents.find((item) => !item.archivedAt); if (first) registry.selectedDocumentId = first.id; }
    if (changed) await this.write(registry);
  }
  private find(registry: Registry, documentId: string): ProjectDocument {
    ProjectDocumentIdSchema.parse(documentId);
    const document = registry.documents.find((item) => item.id === documentId);
    if (!document) throw new ProjectDocumentError('Document not found in this project', 404);
    return document;
  }
  async list(options: { includeArchived?: boolean } = {}): Promise<ProjectDocumentsResponse> {
    return this.serial(async () => { const registry = await this.read(); await this.seed(registry); const pendingCreations = registry.creationRequests?.filter((item) => !item.completed).map((item) => ({ requestId: item.requestId, documentId: item.documentId, name: item.input.name, startedAt: item.startedAt, request: item.input })); return { documents: await Promise.all(registry.documents.filter((item) => options.includeArchived || !item.archivedAt).map((item) => this.available(item))), selectedDocumentId: registry.selectedDocumentId, ...(pendingCreations?.length ? { pendingCreations } : {}) }; });
  }
  async get(documentId: string): Promise<ProjectDocument> { return this.serial(async () => { const registry = await this.read(); await this.seed(registry); return this.available(this.find(registry, documentId)); }); }
  /** Daemon-only reconciliation after an owned setup/Blockout save. */
  async synchronize(documentId: string, fields: Pick<Partial<ProjectDocument>, 'name' | 'presentation' | 'documentType' | 'blockoutDocumentId' | 'entryFile'>): Promise<void> {
    await this.serial(async () => {
      const registry = await this.read(); await this.seed(registry); const previous = this.find(registry, documentId);
      if (fields.entryFile) documentRelativePath(fields.entryFile);
      const name = fields.name ?? previous.name, presentation = fields.presentation ?? previous.presentation;
      const document = ProjectDocumentSchema.parse({ ...previous, ...fields, ...(presentation ? { presentation: { ...presentation, name } } : {}) });
      if (JSON.stringify(previous) === JSON.stringify(document)) return;
      document.updatedAt = new Date(this.now()).toISOString(); registry.documents = registry.documents.map((item) => item.id === documentId ? document : item); await this.write(registry);
    });
  }
  async create(input: CreateProjectDocumentRequest, bootstrap: ProjectDocumentBootstrap): Promise<ProjectDocumentMutationResponse> {
    const parsed = CreateProjectDocumentRequestSchema.parse(input);
    const request = { ...parsed, requestId: parsed.requestId ?? randomUUID(), ...(parsed.documentType ? { documentType: normalizeDocumentType(parsed.documentType, parsed.name) } : {}), presentation: { ...(parsed.presentation ?? createDocumentPresentation(parsed.name)), name: parsed.name } };
    const key = `${path.resolve(this.options.dataRoot)}\0${this.options.projectId}\0${request.requestId}`;
    const fingerprint = createHash('sha256').update(stableRequest(request)).digest('hex');
    const running = creations.get(key);
    if (running) { if (running.fingerprint !== fingerprint) throw new ProjectDocumentError('This creation request already belongs to another document', 409); return running.task; }
    const task = (async () => {
      const reservation = await this.serial(async () => {
        const registry = await this.read(); await this.seed(registry);
        const previous = registry.creationRequests?.find((item) => item.requestId === request.requestId);
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw new ProjectDocumentError('This creation request already belongs to another document', 409);
          return previous;
        }
      if (registry.documents.length >= 1000) throw new ProjectDocumentError('Project document limit reached', 413);
      if (request.blockoutDocumentId && registry.documents.some((item) => item.blockoutDocumentId === request.blockoutDocumentId)) throw new ProjectDocumentError('That Blockout document is already registered', 409);
      if (request.blockoutDocumentId && !(await readBlockoutWorkspace(this.root, request.blockoutDocumentId)).document) throw new ProjectDocumentError('Blockout document not found', 404);
        const documentId = request.blockoutDocumentId ?? randomUUID();
        await this.folder(request.location, documentId);
        const reservation: CreationRequest = { requestId: request.requestId, documentId, fingerprint, input: request, startedAt: new Date(this.now()).toISOString() };
        registry.creationRequests = [...(registry.creationRequests ?? []), reservation]; await this.write(registry); return reservation;
      });
      if (reservation.completed) return this.serial(async () => { const registry = await this.read(); return { document: await this.available(this.find(registry, reservation.documentId)), selectedDocumentId: registry.selectedDocumentId }; });
      // Slow history/setup/bootstrap work must not hold the registry lock. Lists
      // can show the reserved document and retries retain its exact identity.
      const id = reservation.documentId, folder = await this.folder(request.location, id), time = reservation.startedAt;
      const workspace = await bootstrap({ projectId: this.options.projectId, documentId: id, name: request.name, kind: request.kind, workingDirectory: folder.workingDirectory, ...(request.presentation ? { presentation: request.presentation } : {}), ...(request.documentType ? { documentType: request.documentType } : {}) });
      if (!workspace.workspaceProjectId) throw new ProjectDocumentError('Document workspace was not created', 500);
      const document: ProjectDocument = { id, projectId: this.options.projectId, workspaceProjectId: workspace.workspaceProjectId, name: request.name, kind: request.kind, ...folder, availability: 'available', conversationIds: [...new Set([workspace.conversationId, request.conversationId].filter((item): item is string => !!item))], ...(request.blockoutDocumentId ? { blockoutDocumentId: request.blockoutDocumentId } : {}), ...(request.presentation ? { presentation: request.presentation } : {}), ...(request.documentType ? { documentType: request.documentType } : {}), createdAt: time, updatedAt: time, archivedAt: null };
      return this.serial(async () => {
      const registry = await this.read();
      const previous = registry.documents.find((item) => item.id === id);
      if (previous) return { document: await this.available(previous), selectedDocumentId: registry.selectedDocumentId };
      registry.documents.push(document); if (request.select !== false) registry.selectedDocumentId = id;
      const saved = registry.creationRequests?.find((item) => item.requestId === request.requestId); if (saved) saved.completed = true;
      await this.write(registry); return { document: await this.available(document), selectedDocumentId: registry.selectedDocumentId };
      });
    })();
    creations.set(key, { fingerprint, task });
    try { return await task; } finally { if (creations.get(key)?.task === task) creations.delete(key); }
  }
  async update(documentId: string, input: UpdateProjectDocumentRequest, bootstrap?: ProjectDocumentBootstrap): Promise<ProjectDocumentMutationResponse> {
    return this.serial(async () => {
      const request = UpdateProjectDocumentRequestSchema.parse(input), registry = await this.read(); await this.seed(registry); const previous = this.find(registry, documentId);
      if (request.archived && request.select) throw new ProjectDocumentError('An archived document cannot be selected');
      const requestedConversationId = request.conversationId;
      if (requestedConversationId && (previous.preparationConversationIds?.includes(requestedConversationId)
        || registry.documents.some((item) => item.id !== documentId && item.conversationIds.includes(requestedConversationId)))) {
        throw new ProjectDocumentError('Choose an exclusive editing conversation for this document', 409);
      }
      const document: ProjectDocument = { ...previous, ...(request.name === undefined ? {} : { name: request.name }), ...(request.presentation ? { presentation: request.presentation } : {}), ...(request.documentType ? { documentType: request.documentType } : {}), ...(request.location ? await this.folder(request.location, documentId) : {}), ...(request.archived === undefined ? {} : { archivedAt: request.archived ? new Date(this.now()).toISOString() : null }), conversationIds: [...new Set([...previous.conversationIds, ...(request.conversationId ? [request.conversationId] : [])])], updatedAt: new Date(this.now()).toISOString() };
      if (document.documentType) document.documentType = normalizeDocumentType(document.documentType, document.name);
      if (document.presentation && (request.name || request.presentation)) document.presentation = { ...document.presentation, name: document.name };
      if (document.archivedAt && request.select) throw new ProjectDocumentError('An archived document cannot be selected', 409);
      if (bootstrap && document.workspaceProjectId !== this.options.projectId && (request.name || request.location || request.presentation || request.documentType)) {
        const workspace = await bootstrap({ projectId: this.options.projectId, documentId, name: document.name, kind: document.kind, workingDirectory: document.workingDirectory, workspaceProjectId: document.workspaceProjectId, ...(document.presentation ? { presentation: document.presentation } : {}), ...(document.documentType ? { documentType: document.documentType } : {}) });
        if (workspace.workspaceProjectId !== document.workspaceProjectId) throw new ProjectDocumentError('A document workspace identity cannot change during update', 409);
        if (workspace.conversationId && !document.conversationIds.includes(workspace.conversationId)) document.conversationIds.push(workspace.conversationId);
      }
      registry.documents = registry.documents.map((item) => item.id === documentId ? ProjectDocumentSchema.parse(document) : item);
      if (request.select === true) registry.selectedDocumentId = documentId;
      else if ((request.select === false || document.archivedAt) && registry.selectedDocumentId === documentId) registry.selectedDocumentId = null;
      await this.write(registry); return { document: await this.available(document), selectedDocumentId: registry.selectedDocumentId };
    });
  }
  async context(documentId: string, requestedPath?: string): Promise<ProjectDocumentContextResponse> {
    return this.serial(async () => {
      const registry = await this.read(); await this.seed(registry); const document = await this.available(this.find(registry, documentId));
      if (document.archivedAt) throw new ProjectDocumentError('This document association is archived', 409);
      if (document.availability !== 'available') throw new ProjectDocumentError('Document folder is unavailable; reconnect it before reading context', 503);
      const sharedWorkspace = document.workspaceProjectId === this.options.projectId && !!document.blockoutDocumentId;
      const scoped = document.blockoutDocumentId && (sharedWorkspace || sameDocumentFolder(document.workingDirectory, this.root)) ? [blockoutWorkspacePath(document.blockoutDocumentId), `blockouts/${document.blockoutDocumentId}`, path.posix.dirname(document.entryFile ?? blockoutComparisonFilePath({ title: document.name, documentId: document.blockoutDocumentId }))] : null;
      if (requestedPath !== undefined && scoped && !scoped.some((prefix) => documentRelativePath(requestedPath) === prefix || documentRelativePath(requestedPath).startsWith(`${prefix}/`))) throw new ProjectDocumentError('This file is outside the registered document scope', 403);
      const context = await documentContextFiles(sharedWorkspace ? this.root : document.workingDirectory, requestedPath, scoped ?? undefined);
      return { document, ...context, ...(document.blockoutDocumentId ? { blockout: { documentId: document.blockoutDocumentId, workspacePath: blockoutWorkspacePath(document.blockoutDocumentId), projectId: document.workspaceProjectId, ...(document.entryFile ? { comparisonPath: document.entryFile } : {}) } } : {}) };
    });
  }
}
