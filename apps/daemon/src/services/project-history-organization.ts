import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ProjectOrganizationCandidate, ProjectOrganizationReview } from '@open-design/contracts';
import type { StoredHistoryFile } from './project-history-files.js';

/** Conservative inventory advice. It never moves, removes, or declares a file obsolete. */
export async function reviewHistoryOrganization(files: StoredHistoryFile[], reason: ProjectOrganizationReview['reason'], now: number, text: (file: StoredHistoryFile) => Promise<string>): Promise<ProjectOrganizationReview> {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const references = new Map<string, Set<string>>();
  let scanned = 0, bytes = 0;
  const limitations = ['La presenza di una variante o di un backup non ne dimostra l’obsolescenza. Nessun file è stato spostato o eliminato.'];
  for (const file of files) {
    if (!/\.(?:html?|css|js|mjs|cjs|ts|tsx|jsx|json|md|svg|xml|tex)$/i.test(file.path) || file.size > 512_000) continue;
    if (++scanned > 2000 || (bytes += file.size) > 16_000_000) { limitations.push('La ricerca dei collegamenti è limitata a 2.000 file testuali e 16 MB; possono esistere altre dipendenze.'); break; }
    const content = await text(file);
    const pattern = /(?:src|href|imagePath|sourcePath|file|path)["']?\s*[=:]\s*["']([^"']+)["']|url\(\s*["']?([^\s"')]+)|(?:import|from)\s*["']([^"']+)["']/g;
    for (const match of content.matchAll(pattern)) {
      const target = (match[1] ?? match[2] ?? match[3] ?? '').split(/[?#]/)[0]!;
      if (!target || /^(?:[a-z]+:|\/\/)/i.test(target)) continue;
      let decoded: string;
      try { decoded = decodeURIComponent(target).replaceAll('\\', '/'); } catch { continue; }
      for (const candidate of [path.posix.normalize(path.posix.join(path.posix.dirname(file.path), decoded)), path.posix.normalize(decoded.replace(/^\//, ''))]) {
        if (!byPath.has(candidate)) continue;
        if (!references.has(candidate)) references.set(candidate, new Set());
        references.get(candidate)!.add(file.path);
      }
    }
  }
  const protectedPaths: string[] = [], candidates: ProjectOrganizationCandidate[] = [];
  for (const file of files) {
    const protectedName = /(?:^|\/)(?:AGENTS\.md|README(?:\.[^/]+)?|PRODUCT\.md|DESIGN\.md|package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|intake\.config\.json)$/i.test(file.path);
    const protectedFolder = /(?:^|\/)(?:originali?|originals?|sources?|contesto|context|\.context|docs?|documents|assets|intake-assets|blockout|blockouts)(?:\/|$)/i.test(file.path);
    const referencedBy = [...(references.get(file.path) ?? [])].sort();
    if (protectedName || protectedFolder || referencedBy.length) { protectedPaths.push(file.path); continue; }
    const backup = /(?:^|[\/_. -])(?:backup|bak|old|copia)(?:[\/_. -]|$)/i.test(file.path) || /\.(?:bak|old)$/i.test(file.path);
    const variant = /(?:^|\/)(?:generated|outputs?|exports?|variants?|proposals?|bozze|drafts?)(?:\/|$)/i.test(file.path) || /(?:proposta|variante|alternativa|bozza)/i.test(path.posix.basename(file.path));
    if (backup || variant) candidates.push({ path: file.path, reason: backup ? 'Il nome indica una copia o un backup. Verifica se serve ancora e se esistono dipendenze non rilevate.' : 'Possibile variante generata: confrontala con il lavoro corrente prima di decidere dove conservarla.', suggestedAction: backup ? 'archive-candidate' : 'review', referencedBy });
  }
  if (candidates.length > 1000) limitations.push('Sono mostrate le prime 1.000 possibili copie o varianti; il conteggio comprende tutti i file.');
  return { id: randomUUID(), createdAt: new Date(now).toISOString(), reason, status: 'ready', summary: candidates.length ? `${candidates.length} possibili copie o varianti da esaminare; originali, contesto e dipendenze restano protetti.` : 'L’inventario non segnala copie o varianti da separare. Originali, contesto e dipendenze restano protetti.', fileCount: files.length, totalBytes: files.reduce((sum, file) => sum + file.size, 0), candidates: candidates.slice(0, 1000), protectedPaths, limitations };
}
