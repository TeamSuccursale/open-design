// A note the engineer pins to an image travels with that image: the chat shows
// them together, and the agent reads the note next to the image's path on every
// prompt path, because the note rides inside the user turn.
import { describe, expect, it } from 'vitest';
import {
  formatIntakeAttachmentContext, imageNotesBlock, isIntakeImageSource, withImageNotes, withoutImageNotes,
  type ChatAttachment, type IntakeAsset,
} from '../src/index.js';

const marked: ChatAttachment = {
  path: 'drawing-2026-10-27.png', name: 'facciata.jpg', kind: 'image', order: 2,
  annotation: { note: 'Questa crepa va descritta in B.2.\nIndica anche la larghezza.', sourcePath: 'rilievo/facciata.jpg' },
};
const whole: ChatAttachment = { path: 'rilievo/pianta.png', name: 'pianta.png', kind: 'image', order: 1, annotation: { note: 'Usa questa pianta nel fascicolo A3.' } };
const plain: ChatAttachment = { path: 'rilievo/sezione.png', name: 'sezione.png', kind: 'image', order: 3 };
const file: ChatAttachment = { path: 'capitolato.pdf', name: 'capitolato.pdf', kind: 'file', order: 4, annotation: { note: 'not an image' } };

describe('image notes', () => {
  it('names each annotated image, the image its marks were drawn on, and the note', () => {
    const block = imageNotesBlock([marked, plain, whole, file]);
    expect(block.startsWith('<image-notes>')).toBe(true);
    expect(block.endsWith('</image-notes>')).toBe(true);
    // User-visible order, not array order.
    expect(block.indexOf('rilievo/pianta.png')).toBeLessThan(block.indexOf('drawing-2026-10-27.png'));
    expect(block).toContain('`drawing-2026-10-27.png`, marks drawn on `rilievo/facciata.jpg`: Questa crepa va descritta in B.2.\n  Indica anche la larghezza.');
    expect(block).toContain('`rilievo/pianta.png`: Usa questa pianta nel fascicolo A3.');
    expect(block).not.toContain('sezione.png');
    expect(block).not.toContain('capitolato.pdf');
    expect(imageNotesBlock([plain, file])).toBe('');
  });

  it('adds the notes to the turn once and removes them again for display', () => {
    const prompt = 'Scrivi il paragrafo B.2.';
    const sent = withImageNotes(prompt, [marked, whole]);
    expect(sent.startsWith(`${prompt}\n\n<image-notes>`)).toBe(true);
    expect(withImageNotes(sent, [marked, whole])).toBe(sent);
    expect(withoutImageNotes(sent)).toBe(prompt);
    expect(withoutImageNotes(prompt)).toBe(prompt);
    expect(withImageNotes(prompt, [plain])).toBe(prompt);
    const imageOnly = withImageNotes('', [whole]);
    expect(imageOnly.startsWith('<image-notes>')).toBe(true);
    expect(withoutImageNotes(imageOnly)).toBe('');
  });
});

describe('single images in the gallery', () => {
  it('accepts raster images as sources and matches them by the path the chat attached', () => {
    expect(isIntakeImageSource('rilievo/facciata.JPG')).toBe(true);
    expect(isIntakeImageSource('foto.webp')).toBe(true);
    expect(isIntakeImageSource('capitolato.pdf')).toBe(false);
    const asset: IntakeAsset = {
      id: 'abc-image', documentId: 'abc', sourcePath: 'rilievo/facciata.jpg', sourceName: 'facciata.jpg', page: 1,
      box: [0, 0, 1000, 1000], imagePath: 'intake-assets/abc/image.png', width: 1200, height: 800, kind: 'image',
      title: 'Facciata nord', description: 'Fotografia della facciata nord con una crepa diagonale.', tags: ['facciata'], status: 'ready',
    };
    expect(formatIntakeAttachmentContext([asset], ['rilievo/facciata.jpg'])).toContain('Facciata nord');
    // A PDF's own path never selects every figure cut from it.
    expect(formatIntakeAttachmentContext([{ ...asset, sourcePath: 'capitolato.pdf' }], ['capitolato.pdf'])).toBe('');
  });
});
