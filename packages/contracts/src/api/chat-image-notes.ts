import type { ChatAttachment } from './chat.js';

// A note pinned to an image travels inside the user turn itself, so the classic
// prompt, OD Next, API mode and every later turn's transcript carry it without
// a path of their own. The chat shows each note with its image and hides this
// block (`withoutImageNotes`).
const OPEN = '<image-notes>';
const CLOSE = '</image-notes>';
const TRAILING_BLOCK = /(?:^|\n\n)<image-notes>\n[\s\S]*\n<\/image-notes>$/;

export function imageNotesBlock(attachments: readonly ChatAttachment[]): string {
  const annotated = attachments
    .map((attachment, index) => ({ attachment, order: attachment.order ?? index }))
    .filter(({ attachment }) => attachment.kind === 'image' && attachment.annotation?.note.trim())
    .sort((a, b) => a.order - b.order);
  if (!annotated.length) return '';
  return [
    OPEN,
    'The engineer attached these notes to images in this message. Each note is about the image named before it; red marks drawn on that image show the part the note refers to. Open the image before acting on its note.',
    ...annotated.map(({ attachment }) => {
      const { note, sourcePath } = attachment.annotation!;
      const source = sourcePath && sourcePath !== attachment.path ? `, marks drawn on \`${sourcePath}\`` : '';
      return `- \`${attachment.path}\`${source}: ${note.trim().slice(0, 2000).replace(/\r?\n/g, '\n  ')}`;
    }),
    CLOSE,
  ].join('\n');
}

/** The turn as the agent receives it: the typed text, then the notes. Applying it twice changes nothing. */
export function withImageNotes(prompt: string, attachments: readonly ChatAttachment[]): string {
  const text = withoutImageNotes(prompt);
  const block = imageNotesBlock(attachments);
  return block ? [text, block].filter(Boolean).join('\n\n') : text;
}

/** The turn as the engineer typed it. */
export function withoutImageNotes(content: string): string {
  const match = TRAILING_BLOCK.exec(content);
  return match ? content.slice(0, match.index) : content;
}
