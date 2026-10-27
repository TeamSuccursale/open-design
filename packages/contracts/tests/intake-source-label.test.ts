import { describe, expect, it } from 'vitest';
import { intakeSourceLabel } from '../src/api/project-intake.js';

const paged = (name: string, page: number) => `${name} · pagina ${page}`;

describe('intakeSourceLabel', () => {
  it('names the page of a figure cut from a PDF', () => {
    expect(intakeSourceLabel({ sourceName: 'tavola.pdf', sourcePath: 'sources/tavola.pdf', page: 4 }, paged)).toBe('tavola.pdf · pagina 4');
  });

  it('gives an image taken in on its own only its file name', () => {
    expect(intakeSourceLabel({ sourceName: 'pianta.png', sourcePath: 'pianta.png', page: 1 }, paged)).toBe('pianta.png');
    expect(intakeSourceLabel({ sourceName: 'foto.JPG', sourcePath: 'sources/foto.JPG', page: 1 }, paged)).toBe('foto.JPG');
  });
});
