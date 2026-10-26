import { BlockoutDocumentSchema, type BlockoutDocument } from '@open-design/contracts';
import type { Dict } from '../../i18n/types';

export type EditHistory = { past: BlockoutDocument[]; future: BlockoutDocument[] };
export const emptyHistory = (): EditHistory => ({ past: [], future: [] });
export function historyChange(before: BlockoutDocument, after: BlockoutDocument): { key: keyof Dict; name: string; group: string } {
  for (const variant of after.variants) {
    const old = before.variants.find((item) => item.id === variant.id);
    if (!old) return { key: 'blockout.changeProposal', name: variant.label, group: '' };
    for (const page of variant.pages) {
      const previous = old.pages.find((item) => item.id === page.id);
      if (!previous) return { key: 'blockout.changeAddPage', name: page.label, group: '' };
      for (const block of page.blocks) {
        const former = previous.blocks.find((item) => item.id === block.id);
        if (!former) return { key: 'blockout.changeAddBlock', name: block.label, group: '' };
        const fields = Object.keys(block).filter((key) => JSON.stringify(block[key as keyof typeof block]) !== JSON.stringify(former[key as keyof typeof former]));
        if (fields.length) return { key: fields.includes('images') ? 'blockout.changeImages' : fields.includes('box') ? 'blockout.changeTransform' : 'blockout.changeBlock', name: block.label,
          group: fields.some((key) => ['box', 'images'].includes(key)) ? '' : `${variant.id}/${page.id}/${block.id}/${fields.join(',')}` };
      }
      const removed = previous.blocks.find((item) => !page.blocks.some((value) => value.id === item.id));
      if (removed) return { key: 'blockout.changeDeleteBlock', name: removed.label, group: '' };
      if (JSON.stringify(page) !== JSON.stringify(previous)) return { key: 'blockout.changePage', name: page.label, group: `${variant.id}/${page.id}/page` };
    }
    const removed = old.pages.find((item) => !variant.pages.some((value) => value.id === item.id));
    if (removed) return { key: 'blockout.changeDeletePage', name: removed.label, group: '' };
  }
  return { key: 'blockout.changeDocument', name: after.title, group: 'document' };
}
export function stepHistory(history: EditHistory, current: BlockoutDocument, redo = false, steps = 1) {
  const source = redo ? history.future : history.past, count = Math.min(Math.max(1, steps), source.length);
  const document = source.at(-count);
  if (!document) return null;
  const trail = [current, ...source.slice(source.length - count + 1).reverse()];
  return { document, history: redo ? { past: [...history.past, ...trail].slice(-200), future: source.slice(0, -count) }
    : { past: source.slice(0, -count), future: [...history.future, ...trail].slice(-200) } };
}
export function storeEditHistory(key: string, raw: string | null, current: BlockoutDocument, history: EditHistory) {
  try {
    let past = history.past, future = history.future;
    let value = JSON.stringify({ raw, current, past, future });
    while (value.length > 1_500_000 && (past.length || future.length)) {
      if (past.length >= future.length) past = past.slice(1); else future = future.slice(1);
      value = JSON.stringify({ raw, current, past, future });
    }
    if (value.length <= 1_500_000) localStorage.setItem(key, value);
  } catch { /* Server project history remains available when browser storage is full. */ }
}
export function loadEditHistory(key: string, raw: string | null, current: BlockoutDocument): EditHistory {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    const comparable = (doc: BlockoutDocument) => JSON.stringify({ ...doc, activeVariantId: '' });
    if (!value || value.raw !== raw || comparable(value.current) !== comparable(current)) return emptyHistory();
    return { past: value.past.slice(-200).map((item: unknown) => BlockoutDocumentSchema.parse(item)),
      future: value.future.slice(-200).map((item: unknown) => BlockoutDocumentSchema.parse(item)) };
  } catch { return emptyHistory(); }
}
