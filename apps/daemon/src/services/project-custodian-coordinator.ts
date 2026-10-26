import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { ProjectMetadata } from '@open-design/contracts';
import { ProjectCustodianService } from './project-custodians.js';
import { ProjectCustodianJournal } from './project-custodian-journal.js';
import { ProjectCustodianWatch, scanCustodianManifest, type CustodianWorkRequest } from './project-custodian-watch.js';
import { DocumentResearchService, readDocumentResearchEvidence, type DocumentResearchOriginal } from './document-research.js';
import { ProjectIntakeService } from './project-intake.js';
import { insideDirectory, readIntakeConfig } from './project-intake-settings.js';
import { readDocumentSetup } from './document-setup.js';
import { validateLinkedDirs } from '../linked-dirs.js';

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 1000));

/** Shared job instances preserve in-flight lifecycle state across UI, CLI and automatic indexing. */
export function createProjectCustodianCoordinator(options: { dataDir: string; intake: ProjectIntakeService; research: DocumentResearchService }) {
  const journal = new ProjectCustodianJournal(options.dataDir);
  async function roots(root: string, metadata?: ProjectMetadata | null) {
    const canonical = await realpath(root), config = await readIntakeConfig(canonical);
    const linked = validateLinkedDirs([...(metadata?.linkedDirs ?? []), ...config.sourceDirs]);
    if ('error' in linked) throw new Error(linked.error);
    return { canonical, config, all: [...new Set([canonical, ...linked.dirs])] };
  }
  async function manifest(request: CustodianWorkRequest) {
    const selected = await roots(request.root, request.metadata);
    return { ...selected, scan: await scanCustodianManifest(selected.all, [], [path.resolve(selected.canonical, selected.config.outputDir)]) };
  }
  const watcher = new ProjectCustodianWatch({
    journal,
    imageConsent: async (root, projectId) => {
      const intent = (await readDocumentSetup(root, undefined, projectId))?.intent;
      return intent?.imageIntakeConsent === true && intent.imageIntakeDecision !== 'declined';
    },
    enqueueText: async (request) => {
      const selected = await manifest(request);
      const discovered = selected.scan.entries.filter((entry) => entry.kind === 'document');
      const prior = await readDocumentResearchEvidence(options.dataDir, request.root, request.projectId);
      const ordered = [...discovered].sort((a, b) => {
        const rank = (file: string) => { const index = prior?.sources.findIndex((source) => path.resolve(source.root, source.path) === file) ?? -1; return index < 0 ? 1_000_000 : index; };
        return rank(a.path) - rank(b.path) || a.path.localeCompare(b.path);
      });
      const originals: DocumentResearchOriginal[] = ordered.slice(0, 12).map((entry) => {
        const base = selected.all.find((root) => insideDirectory(root, entry.path))!;
        return { root: base, sourcePath: path.relative(base, entry.path).replaceAll('\\', '/'), title: path.basename(entry.path) };
      });
      if (!originals.length) return { partial: true, message: 'No readable document sources remain; previous evidence must be reviewed.' };
      let run = await options.research.indexSources(request.root, originals, request.metadata, request.projectId);
      const deadline = Date.now() + 2 * 60 * 60 * 1000;
      while (['queued', 'quick', 'full'].includes(run.status)) {
        if (Date.now() > deadline) throw new Error('Text indexing remains unfinished after the coordinator time limit');
        await pause(); run = (await options.research.read(request.root, request.projectId))!;
      }
      // A previous job may already have been active when the new source arrived.
      if (originals.some((entry) => !run.sources.some((source) =>
        path.resolve(source.root, source.path) === path.resolve(entry.root, entry.sourcePath)
        && source.sha256 === selected.scan.entries.find((candidate) => candidate.path === path.resolve(entry.root, entry.sourcePath))?.hash))) {
        run = await options.research.indexSources(request.root, originals, request.metadata, request.projectId);
        while (['queued', 'quick', 'full'].includes(run.status)) {
          if (Date.now() > deadline) throw new Error('Updated text indexing remains unfinished');
          await pause(); run = (await options.research.read(request.root, request.projectId))!;
        }
      }
      const mismatch = originals.some((entry) => !run.sources.some((source) =>
        path.resolve(source.root, source.path) === path.resolve(entry.root, entry.sourcePath)
        && source.sha256 === selected.scan.entries.find((candidate) => candidate.path === path.resolve(entry.root, entry.sourcePath))?.hash));
      await journal.snapshot(request.projectId, { domain: 'text', sources: run.sources.map((source) => source.id), index: run });
      return { partial: mismatch || run.status !== 'complete' || discovered.length > 12 || selected.scan.gaps.length > 0,
        message: `Text indexed: ${run.coverage.pagesAnalyzed}/${run.coverage.pagesTotal} selected pages.${mismatch ? ' Current source revisions remain unindexed; another active job returned stale evidence.' : ''}${discovered.length > 12 ? ' More than 12 originals: remaining sources still need a separate batch.' : ''}` };
    },
    enqueueImages: async (request) => {
      const selected = await manifest(request);
      const pdfs = selected.scan.entries.filter((entry) => /\.pdf$/i.test(entry.path));
      const unsupported = selected.scan.entries.filter((entry) => !/\.(pdf|txt|md)$/i.test(entry.path));
      if (!pdfs.length) return { partial: unsupported.length > 0, message: unsupported.length ? 'Standalone image/DOCX visual indexing still needs a supported reader.' : 'No PDF visual sources remain.' };
      const targets = new Set(pdfs.map((entry) => entry.hash.slice(0, 24)));
      let catalog = await options.intake.start(request.root, { paths: pdfs.map((entry) => entry.path), retry: true });
      const deadline = Date.now() + 2 * 60 * 60 * 1000;
      while (catalog.documents.some((entry) => targets.has(entry.id) && ['queued', 'processing'].includes(entry.status))) {
        if (Date.now() > deadline) throw new Error('Image indexing remains unfinished after the coordinator time limit');
        await pause(); catalog = await options.intake.catalog(request.root);
      }
      await journal.snapshot(request.projectId, { domain: 'images', sources: pdfs.map((entry) => entry.path), index: catalog });
      const current = catalog.documents.filter((entry) => targets.has(entry.id));
      const incompleteTables = catalog.assets.filter((entry) => targets.has(entry.documentId) && entry.kind === 'table' && entry.tableData?.complete !== true);
      const indexed = current.reduce((sum, entry) => sum + entry.completedPages, 0), total = current.reduce((sum, entry) => sum + entry.pageCount, 0);
      return { partial: unsupported.length > 0 || incompleteTables.length > 0 || selected.scan.gaps.length > 0 || current.length !== pdfs.length || current.some((entry) => entry.status !== 'ready' || entry.completedPages !== entry.pageCount),
        message: `Page/crop indexing: ${indexed}/${total} PDF pages; ${catalog.assets.filter((entry) => targets.has(entry.documentId) && entry.kind !== 'page' && entry.status === 'ready').length} reusable crops.${incompleteTables.length ? ` ${incompleteTables.length} table transcriptions need review.` : ''}${unsupported.length ? ' Standalone images/DOCX remain unindexed visually.' : ''}` };
    },
  });
  const custodians = new ProjectCustodianService({ dataDir: options.dataDir, recordEvent: async (event) => {
    if (!event.projectId) return;
    await journal.append(event.projectId, { domain: event.domain, type: event.type === 'custodian-query-failed' ? 'gap' : 'query',
      summary: `${event.type === 'custodian-query-started' ? 'Search started' : event.type === 'custodian-query-completed' ? 'Search answered' : 'Search failed'}: ${event.question}` });
  } });
  const watch = {
    activate: async (input: { projectId: string; root: string; metadata?: ProjectMetadata | null | undefined; active: true }) => {
      const selected = await roots(input.root, input.metadata);
      return watcher.activate({ projectId: input.projectId, root: selected.canonical, metadata: input.metadata ?? { kind: 'prototype' }, active: true,
        sourceRoots: selected.all.slice(1), excludedRoots: [path.resolve(selected.canonical, selected.config.outputDir)] });
    },
    deactivate: (projectId: string) => watcher.deactivate(projectId),
    status: (projectId: string) => watcher.status(projectId),
    close: () => watcher.close(),
  };
  return { custodians, journal, watch };
}
