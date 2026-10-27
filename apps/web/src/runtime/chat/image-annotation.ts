import type { ChatAttachment } from '@open-design/contracts';

/**
 * The attachment an image-viewer note stages: the marked copy when the engineer
 * drew on the image, the image itself otherwise. Either way it carries the note,
 * so the composer, the sent message and the agent see the two together.
 */
export function imageViewerAttachment({ sourcePath, note, marked, order }: {
  sourcePath: string;
  note: string;
  marked?: ChatAttachment | null;
  order: number;
}): ChatAttachment {
  const name = sourcePath.split('/').pop() || sourcePath;
  const text = note.trim();
  if (marked) return { ...marked, name, kind: 'image', order, ...(text ? { annotation: { note: text, sourcePath } } : {}) };
  return { path: sourcePath, name, kind: 'image', order, ...(text ? { annotation: { note: text } } : {}) };
}

/** One card per image: a second note on an image already in the composer joins the first. */
export function stageImageAnnotation(staged: readonly ChatAttachment[], next: ChatAttachment): ChatAttachment[] {
  const index = staged.findIndex((item) => item.path === next.path);
  if (index < 0) return [...staged, next];
  const current = staged[index]!;
  const notes = [current.annotation?.note, next.annotation?.note].map((note) => note?.trim()).filter(Boolean);
  if (!notes.length) return [...staged];
  const merged = { ...current, annotation: { ...(current.annotation ?? next.annotation), note: notes.join('\n') } };
  return staged.map((item, position) => (position === index ? merged : item));
}
