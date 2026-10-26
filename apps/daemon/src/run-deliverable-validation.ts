import fs from 'node:fs/promises';
import path from 'node:path';

import { HYPERFRAMES_VIDEO_MODEL, blockoutComparisonFilePath } from '@open-design/contracts';
import type {
  ChatRunStatus,
  ProjectFile,
  ProjectFileKind,
  ProjectMetadata,
  ProjectDocument,
} from '@open-design/contracts';

import { listFiles, resolveProjectDir } from './projects.js';
import { findTouchedLinkedPage } from './artifacts/linked-page-delivery.js';
import type { BlockoutContextScope } from './services/blockout-context.js';

export type RunDeliverableValidation =
  | 'valid'
  | 'not_succeeded'
  | 'no_artifact'
  | 'project_missing'
  | 'entry_missing'
  | 'entry_not_touched'
  | 'entry_unreadable'
  | 'type_mismatch';

export interface RunDeliverableValidationResult {
  valid: boolean;
  validation: RunDeliverableValidation;
  entryFile?: string;
  artifactKind?: ProjectFileKind;
  /** Internal syntax-finalization input; entryFile remains the canonical entry. */
  linkedPage?: string;
}

interface ValidateRunDeliverableInput {
  runId?: string;
  projectsRoot: string;
  projectId: string | null;
  projectMetadata?: Partial<ProjectMetadata> | Record<string, unknown> | null;
  runStatus: ChatRunStatus;
  artifactCount: number;
  /** Exact artifact paths changed by this run. Undefined means the runtime
   *  could not produce a reliable per-file diff (for example contention). */
  touchedPaths?: string[];
  /** Unambiguous HTML entry observed by the host before this run wrote files. */
  baselineEntryFile?: string;
  /** New marker tasks may deliver a separate file without changing the project entry.
   * Requires exact current-run touched paths; never enables project-wide inference. */
  allowIndependentOutput?: boolean;
  allowMultipleOutputCandidates?: boolean;
  /** Host-owned registry/DB scope; never inferred from a project path or env. */
  documentScope?: Pick<BlockoutContextScope, 'dataRoot' | 'getProject'>;
}

export function inferBaselineHtmlEntry(projectRoot: string, paths: Iterable<string>): string | undefined {
  const rootHtml = [...paths]
    .map((file) => path.relative(projectRoot, file).replaceAll(path.sep, '/'))
    .filter((file) => !file.includes('/') && /\.html?$/i.test(file));
  return rootHtml.includes('index.html') ? 'index.html' : rootHtml.length === 1 ? rootHtml[0] : undefined;
}

const PROJECT_KIND_FILE_KINDS: Partial<
  Record<ProjectMetadata['kind'], ReadonlySet<ProjectFileKind>>
> = {
  prototype: new Set(['html']),
  template: new Set(['html']),
  deck: new Set(['html', 'presentation', 'pdf']),
  brand: new Set(['html', 'document', 'pdf']),
  image: new Set(['image']),
  video: new Set(['video']),
  audio: new Set(['audio']),
};

function safeRelativeFile(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/')) return null;
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return null;
  }
  return segments.join('/');
}

function projectKind(
  metadata: ValidateRunDeliverableInput['projectMetadata'],
): ProjectMetadata['kind'] | null {
  const value = metadata?.kind;
  return value === 'prototype'
    || value === 'deck'
    || value === 'template'
    || value === 'other'
    || value === 'brand'
    || value === 'image'
    || value === 'video'
    || value === 'audio'
    ? value
    : null;
}

function isHyperFramesProject(
  metadata: ValidateRunDeliverableInput['projectMetadata'],
): boolean {
  return metadata?.videoModel === HYPERFRAMES_VIDEO_MODEL
    || metadata?.intent === 'hyperframes';
}

/**
 * The file kinds a project may deliver as its canonical entry, or `null` when
 * any kind is acceptable.
 *
 * `metadata.kind` records the Home surface a project was created from, not the
 * shape of what it delivers. For most kinds those coincide; HyperFrames breaks
 * the identity. A HyperFrames project rides on `kind: 'video'` because Video is
 * the surface that offers it, while the artifact the user authors, edits and
 * previews is an HTML composition — the MP4 is a render of that HTML, produced
 * on demand and not necessarily present in the project at all. OD Next already
 * says so on the way in: `DAEMON_OWNED_OUTPUT_KINDS.hyperframes` admits `html`
 * and `source` as supported deliverable kinds at plan time, so rejecting them
 * at completion time contradicts the plan the same daemon approved.
 *
 * Generative video projects (fal / Veo / Sora / Volcengine) keep the strict
 * video-only contract: there the provider returns a video file, and an HTML
 * "preview page" in its place is a genuine delivery failure.
 */
function acceptedDeliverableKinds(
  metadata: ValidateRunDeliverableInput['projectMetadata'],
): ReadonlySet<ProjectFileKind> | null {
  const kind = projectKind(metadata);
  if (!kind || kind === 'other') return null;
  const declared = PROJECT_KIND_FILE_KINDS[kind];
  if (!declared) return null;
  if (kind === 'video' && isHyperFramesProject(metadata)) {
    return new Set<ProjectFileKind>([...declared, 'html']);
  }
  return declared;
}

function filePath(file: ProjectFile): string {
  return typeof file.path === 'string' && file.path ? file.path : file.name;
}

function inferredEntry(
  files: ProjectFile[],
  acceptedKinds: ReadonlySet<ProjectFileKind> | null,
): ProjectFile | null {
  const rootIndex = files.find((file) => filePath(file) === 'index.html');
  if (rootIndex) return rootIndex;

  const rootHtml = files.filter((file) => {
    const candidate = filePath(file);
    return !candidate.includes('/') && file.kind === 'html';
  });
  if (rootHtml.length === 1) return rootHtml[0] ?? null;

  if (acceptedKinds) {
    const compatible = files.filter((file) => acceptedKinds.has(file.kind));
    if (compatible.length === 1) return compatible[0] ?? null;
  }

  return files.length === 1 ? files[0] ?? null : null;
}

function matchesAcceptedKinds(
  acceptedKinds: ReadonlySet<ProjectFileKind> | null,
  fileKind: ProjectFileKind,
): boolean {
  return !acceptedKinds || acceptedKinds.has(fileKind);
}

/**
 * The two questions a caller can ask about a project's canonical deliverable.
 *
 * `'run'` — did THIS run produce it? Strict on purpose: the answer decides
 * whether the host may accept an Agent's completion claim, so a turn must not
 * be able to pass by pointing at a file an earlier turn wrote.
 *
 * `'project'` — does the user have it, right now? The same filesystem checks
 * without the run-scoped gates. It answers a presentation question ("is there
 * anything to tell the user they lost?"), where the earlier turn's file counts
 * precisely because the user can open it.
 *
 * Splitting them is the whole point: one predicate used to answer both, and
 * the strict answer is the WRONG answer to the loose question. A "继续" turn
 * that verifies finished work and correctly changes nothing scores
 * `no_artifact` under `'run'` — true, and irrelevant to whether the user got
 * their deck.
 */
export type DeliverableValidationScope = 'run' | 'project';

/** Values `validateProjectDeliverable` can actually produce, narrowed to the
 *  wire union. Run-scoped outcomes are unreachable there; returning null for
 *  one keeps a future enum addition from being reported as a wire value the
 *  client's type does not admit. */
export function projectDeliverableValidation(
  validation: RunDeliverableValidation,
): 'valid' | 'project_missing' | 'entry_missing' | 'entry_unreadable' | 'type_mismatch' | null {
  switch (validation) {
    case 'valid':
    case 'project_missing':
    case 'entry_missing':
    case 'entry_unreadable':
    case 'type_mismatch':
      return validation;
    default:
      return null;
  }
}

/**
 * Does this project hold a usable canonical deliverable right now?
 *
 * Same entry resolution, kind contract and readability check as
 * `validateRunDeliverable`, minus every gate that asks about a particular run.
 * Never use it to accept a completion claim — see `DeliverableValidationScope`.
 */
export async function validateProjectDeliverable(
  input: Omit<ValidateRunDeliverableInput, 'runStatus' | 'artifactCount' | 'touchedPaths'>,
): Promise<RunDeliverableValidationResult> {
  return resolveDeliverable({
    ...input,
    runStatus: 'succeeded',
    artifactCount: 1,
    scope: 'project',
  });
}

/**
 * Resolve and verify the one canonical file a successful run can deliver.
 *
 * `artifactCount` proves this run touched output; it does not prove the
 * project's declared entry still exists. The filesystem-backed file list and
 * a direct readability check are therefore authoritative.
 */
export async function validateRunDeliverable(
  input: ValidateRunDeliverableInput,
): Promise<RunDeliverableValidationResult> {
  const blockout = await validateBlockoutDelivery(input);
  if (blockout) return blockout;
  const primary = await resolveDeliverable({ ...input, scope: 'run' });
  if (primary.valid || !input.allowIndependentOutput || !input.touchedPaths?.length
    || !['entry_missing', 'entry_not_touched', 'type_mismatch'].includes(primary.validation)) {
    return primary;
  }
  const independent = await resolveDeliverable({ ...input, scope: 'run', independentOutput: true });
  if (!input.allowMultipleOutputCandidates || input.touchedPaths.length < 2) return independent;
  // Validate every current-run candidate separately. A stable representative is
  // used by the existing entry/syntax surface; it does not prove Query coverage
  // or visual quality for the other deliverables and never changes project metadata.
  const candidates = [...new Set(input.touchedPaths)].sort();
  let representative: RunDeliverableValidationResult | undefined;
  for (const candidate of candidates) {
    const result = await resolveDeliverable({ ...input, touchedPaths: [candidate], scope: 'run', independentOutput: true });
    if (!result.valid) return result;
    representative ??= result;
  }
  return representative ?? independent;
}

/** Named documents deliver saved workspace comparisons rather than one root
 * entry. Normal projects require their persisted registry association; Fast
 * also retains its original local catalog path. Both require this run's diff. */
async function validateBlockoutDelivery(
  input: ValidateRunDeliverableInput,
  registeredOnly = false,
): Promise<RunDeliverableValidationResult | null> {
  const fast = input.projectMetadata?.projectMode === 'fast';
  if ((!fast && !input.documentScope) || input.projectMetadata?.entryFile
    || input.runStatus !== 'succeeded' || !input.projectId
    || !Number.isFinite(input.artifactCount) || input.artifactCount <= 0
    || !input.touchedPaths?.length) return null;
  type Candidate = { observed: string; relative: string; projectId: string; metadata: ValidateRunDeliverableInput['projectMetadata']; registeredDesign?: boolean };
  const candidates = new Map<string, Candidate>();
  try {
    const root = resolveProjectDir(input.projectsRoot, input.projectId, input.projectMetadata);
    const { listBlockoutWorkspaces, readBlockoutWorkspace } = await import('./services/blockout-workspaces.js');
    // Native filesystem diffs carry absolute paths; durable run state carries
    // the host's project-relative copy. Both name exact writes in this root.
    // A path outside it must never become a virtual registered child alias.
    const touched = new Set(input.touchedPaths.flatMap((value) => {
      if (typeof value !== 'string' || !value) return [];
      if (!path.isAbsolute(value) && !safeRelativeFile(value)) return [];
      const relative = path.relative(root, path.resolve(root, value)).replaceAll(path.sep, '/');
      const entry = safeRelativeFile(relative);
      return entry && !path.isAbsolute(relative) && !relative.startsWith('../') ? [entry] : [];
    }));
    const scope = input.documentScope ? { ...input.documentScope, projectId: input.projectId, projectsRoot: input.projectsRoot } : null;
    const project = scope?.getProject(input.projectId), parentId = project?.metadata?.collectionProjectId ?? input.projectId;
    let records: readonly ProjectDocument[] = [];
    if (scope && project) {
      const { readProjectDocumentsSnapshot } = await import('./services/project-documents.js');
      records = await readProjectDocumentsSnapshot(scope.dataRoot, parentId);
    }
    // Original collection paths remain valid. A registered child's document
    // must instead resolve through its own project and authoritative metadata.
    if (!registeredOnly && fast && !input.projectMetadata?.collectionProjectId) {
      const catalog = await listBlockoutWorkspaces(root);
      const workspaces = await Promise.allSettled(catalog.documents.map((item) => readBlockoutWorkspace(root, item.id)));
      for (const result of workspaces) {
        if (result.status !== 'fulfilled' || !result.value.document) continue;
        const document = result.value.document;
        const record = records.find((item) => (item.blockoutDocumentId ?? item.id) === document.documentId);
        if (record && (record.archivedAt || record.workspaceProjectId !== input.projectId)) continue;
        const entry = blockoutComparisonFilePath(document);
        if (touched.has(entry)) candidates.set(entry, { observed: entry, relative: entry, projectId: input.projectId, metadata: input.projectMetadata });
      }
    }
    if (scope && project) {
      const { resolveRegisteredBlockoutOwner } = await import('./services/blockout-context.js');
      const { documentRelativePath, sameDocumentFolder } = await import('./services/project-document-folders.js');
      for (const record of records) {
        if (record.archivedAt || record.kind !== 'document' || record.projectId !== parentId) continue;
        if (input.projectId !== parentId && record.workspaceProjectId !== input.projectId) continue;
        const ownerProject = scope.getProject(record.workspaceProjectId);
        if (!ownerProject) continue;
        const alias = `documents/${record.id}/`;
        const aliasTouched = input.projectId === parentId && [...touched].some((entry) => entry.startsWith(alias));
        if (!aliasTouched && record.workspaceProjectId !== input.projectId
          && !sameDocumentFolder(resolveProjectDir(input.projectsRoot, ownerProject.id, ownerProject.metadata), root)) continue;
        let owner: Awaited<ReturnType<typeof resolveRegisteredBlockoutOwner>>;
        try { owner = await resolveRegisteredBlockoutOwner(record, parentId, scope); } catch { continue; }
        if (!owner.projectId) continue;
        const observedEntries = (relative: string): string[] => {
          try { documentRelativePath(relative); } catch { return []; }
          const observedPaths = input.projectId === parentId ? [relative, `${alias}${relative}`] : [relative];
          return observedPaths.filter((observed) => {
            if (!touched.has(observed)) return false;
            // A parent diff is physical evidence. It cannot authorize a child
            // outside that root merely by presenting a virtual alias string.
            return input.projectId !== parentId || sameDocumentFolder(path.resolve(root, observed), path.resolve(owner.root, relative));
          });
        };
        const registeredEntry = safeRelativeFile(record.entryFile);
        const registeredObserved = registeredEntry ? observedEntries(registeredEntry)[0] : undefined;
        const missingModel = registeredObserved ? { valid: false, validation: 'entry_missing', entryFile: registeredObserved } as const : null;
        let saved: Awaited<ReturnType<typeof readBlockoutWorkspace>>;
        try {
          const catalog = await listBlockoutWorkspaces(owner.root);
          if (!catalog.documents.some((item) => item.id === owner.documentId)) {
            if (missingModel) return missingModel;
            continue;
          }
          saved = await readBlockoutWorkspace(owner.root, owner.documentId);
        } catch { if (missingModel) return missingModel; continue; }
        if (!saved.document) { if (missingModel) return missingModel; continue; }
        const { registeredBlockoutDesignDelivery } = await import('./services/blockout-design.js');
        const designedEntry = input.runId ? await registeredBlockoutDesignDelivery(owner.root, owner.documentId, input.runId, input.projectId).catch(() => undefined) : undefined;
        const entries = designedEntry ? new Set([designedEntry])
          : new Set([blockoutComparisonFilePath(saved.document), registeredEntry].filter((entry): entry is string => entry !== null));
        for (const relative of entries) {
          for (const observed of observedEntries(relative)) {
            candidates.set(observed, { observed, relative, projectId: owner.projectId, metadata: ownerProject.metadata,
              ...(designedEntry ? { registeredDesign: true } : {}) });
          }
        }
      }
    }
  } catch { return null; }
  if (!candidates.size) return null;
  let representative: RunDeliverableValidationResult | null = null;
  for (const candidate of [...candidates.values()].sort((a, b) => a.observed.localeCompare(b.observed))) {
    // Explicit owner entries retain their ordinary selection/touched/type
    // rules. Every path still receives the independent realpath guard.
    const result = await resolveDeliverable({ ...input, projectId: candidate.projectId, projectMetadata: candidate.metadata ?? null,
      touchedPaths: [candidate.relative], scope: 'run', independentOutput: candidate.registeredDesign || !candidate.metadata?.entryFile, requireRealpathContainment: true });
    const prefix = candidate.observed.slice(0, candidate.observed.length - candidate.relative.length);
    const observedResult = { ...result, ...(result.entryFile ? { entryFile: `${prefix}${result.entryFile}` } : {}),
      ...(result.linkedPage ? { linkedPage: `${prefix}${result.linkedPage}` } : {}) };
    if (!result.valid) return observedResult;
    representative ??= observedResult;
  }
  return representative;
}

/** Repair a cached pre-registry/absolute-diff miss only from the same run's
 * exact writes and an actual persisted registered model. Ordinary inferred
 * entries and the legacy Fast catalog are deliberately outside this repair. */
export async function revalidateRegisteredBlockoutDelivery(
  input: ValidateRunDeliverableInput,
): Promise<RunDeliverableValidationResult | null> {
  return validateBlockoutDelivery(input, true);
}

async function resolveDeliverable(
  input: ValidateRunDeliverableInput & { scope: DeliverableValidationScope; independentOutput?: boolean; requireRealpathContainment?: boolean },
): Promise<RunDeliverableValidationResult> {
  const runScoped = input.scope === 'run';
  if (runScoped && input.runStatus !== 'succeeded') {
    return { valid: false, validation: 'not_succeeded' };
  }
  if (
    runScoped
    && (!Number.isFinite(input.artifactCount) || input.artifactCount <= 0)
  ) {
    return { valid: false, validation: 'no_artifact' };
  }
  if (!input.projectId) {
    return { valid: false, validation: 'project_missing' };
  }

  let projectRoot: string;
  let files: ProjectFile[];
  try {
    projectRoot = resolveProjectDir(
      input.projectsRoot,
      input.projectId,
      input.projectMetadata,
    );
    files = await listFiles(input.projectsRoot, input.projectId, {
      metadata: input.projectMetadata,
    }) as ProjectFile[];
  } catch {
    return { valid: false, validation: 'project_missing' };
  }

  const touched = new Set((input.touchedPaths ?? []).flatMap((candidate) => {
    if (typeof candidate !== 'string' || !candidate) return [];
    const relative = path.relative(projectRoot, path.resolve(projectRoot, candidate));
    return !relative || relative.startsWith('..') || path.isAbsolute(relative)
      ? [] : [relative.replaceAll(path.sep, '/')];
  }));
  if (input.independentOutput) files = files.filter(file => touched.has(filePath(file)));
  const acceptedKinds = input.independentOutput ? null : acceptedDeliverableKinds(input.projectMetadata);
  const isPrototype = projectKind(input.projectMetadata) === 'prototype';
  const declared = input.independentOutput ? null : safeRelativeFile(input.projectMetadata?.entryFile);
  const baselineEntry = !input.independentOutput && isPrototype && input.touchedPaths
    ? safeRelativeFile(input.baselineEntryFile)
    : null;
  const motionSources = input.projectMetadata?.intent === 'motion-design'
    ? files.filter((file) => file.kind === 'html')
    : [];
  const motionSource = motionSources.length === 1 ? motionSources[0] : null;
  const baselineSelected = baselineEntry ? files.find((file) => filePath(file) === baselineEntry) : null;
  const selected = declared
    ? files.find((file) => filePath(file) === declared) ?? null
    : baselineSelected ?? motionSource ?? inferredEntry(files, acceptedKinds);
  if (!selected) {
    return { valid: false, validation: 'entry_missing' };
  }

  const entryFile = filePath(selected);
  const facts = {
    entryFile,
    artifactKind: selected.kind,
  };
  let linkedPage: string | null = null;
  if (runScoped && input.touchedPaths) {
    if (!touched.has(entryFile)) {
      if (isPrototype && selected.kind === 'html') {
        linkedPage = await findTouchedLinkedPage({
          projectRoot,
          entryFile,
          htmlPaths: new Set(files.filter((file) => file.kind === 'html').map(filePath)),
          touchedPaths: touched,
        });
      }
      if (!linkedPage) {
        return { valid: false, validation: 'entry_not_touched', ...facts };
      }
    }
  }
  if (!matchesAcceptedKinds(acceptedKinds, selected.kind)) {
    return {
      valid: false,
      validation: 'type_mismatch',
      ...facts,
    };
  }

  try {
    const target = path.resolve(projectRoot, entryFile);
    const relative = path.relative(projectRoot, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return { valid: false, validation: 'entry_unreadable', ...facts };
    }
    if (input.independentOutput || input.requireRealpathContainment) {
      const realRelative = path.relative(await fs.realpath(projectRoot), await fs.realpath(target));
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        return { valid: false, validation: 'entry_unreadable', ...facts };
      }
    }
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      return { valid: false, validation: 'entry_unreadable', ...facts };
    }
    const handle = await fs.open(target, 'r');
    await handle.close();
  } catch {
    return { valid: false, validation: 'entry_unreadable', ...facts };
  }

  return {
    valid: true,
    validation: 'valid',
    ...facts,
    ...(linkedPage ? { linkedPage } : {}),
  };
}
