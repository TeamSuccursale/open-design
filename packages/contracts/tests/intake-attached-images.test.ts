import { describe, expect, it } from 'vitest';
import type { ChatAttachment } from '../src/api/chat.js';
import { intakeImagesFromAttachments } from '../src/api/project-intake.js';

const image = (path: string, extra: Partial<ChatAttachment> = {}): ChatAttachment => ({ path, name: path.split('/').at(-1)!, kind: 'image', ...extra });

describe('intakeImagesFromAttachments', () => {
  it('keeps the images the engineer attached, once each, in the order they were attached', () => {
    expect(intakeImagesFromAttachments([image('foto.png'), image('rilievo/facciata.JPG'), image('foto.png')])).toEqual(['foto.png', 'rilievo/facciata.JPG']);
  });

  it('takes the image the marks were drawn on, not the marked copy', () => {
    const marked = image('drawing-2026-10-27T11-50-29-395Z.png', { annotation: { note: 'finestra', sourcePath: 'pianta.png' } });
    expect(intakeImagesFromAttachments([marked])).toEqual(['pianta.png']);
  });

  it('leaves out page screenshots, gallery assets and files the gallery cannot take', () => {
    expect(intakeImagesFromAttachments([
      image('drawing-2026-10-27T11-55-06-437Z.png'),
      image('intake-assets/plan.png'),
      image('designs/vector/map/v2.svg'),
      { path: 'tavola.pdf', name: 'tavola.pdf', kind: 'file' },
    ])).toEqual([]);
  });
});
