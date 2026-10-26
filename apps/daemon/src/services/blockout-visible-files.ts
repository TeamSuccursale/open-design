import { readFile } from 'node:fs/promises';
import { blockoutFileTarget, blockoutPageFiles, blockoutWorkspacePath, type BlockoutDocument } from '@open-design/contracts';
import { readBlockoutWorkspace } from './blockout-workspaces.js';
import { containedIntakePath } from './project-intake-settings.js';

/** Setup records page geometry before the agent has proposed any blocks. */
function isUntouchedSetupSeed(document: BlockoutDocument): boolean {
  return document.planningStage === 'structure'
    && document.activeVariantId === 'brief' && document.variants.length === 1
    && document.variants[0]?.id === 'brief'
    && !document.selectedVariantId && !document.approval && !document.needsReadaptation
    && document.answers.length === 0
    && document.variants[0].pages.every((page) => page.blocks.length === 0 && !page.feedback && page.references.length === 0);
}

/** Hide only the unchanged generated seed files, never user edits or legacy layouts. */
export async function visibleBlockoutFiles<T extends { name: string; size: number }>(root: string, files: T[]): Promise<T[]> {
  const candidates = new Map<string, T[]>();
  for (const file of files) {
    const target = blockoutFileTarget(file.name);
    if (!target || !(target.pageId || file.name === 'blockout/layout.json')) continue;
    const group = candidates.get(target.documentId) ?? [];
    group.push(file); candidates.set(target.documentId, group);
  }
  const hidden = new Set<string>();
  // An invalid or concurrently changing workspace must leave files accessible.
  await Promise.all([...candidates].slice(0, 50).map(async ([documentId, group]) => {
    try {
      const { document } = await readBlockoutWorkspace(root, documentId);
      if (!document || !isUntouchedSetupSeed(document)) return;
      const expected = new Map(blockoutPageFiles(document).map((file) => [file.path, file.content]));
      for (const file of group) {
        if (file.name === blockoutWorkspacePath(documentId)) { hidden.add(file.name); continue; }
        const content = expected.get(file.name);
        if (content === undefined || Buffer.byteLength(content) !== file.size) continue;
        const actual = await readFile(await containedIntakePath(root, file.name), 'utf8');
        if (actual === content) hidden.add(file.name);
      }
    } catch { /* Keep malformed, missing, or independently edited files visible. */ }
  }));
  return files.filter((file) => !hidden.has(file.name) && !/(?:^|\/)blockouts\/[\w.-]+\/design\//.test(file.name.replaceAll('\\', '/')));
}
