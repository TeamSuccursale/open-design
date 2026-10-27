import type { ReactNode } from 'react';
import type { ChatAttachment } from '@open-design/contracts';
import { ChatCloseIcon } from './primitives/icons';
import styles from './ImageNoteCard.module.css';

/** An image that carries a note is shown as a card instead of a bare thumbnail. */
export function isNotedImage(attachment: Pick<ChatAttachment, 'kind' | 'annotation'>): boolean {
  return attachment.kind === 'image' && Boolean(attachment.annotation?.note.trim());
}

export function ImageNoteList({ placement, children }: { placement: 'message' | 'composer'; children: ReactNode }) {
  return <div className={`${styles.list} ${styles[placement]}`} data-testid="image-note-list">{children}</div>;
}

/**
 * An image and the note the engineer pinned to it, shown as one tile: in the
 * composer before sending and above the bubble once sent. Like a quoted reply
 * in Claude, the note reads first and a chip below names what it refers to;
 * the whole tile opens the image. The note is never repeated in the message text.
 */
export function ImageNoteCard({ src, name, note, openLabel, onOpen, removeLabel, onRemove }: {
  src: string | null;
  name: string;
  note: string;
  openLabel: string;
  onOpen?: () => void;
  removeLabel?: string;
  onRemove?: () => void;
}) {
  return (
    <figure className={`${styles.card}${onOpen ? ` ${styles.openable}` : ''}`} data-testid="image-note-card">
      {onOpen ? (
        <button type="button" className={styles.open} onClick={onOpen} aria-label={openLabel} title={openLabel} />
      ) : null}
      <figcaption className={styles.note}>{note}</figcaption>
      <span className={styles.chip}>
        {src ? <img className={styles.thumb} src={src} alt="" aria-hidden /> : <span className={styles.thumb} aria-hidden />}
        <span className={styles.name} title={name}>{name}</span>
      </span>
      {onRemove ? (
        <button type="button" className={styles.remove} onClick={onRemove} aria-label={removeLabel} title={removeLabel}>
          <ChatCloseIcon size={10} />
        </button>
      ) : null}
    </figure>
  );
}
