import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { BLOCKOUT_START_PATH, DocumentSetupIntentSchema, ProjectDocumentIdSchema, createDocumentPresentation, isFastProject, type BlockoutDocument, type DocumentSetup, type DocumentSetupIntent, type ProjectDocument, type ProjectDocumentWorkspaceBootstrap, type ProjectDocumentWorkspaceResult, type ProjectMetadata } from '@open-design/contracts';
import { ensureWorkspaceProject, getConversation, getFirstProjectConversation, getProject, getWorkspaceProjectByProjectId, insertConversation, insertProject, listProjects, openDatabase, updateProject } from '../db.js';
import { ensureProject, resolveProjectDir } from '../projects.js';
import { readBlockoutWorkspace, saveBlockoutWorkspace } from './blockout-workspaces.js';
import { containedIntakePath } from './project-intake-settings.js';
import { readDocumentSetup, saveDocumentSetupIntent } from './document-setup.js';
import { ProjectDocumentError, ProjectDocumentsStore, type InitialProjectDocument } from './project-documents.js';
import { ProjectDocumentScopeConflict, safeDocumentPath, sameDocumentFolder } from './project-document-folders.js';

interface Options {
  dataRoot: string;
  projectsRoot: string;
  db: ReturnType<typeof openDatabase>;
  beforeWrite?(projectId: string, root: string): Promise<unknown>;
}

/** Bridges logical document identities to the existing project/file/chat APIs. */
export class ProjectDocumentsRuntime {
  constructor(private readonly options: Options) {}

  async store(projectId: string, root: string, options: { materializeConversations?: boolean } = {}): Promise<ProjectDocumentsStore> {
    const project = getProject(this.options.db, projectId);
    if (!project) throw new ProjectDocumentError('Project not found', 404);
    if (project.metadata?.collectionProjectId) throw new ProjectDocumentError('Use the parent project document library', 409);
    const setup = await readDocumentSetup(root, project.metadata?.documentSetupIntent, projectId);
    const first = getFirstProjectConversation(this.options.db, projectId);
    const conversation = first && !/^document-[a-f0-9]{40}$/.test(first.id) ? first : null;
    const intent = setup?.intent;
    const initialDocuments: InitialProjectDocument[] = intent ? (intent.editorialSettings?.length
      ? intent.editorialSettings.map((setting) => ({ id: setting.documentId, name: setting.presentation.name, presentation: setting.presentation, documentType: { kind: intent.kind, subtype: intent.subtype }, preparationConversationIds: conversation ? [conversation.id] : [] }))
      : [{ id: 'document-1', provisional: true, name: (intent.documentName || intent.subtype || intent.purpose || project.name || 'Documento').slice(0, 240), documentType: { kind: intent.kind, subtype: intent.subtype }, preparationConversationIds: conversation ? [conversation.id] : [] }]) : [];
    return new ProjectDocumentsStore({ dataRoot: this.options.dataRoot, projectId, projectRoot: root, initialDocuments,
      ...(options.materializeConversations ? { ensureEditingConversations: this.ensureEditingConversations } : {}) });
  }

  private ensureEditingConversations = async (document: ProjectDocument, documents: readonly ProjectDocument[]) => {
    const { db } = this.options, first = getFirstProjectConversation(db, document.projectId);
    const preparation = first && !/^document-[a-f0-9]{40}$/.test(first.id) ? first : null;
    const conversationIds = document.conversationIds.filter((id) => id !== preparation?.id
      && getConversation(db, id)?.projectId === document.workspaceProjectId
      && !documents.some((other) => other.id !== document.id && other.conversationIds.includes(id)));
    if (!conversationIds.length) {
      const id = `document-${createHash('sha256').update(`${document.projectId}\0${document.id}`).digest('hex').slice(0, 40)}`;
      const existing = getConversation(db, id);
      if (existing && existing.projectId !== document.workspaceProjectId) throw new ProjectDocumentError('Document conversation ownership conflict', 409);
      if (!existing) insertConversation(db, { id, projectId: document.workspaceProjectId, title: document.name,
        sessionMode: document.kind === 'design' ? 'design' : 'blockout', createdAt: Date.now(), updatedAt: Date.now() });
      conversationIds.push(id);
    }
    const preparationConversationIds = [...new Set([...(document.preparationConversationIds ?? []),
      ...document.conversationIds.filter((id) => !conversationIds.includes(id)), ...(preparation ? [preparation.id] : [])])];
    return { conversationIds, preparationConversationIds };
  };

  /** Called only after the HTTP mutation authority gate; no files/history are moved or copied. */
  openDocument = async (projectId: string, root: string, documentId: string) => {
    const store = await this.store(projectId, root, { materializeConversations: true });
    const result = await store.update(documentId, { select: true });
    const parent = getProject(this.options.db, projectId), child = getProject(this.options.db, result.document.workspaceProjectId);
    // Repair earlier child associations only on this authorised open, never as a side effect of listing.
    if (isFastProject(parent?.metadata) && child && child.id !== projectId && !isFastProject(child.metadata)) updateProject(this.options.db, child.id, { metadata: { ...child.metadata, projectMode: 'fast' } });
    return result;
  };

  authorizeConversation = (conversationId: string, allowedProjectIds: string[]): boolean => {
    const conversation = getConversation(this.options.db, conversationId);
    return !!conversation && allowedProjectIds.includes(conversation.projectId);
  };

  private async validateWriteScope(projectId: string, documentIds: unknown[]): Promise<void> {
    const ids = [...new Set(documentIds.flatMap((value) => { const parsed = ProjectDocumentIdSchema.safeParse(value); return parsed.success ? [parsed.data] : []; }))];
    if (!ids.length) return;
    const project = getProject(this.options.db, projectId); if (!project) throw new ProjectDocumentError('Project not found', 404);
    const parentId = project.metadata?.collectionProjectId ?? projectId, parent = getProject(this.options.db, parentId);
    if (!parent) throw new ProjectDocumentError('Document collection is unavailable', 409);
    const store = await this.store(parentId, resolveProjectDir(this.options.projectsRoot, parentId, parent.metadata));
    const records = (await store.list({ includeArchived: true })).documents;
    for (const id of ids) {
      const record = records.find((item) => item.id === id || item.blockoutDocumentId === id);
      if (record && record.workspaceProjectId !== projectId) throw new ProjectDocumentScopeConflict(id, record.workspaceProjectId);
    }
  }

  beforeSetupWrite = async (projectId: string, input: unknown, current?: DocumentSetup | null): Promise<void> => {
    const fields = input && typeof input === 'object' && !Array.isArray(input) ? input as { editorialSettings?: unknown } : {};
    const settings = fields.editorialSettings === undefined ? current?.intent.editorialSettings : fields.editorialSettings;
    await this.validateWriteScope(projectId, Array.isArray(settings) ? settings.map((item: unknown) => item && typeof item === 'object' && 'documentId' in item ? item.documentId : undefined) : []);
  };

  beforeBlockoutWrite = async (projectId: string, documentIds: unknown[]): Promise<void> => this.validateWriteScope(projectId, documentIds);

  setupUpdated = async (projectId: string, setup: DocumentSetup): Promise<void> => {
    const project = getProject(this.options.db, projectId); if (!project) return;
    const parentId = project.metadata?.collectionProjectId ?? projectId, parent = getProject(this.options.db, parentId); if (!parent) return;
    const store = await this.store(parentId, resolveProjectDir(this.options.projectsRoot, parentId, parent.metadata), { materializeConversations: true }), records = (await store.list()).documents;
    for (const setting of setup.intent.editorialSettings ?? []) {
      const record = records.find((item) => item.workspaceProjectId === projectId && (item.id === setting.documentId || item.blockoutDocumentId === setting.documentId || project.metadata?.collectionDocumentId === item.id));
      if (!record || record.kind !== 'document') continue;
      await store.synchronize(record.id, { name: setting.presentation.name || record.name, presentation: setting.presentation, documentType: { kind: setup.intent.kind, subtype: setup.intent.subtype } });
      // Keep existing editable pages consistent with the confirmed editorial
      // choices; do not create, delete or fill pages to satisfy a new count.
      const updated = await store.get(record.id); await this.onDocumentUpdated(updated, record);
    }
  };

  blockoutUpdated = async (projectId: string, document: BlockoutDocument, comparisonPath?: string, options?: { entryOnly?: boolean }): Promise<void> => {
    const project = getProject(this.options.db, projectId); if (!project) return;
    const parentId = project.metadata?.collectionProjectId ?? projectId, parent = getProject(this.options.db, parentId); if (!parent) return;
    const store = await this.store(parentId, resolveProjectDir(this.options.projectsRoot, parentId, parent.metadata), { materializeConversations: true }), records = (await store.list()).documents;
    const record = records.find((item) => item.workspaceProjectId === projectId && (item.id === document.documentId || item.blockoutDocumentId === document.documentId || project.metadata?.collectionDocumentId === item.id));
    if (!record) return;
    const root = resolveProjectDir(this.options.projectsRoot, projectId, project.metadata);
    const entryFile = comparisonPath && await safeDocumentPath(root, comparisonPath).then(async (target) => (await stat(target)).isFile()).catch(() => false) ? comparisonPath : undefined;
    if (options?.entryOnly) {
      // Publishing a completed design must not normalize/rewrite the open editor's workspace.
      if (entryFile) await store.synchronize(record.id, { blockoutDocumentId: document.documentId, entryFile });
      return;
    }
    await store.synchronize(record.id, { name: document.title || record.name, blockoutDocumentId: document.documentId, ...(entryFile ? { entryFile } : {}), ...(document.presentation ? { presentation: document.presentation } : {}) });
    const updated = await store.get(record.id); await this.onDocumentUpdated(updated, record);
  };

  bootstrapWorkspace = async (input: ProjectDocumentWorkspaceBootstrap): Promise<ProjectDocumentWorkspaceResult> => {
    const { db, projectsRoot } = this.options, parent = getProject(db, input.projectId);
    if (!parent || parent.metadata?.collectionProjectId) throw new ProjectDocumentError('Parent project not found', 404);
    const existing = input.workspaceProjectId ? getProject(db, input.workspaceProjectId)
      : listProjects(db).find((project) => project.metadata?.collectionProjectId === input.projectId && project.metadata?.collectionDocumentId === input.documentId);
    if (input.workspaceProjectId && !existing) throw new ProjectDocumentError('Document workspace is unavailable', 409);
    if (existing && (existing.metadata?.collectionProjectId !== input.projectId || existing.metadata?.collectionDocumentId !== input.documentId)) throw new ProjectDocumentError('Document workspace belongs to another project', 403);
    const id = existing?.id ?? randomUUID(), now = Date.now();
    const presentation = input.presentation ?? createDocumentPresentation(input.name);
    const documentType = input.documentType ?? { kind: input.kind === 'design' ? 'free' as const : 'report' as const, subtype: input.name };
    const metadata: ProjectMetadata = { ...(existing?.metadata ?? {}), ...(isFastProject(parent.metadata) ? { projectMode: 'fast' as const } : {}), kind: input.kind === 'design' ? 'prototype' : 'other', ...(input.kind === 'document' ? { intent: 'document' as const } : {}), baseDir: input.workingDirectory,
      collectionProjectId: input.projectId, collectionDocumentId: input.documentId, collectionProjectName: parent.name };
    // Existing setup is the source of user answers. Renaming an output must
    // not reset its scan, page requirements or preparation conversation.
    const moved = existing && !sameDocumentFolder(resolveProjectDir(projectsRoot, id, existing.metadata), input.workingDirectory);
    if (moved && this.options.beforeWrite) throw new ProjectDocumentError('Relinking an existing workspace requires migration of its recovery history; create a new document association instead', 409);
    if (input.kind === 'document') {
      const current = existing && !moved ? await readDocumentSetup(input.workingDirectory, existing.metadata?.documentSetupIntent, id) : null;
      const settings = current?.intent.editorialSettings ?? [];
      const editorialSettings = [...settings.filter((setting) => setting.documentId !== input.documentId), { ...settings.find((setting) => setting.documentId === input.documentId), documentId: input.documentId, presentation }];
      metadata.documentSetupIntent = DocumentSetupIntentSchema.parse({ ...(current?.intent ?? { kind: documentType.kind, subtype: documentType.subtype || input.name, purpose: input.name, contextRoots: [], imageIntakeConsent: false }), ...(input.documentType ? { kind: documentType.kind, subtype: documentType.subtype || (documentType.kind === 'free' ? '' : input.name) } : {}), editorialSettings });
      await ensureProject(projectsRoot, id, metadata);
      await this.options.beforeWrite?.(id, input.workingDirectory);
      const setup = await saveDocumentSetupIntent(input.workingDirectory, metadata.documentSetupIntent, metadata, id);
      metadata.documentSetupIntent = setup.intent;
    } else { delete metadata.intent; delete metadata.documentSetupIntent; await ensureProject(projectsRoot, id, metadata); }
    if (existing) updateProject(db, id, { name: input.name, metadata });
    else insertProject(db, { id, name: input.name, metadata, createdAt: now, updatedAt: now });
    const parentBinding = getWorkspaceProjectByProjectId(db, input.projectId);
    if (parentBinding) {
      const binding = ensureWorkspaceProject(db, { projectId: id, workspaceId: parentBinding.workspaceId, visibility: parentBinding.visibility, resourceState: 'active', createdByWorkspaceMemberId: parentBinding.createdByWorkspaceMemberId, updatedByWorkspaceMemberId: parentBinding.updatedByWorkspaceMemberId, createdAt: now, updatedAt: now });
      if (!binding || binding.workspaceId !== parentBinding.workspaceId) throw new ProjectDocumentError('Document workspace authorization changed', 403);
    }
    let conversation = getFirstProjectConversation(db, id);
    if (!conversation) conversation = insertConversation(db, { id: randomUUID(), projectId: id, title: input.name, sessionMode: input.kind === 'design' ? 'design' : 'blockout', createdAt: now, updatedAt: now });
    if (!conversation) throw new ProjectDocumentError('Document conversation could not be created', 500);
    return { workspaceProjectId: id, conversationId: conversation.id };
  };

  onDocumentUpdated = async (document: ProjectDocument, previous?: ProjectDocument): Promise<void> => {
    if (document.archivedAt || (previous && document.name === previous.name && JSON.stringify(document.presentation) === JSON.stringify(previous.presentation) && JSON.stringify(document.documentType) === JSON.stringify(previous.documentType))) return;
    const project = getProject(this.options.db, document.workspaceProjectId);
    if (!project) throw new ProjectDocumentError('Document workspace is unavailable', 409);
    if (document.workspaceProjectId !== document.projectId && (project.metadata?.collectionProjectId !== document.projectId || project.metadata?.collectionDocumentId !== document.id)) throw new ProjectDocumentError('Document workspace belongs to another project', 403);
    const root = resolveProjectDir(this.options.projectsRoot, project.id, project.metadata);
    const current = await readDocumentSetup(root, project.metadata?.documentSetupIntent, project.id);
    if (document.workspaceProjectId !== document.projectId && (project.name !== document.name || (current && JSON.stringify(current.intent) !== JSON.stringify(project.metadata?.documentSetupIntent)))) updateProject(this.options.db, project.id, { name: document.name, metadata: { ...project.metadata, ...(current ? { documentSetupIntent: current.intent } : {}) } });
    if (current) {
      const documentId = document.blockoutDocumentId ?? document.id, settings = current.intent.editorialSettings ?? [];
      const previousSetting = settings.find((setting) => setting.documentId === documentId);
      const editorialSettings = document.presentation ? previousSetting
        ? settings.map((setting) => setting.documentId === documentId ? { ...setting, presentation: document.presentation! } : setting)
        : [...settings, { documentId, presentation: document.presentation }] : settings;
      const changes: Partial<DocumentSetupIntent> = { editorialSettings };
      // A shared legacy workspace can contain several independently typed
      // outputs. Do not replace its whole intent with one output's settings.
      if (document.workspaceProjectId !== document.projectId && document.documentType) Object.assign(changes, document.documentType);
      if (JSON.stringify(editorialSettings) !== JSON.stringify(settings) || (document.documentType && document.workspaceProjectId !== document.projectId && (current.intent.kind !== document.documentType.kind || current.intent.subtype !== document.documentType.subtype))) {
        await this.options.beforeWrite?.(project.id, root);
        const setup = await saveDocumentSetupIntent(root, changes, project.metadata, project.id);
        updateProject(this.options.db, project.id, { metadata: { ...project.metadata, documentSetupIntent: setup.intent } });
      }
    }
    const blockoutId = document.blockoutDocumentId ?? document.id, workspace = await readBlockoutWorkspace(root, blockoutId);
    if (!workspace.document || (workspace.document.title === document.name && JSON.stringify(workspace.document.presentation) === JSON.stringify(document.presentation))) return;
    let startingPoint = false;
    try { const saved = JSON.parse(await readFile(await containedIntakePath(root, BLOCKOUT_START_PATH), 'utf8')); startingPoint = saved.documentId === blockoutId; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await this.options.beforeWrite?.(project.id, root);
    const variants = workspace.document.variants.map((variant) => ({ ...variant, pages: variant.pages.map((page, index) => {
      if (!document.presentation || index !== 0) return page;
      if (document.presentation.cover === true) { const { countsTowardLimit: _count, ...rest } = page; return { ...rest, role: 'cover' as const, ...(document.presentation.coverCountsTowardPageLimit === null ? {} : { countsTowardLimit: document.presentation.coverCountsTowardPageLimit }) }; }
      if (document.presentation.cover === false && page.role === 'cover') return { ...page, role: 'body' as const, countsTowardLimit: true };
      return page;
    }) }));
    await saveBlockoutWorkspace(root, blockoutId, { document: { ...workspace.document, title: document.name, ...(document.presentation ? { presentation: document.presentation } : {}), variants, approval: undefined }, baseRaw: workspace.raw, startingPoint });
  };
}
