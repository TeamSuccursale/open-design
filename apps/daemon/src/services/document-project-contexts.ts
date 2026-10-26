import { randomUUID } from 'node:crypto';
import { readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DocumentContextScanSchema, DocumentProjectReferencesResponseSchema, DocumentProjectReferencesRequestSchema, documentSetupPath,
  type DocumentContextScan, type DocumentProjectContext, type ProjectMetadata } from '@open-design/contracts';
import { ensureProject } from '../projects.js';
import { containedIntakePath } from './project-intake-settings.js';
import { withProjectHistoryMutation } from '../project-history-observer.js';

export interface DocumentProjectContextStore { projectId: string; references: DocumentProjectContext[]; scan?: DocumentContextScan }
function parseStore(input: unknown): DocumentProjectContextStore {
  const value = input as { projectId?: unknown; references?: unknown; scan?: unknown } | null;
  if (!value || typeof value.projectId !== 'string') throw new Error('Invalid project reference context');
  const { references } = DocumentProjectReferencesResponseSchema.parse(value);
  return { projectId: value.projectId, references, ...(value.scan ? { scan: DocumentContextScanSchema.parse(value.scan) } : {}) };
}
function storePath(projectId: string): string { return path.posix.join(path.posix.dirname(documentSetupPath(projectId)), 'project-references.json'); }
export async function readDocumentProjectReferences(root: string, projectId: string): Promise<DocumentProjectContextStore> {
  try {
    const target = await containedIntakePath(root, storePath(projectId));
    if ((await stat(target)).size > 512 * 1024) throw new Error('Project reference context exceeds the size limit');
    const store = parseStore(JSON.parse(await readFile(target, 'utf8')));
    if (store.projectId !== projectId) throw new Error('Project reference identity mismatch');
    return store;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return { projectId, references: [] }; }
}
export async function saveDocumentProjectReferences(root: string, projectId: string, references: DocumentProjectContext[], scan?: DocumentContextScan): Promise<DocumentProjectContextStore> {
  const current = await readDocumentProjectReferences(root, projectId);
  const same = JSON.stringify(current.references) === JSON.stringify(references);
  const value = parseStore({ projectId, references, ...((scan ?? (same ? current.scan : undefined)) ? { scan: scan ?? current.scan } : {}) });
  const relative = storePath(projectId);
  await containedIntakePath(root, path.posix.dirname(relative), true);
  const target = await containedIntakePath(root, relative), temporary = await containedIntakePath(root, `${relative}.${randomUUID()}.tmp`);
  await withProjectHistoryMutation({ root, projectId, paths: [relative] }, async () => {
    await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx' }); await rename(temporary, target);
  });
  return value;
}

/** Client input supplies IDs only. Every root is freshly authorized and resolved by the daemon. */
export async function resolveDocumentProjectReferences(input: {
  primaryProjectId: string; projectIds: string[]; projectsDir: string;
  authorize: (projectId: string) => Promise<boolean>;
  getProject: (projectId: string) => { id: string; name: string; metadata?: ProjectMetadata | null } | null | undefined;
}): Promise<DocumentProjectContext[] | null> {
  const { projectIds } = DocumentProjectReferencesRequestSchema.parse({ projectIds: input.projectIds });
  const references: DocumentProjectContext[] = [];
  for (const id of new Set(projectIds)) {
    if (id === input.primaryProjectId) throw new Error('Choose another project as context');
    if (!await input.authorize(id)) return null;
    const project = input.getProject(id); if (!project) throw new Error('Referenced project not found');
    references.push({ projectId: project.id, name: project.name || project.id, workingDirectory: await realpath(await ensureProject(input.projectsDir, project.id, project.metadata)) });
  }
  return references;
}
