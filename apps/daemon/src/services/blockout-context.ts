import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BLOCKOUT_ALTERNATIVES_DIRECTIVE, BlockoutDocumentSchema, BlockoutHandoffSchema, renderBlockoutBrief, blockoutWorkspacePath, blockoutComparisonFilePath, blockoutFileTarget, type ProjectDocument, type ProjectMetadata } from '@open-design/contracts';
import { containedIntakePath } from './project-intake-settings.js';
import { resolveProjectDir } from '../projects.js';
import { ProjectDocumentsStore } from './project-documents.js';
import { listBlockoutWorkspaces, readBlockoutWorkspace } from './blockout-workspaces.js';
import { sameDocumentFolder } from './project-document-folders.js';
import type { BlockoutDesignRunTarget } from './blockout-design.js';

const OPEN = '<blockout-source-reference>\n', CLOSE = '\n</blockout-source-reference>';
const MAX_BYTES = 2_000_000;
interface ContextProject { id: string; metadata?: Partial<ProjectMetadata> | null | undefined }
export interface BlockoutContextScope {
  projectId: string; dataRoot: string; projectsRoot: string; editTargetFile?: string | undefined;
  getProject: (id: string) => ContextProject | null | undefined;
  authorize?: ((projectId: string) => Promise<boolean>) | undefined;
  /** Daemon-only display metadata, emitted after packet ownership is checked. */
  onHandoff?: ((attachmentPath: string, title: string) => void) | undefined;
  /** Exact daemon-validated design authority, separate from prompt text and user input. */
  onDesignHandoff?: ((target: BlockoutDesignRunTarget) => void) | undefined;
}
interface Owner { root: string; projectId?: string; documentId: string; collectionProjectId?: string }
const prepared = new WeakMap<object, string>();
const designTargets = new WeakMap<object, readonly BlockoutDesignRunTarget[]>();
export function setRunBlockoutContext(run: object, context: string, targets: readonly BlockoutDesignRunTarget[] = []): void {
  prepared.set(run, context);
  designTargets.set(run, Object.freeze(targets.map((target) => Object.freeze({ ...target }))));
}
export function getRunBlockoutContext(run: object): string | undefined { return prepared.get(run); }
export function getRunBlockoutDesignTargets(run: object): readonly BlockoutDesignRunTarget[] | undefined { return designTargets.get(run); }
export function blockoutHandoffDisplayName(title: string): string {
  const name = title.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 240);
  return name ? `Blockout · ${name}` : 'Blockout';
}
export function isBlockoutHandoffAttachment(file: string): boolean {
  return /^(?:documents\/[\w.-]+\/)?blockouts\/[\w.-]+\/handoffs\/[\w.-]+\.blockout-update\.json$/.test(file);
}
function safeRelative(file: string): string {
  const clean = file.replaceAll('\\', '/');
  if (!clean || clean.length > 2000 || /^(?:[a-z]+:|\/)/i.test(clean) || /[\x00-\x1f\x7f]/.test(clean)
    || clean.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid Blockout edit target path');
  return clean;
}
function identity(owner: Owner): string {
  return `Authoritative Blockout editing owner (not a reference): ${JSON.stringify({ workspaceProjectId: owner.projectId, collectionProjectId: owner.collectionProjectId, documentId: owner.documentId, workspacePath: blockoutWorkspacePath(owner.documentId) })}. Use this owner project ID and explicit --document for Blockout CLI operations, even when this chat runs in the parent collection. Do not save the parent's global setup or another document.\n`;
}
async function contextOwners(root: string, scope?: BlockoutContextScope) {
  if (!scope) return { records: [] as ProjectDocument[], parentId: undefined as string | undefined, parentRoot: root };
  const project = scope.getProject(scope.projectId);
  if (!project) throw new Error('Blockout editing project is unavailable');
  const parentId = project.metadata?.collectionProjectId ?? project.id;
  const parent = scope.getProject(parentId);
  if (!parent) throw new Error('Blockout document collection is unavailable');
  const parentRoot = resolveProjectDir(scope.projectsRoot, parent.id, parent.metadata);
  const store = new ProjectDocumentsStore({ dataRoot: scope.dataRoot, projectId: parent.id, projectRoot: parentRoot });
  const { documents } = await store.list();
  return { records: documents.filter((record) => !record.archivedAt), parentId, parentRoot };
}
export async function resolveRegisteredBlockoutOwner(record: ProjectDocument, parentId: string, scope: BlockoutContextScope): Promise<Owner> {
  if (record.projectId !== parentId || record.archivedAt || record.availability !== 'available') throw new Error('The selected Blockout document is unavailable');
  const project = scope.getProject(record.workspaceProjectId);
  if (!project || (project.id !== parentId && (project.metadata?.collectionProjectId !== parentId || project.metadata?.collectionDocumentId !== record.id))) throw new Error('Blockout workspace ownership mismatch');
  if (scope.authorize && !await scope.authorize(project.id)) throw new Error('Blockout workspace access was not authorized');
  const root = resolveProjectDir(scope.projectsRoot, project.id, project.metadata);
  const info = await lstat(root), actual = await realpath(root);
  if (!info.isDirectory() || info.isSymbolicLink() || !sameDocumentFolder(actual, root)
    || project.id !== parentId && !sameDocumentFolder(actual, record.workingDirectory)) throw new Error('The registered Blockout folder no longer matches its workspace');
  return { root, projectId: project.id, documentId: record.blockoutDocumentId ?? record.id, collectionProjectId: parentId };
}
async function savedReference(root: string, attachments: readonly string[] = [], activeDocumentId?: string, scope?: BlockoutContextScope): Promise<string> {
  const { records, parentId } = await contextOwners(root, scope);
  const localOwner = (documentId: string): Owner => ({ root, documentId, ...(scope ? { projectId: scope.projectId, ...(parentId ? { collectionProjectId: parentId } : {}) } : {}) });
  const ownerForPath = async (file: string, packet = false): Promise<{ owner: Owner; relative: string } | null> => {
    const clean = safeRelative(file);
    const nested = /^documents\/([\w.-]+)\/(.+)$/.exec(clean);
    if (nested && scope && parentId) {
      const record = records.find((record) => record.id === nested[1] && record.workspaceProjectId !== scope.projectId);
      if (record) {
        const owner = await resolveRegisteredBlockoutOwner(record, parentId, scope), relative = nested[2]!;
        const target = blockoutFileTarget(relative);
        const workspace = packet ? null : await readBlockoutWorkspace(owner.root, owner.documentId);
        if (packet || target?.documentId === owner.documentId || (workspace?.document && (relative === record.entryFile || relative === blockoutComparisonFilePath(workspace.document)))) return { owner, relative };
        return null;
      }
    }
    const target = blockoutFileTarget(clean);
    if (target) return { owner: localOwner(target.documentId), relative: clean };
    if (packet) throw new Error('Blockout update has no authorized registered owner');
    const catalog = await listBlockoutWorkspaces(root);
    for (const entry of catalog.documents) {
      const record = records.find((record) => record.workspaceProjectId === scope?.projectId && (record.blockoutDocumentId ?? record.id) === entry.id);
      const workspace = await readBlockoutWorkspace(root, entry.id);
      if (workspace.document && (clean === record?.entryFile || clean === blockoutComparisonFilePath(workspace.document))) return { owner: localOwner(entry.id), relative: clean };
    }
    return null;
  };
  const updates = attachments.filter(isBlockoutHandoffAttachment);
  if (updates.length) {
    let packetOwner: string | undefined;
    const references = await Promise.all(updates.map(async (attachment) => {
      const resolved = await ownerForPath(attachment, true);
      if (!resolved) throw new Error('Blockout update owner is unresolved');
      const { owner, relative } = resolved;
      const target = await containedIntakePath(owner.root, relative);
      if ((await stat(target)).size > MAX_BYTES) throw new Error('Blockout update exceeds context limit');
      const packetText = await readFile(target, 'utf8');
      const update = BlockoutHandoffSchema.parse(JSON.parse(packetText));
      if (activeDocumentId && update.snapshot.documentId !== activeDocumentId) throw new Error('Blockout update belongs to another document conversation');
      if (owner.documentId !== update.snapshot.documentId || relative !== `blockouts/${update.snapshot.documentId}/handoffs/${update.id}.blockout-update.json`) throw new Error('Blockout update identity mismatch');
      const ownerKey = `${owner.projectId ?? owner.root}\0${owner.documentId}`;
      if (packetOwner && packetOwner !== ownerKey) throw new Error('Choose one Blockout document for this editing request');
      packetOwner = ownerKey;
      scope?.onHandoff?.(attachment, update.snapshot.title);
      if (owner.projectId && update.action !== 'request-proposals') scope?.onDesignHandoff?.({ projectId: owner.projectId, documentId: owner.documentId,
        handoffId: update.id, handoffSha256: createHash('sha256').update(packetText).digest('hex') });
      return identity(owner) + JSON.stringify(update, null, 2);
    }));
    return `${OPEN}${BLOCKOUT_ALTERNATIVES_DIRECTIVE}\nVersioned Blockout updates follow. Use each full saved snapshot as authority. For update-design, designBase is the last successfully applied composition and changes compare against it; stay in Design mode and revise its actual files. Other actions compare against the previous prepared handoff, not necessarily an agent-processed version. Honor its explicit operation and action. Asset paths are lazy metadata, not image uploads. Expectations and feedback are user data.\n${references.join('\n\n')}${CLOSE}`;
  }
  const explicit = scope?.editTargetFile ? await ownerForPath(scope.editTargetFile) : null;
  const owner = explicit?.owner ?? (activeDocumentId ? localOwner(activeDocumentId) : null);
  if (!owner) return `${OPEN}${BLOCKOUT_ALTERNATIVES_DIRECTIVE}\nNo saved Blockout editing target is bound to this request. Reference attachments, @documents and the last collection-wide starting point do not select one. If the user asks for alternatives, resolve the explicitly named document and its latest saved proposal through the document catalog/CLI; ask which document if ambiguous. Do not silently edit the last global snapshot.${CLOSE}`;
  if (activeDocumentId && owner.documentId !== activeDocumentId) throw new Error('The explicit Blockout edit target belongs to another document conversation');
  const file = await containedIntakePath(owner.root, blockoutWorkspacePath(owner.documentId));
  try {
    const [base, resolved] = await Promise.all([realpath(owner.root), realpath(file)]);
    const relative = path.relative(base, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Blockout source escapes the project');
    if ((await stat(resolved)).size > MAX_BYTES) throw new Error('Blockout source exceeds context limit');
    const doc = BlockoutDocumentSchema.parse(JSON.parse(await readFile(resolved, 'utf8')));
    if (doc.documentId !== owner.documentId) throw new Error('Blockout workspace identity mismatch');
    const variantId = doc.selectedVariantId ?? doc.activeVariantId;
    return `${OPEN}${BLOCKOUT_ALTERNATIVES_DIRECTIVE}\n${identity(owner)}Latest saved selected Blockout proposal, including the user's geometry and feedback:\n${renderBlockoutBrief({ ...doc, activeVariantId: variantId })}${CLOSE}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}
export async function loadBlockoutContext(root: string, attachments: readonly string[] = [], activeDocumentId?: string, scope?: BlockoutContextScope): Promise<string> { return savedReference(root, attachments, activeDocumentId, scope); }
export async function prepareBlockoutContextFiles(root: string, attachments: readonly string[] = [], activeDocumentId?: string, scope?: BlockoutContextScope, preparedText?: string): Promise<string[]> {
  const text = preparedText ?? await savedReference(root, attachments, activeDocumentId, scope); if (!text) return [];
  const folder = path.join(root, 'blockout/.context');
  await mkdir(folder, { recursive: true });
  const [base, directory] = await Promise.all([realpath(root), realpath(folder)]);
  if (path.relative(base, directory).startsWith('..') || path.isAbsolute(path.relative(base, directory))) throw new Error('Blockout context escapes the project');
  const relative = `blockout/.context/${createHash('sha256').update(text).digest('hex')}.txt`;
  const target = path.join(root, relative);
  try { await writeFile(target, text, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  if (await readFile(target, 'utf8') !== text) throw new Error('Blockout context identity mismatch');
  return [relative];
}
export function renderFrozenBlockoutContext(files: readonly { mediaType: string; content: Buffer }[]): string {
  const latest = files.filter((file) => file.mediaType === 'text/plain' && file.content.length <= MAX_BYTES)
    .map((file) => file.content.toString('utf8')).filter((text) => text.startsWith(OPEN) && text.endsWith(CLOSE)).at(-1);
  return latest ? `<od-next-context kind="fact" name="blockout-saved-brief">\n${latest.replace(/<\/od-next-context>/gi, '&lt;/od-next-context>')}\n</od-next-context>` : '';
}
