import type { CustodianStatusSnapshot, IntakeStatusSnapshot, ResearchStatusSnapshot } from './project-preparation-status';

export interface PreparationSource {
  path: string;
  title: string;
  total: number;
  textPages: number;
  imagePages: number;
  stale: boolean;
  failed: boolean;
}
const normalize = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
const pageCount = (pages: number[], total: number) => new Set(pages.filter((page) => page > 0 && page <= total)).size;

/** Join verified coverage by path, never by filename: different folders may contain the same filename. */
export function projectPreparationSources(intake: IntakeStatusSnapshot | null, research: ResearchStatusSnapshot | null, custodian: CustodianStatusSnapshot | null): PreparationSource[] {
  const sources = new Map<string, PreparationSource>();
  for (const source of research?.run?.sources ?? []) {
    const coverage = research?.run?.coverage.sources.find((item) => item.sourceId === source.id);
    sources.set(normalize(source.path), {
      path: source.path, title: source.title, total: source.pagesTotal,
      textPages: pageCount(coverage?.analyzedPages ?? [], source.pagesTotal), imagePages: 0,
      stale: false, failed: Boolean(coverage?.unreadablePages.length),
    });
  }
  for (const source of custodian?.ledger?.sources ?? []) {
    sources.set(normalize(source.path), {
      path: source.path, title: source.title, total: source.pagesTotal,
      textPages: pageCount(source.textAnalyzedPages, source.pagesTotal), imagePages: pageCount(source.visualIndexedPages, source.pagesTotal),
      stale: source.status !== 'current', failed: source.status === 'unavailable',
    });
  }
  for (const document of intake?.catalog.documents ?? []) {
    const key = normalize(document.sourcePath);
    // A relative intake path may match an absolute verified path only unambiguously.
    const matches = [...sources.keys()].filter((path) => path === key || (!/^(?:[a-z]:|\/)/.test(key) && path.endsWith(`/${key}`)));
    const target = matches.length === 1 ? matches[0]! : key;
    const previous = sources.get(target);
    sources.set(target, {
      path: previous?.path ?? document.sourcePath, title: previous?.title ?? document.name,
      total: previous?.total || document.pageCount, textPages: previous?.textPages ?? 0,
      imagePages: previous?.stale ? previous.imagePages : pageCount(document.indexedPages, document.pageCount),
      stale: previous?.stale ?? false, failed: Boolean(previous?.failed || document.status === 'failed'),
    });
  }
  return [...sources.values()];
}
