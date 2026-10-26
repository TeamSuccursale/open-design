import { describe, expect, it } from 'vitest';
import { decideAgentFocusOpen, decideAutoOpenAfterWrite, isBlockoutBriefFile, isHeaderFooterSupportFile, selectAutoOpenProducedArtifacts, selectAutoOpenTurnArtifacts, selectBuildPreviewHtmlEntry } from '../../src/components/auto-open-file';

const file = (name: string, kind = 'image') => ({ name, path: name, kind, mtime: 10_000 });
const paths = [
  'header-footer/doc/assets/logo.svg',
  'documents/doc/header-footer/doc/assets/uuid-logo.svg',
  'documents/doc/header-footer/doc/assets/logo.png',
  'inputs/assets/header-footer/logo.png',
  'header-footer/doc/preview.html',
  'documents/doc/header-footer/doc/preview.html',
];
describe('managed header/footer auto-preview eligibility', () => {
  it('never retargets the composer to the internal saved Blockout brief, while preserving ordinary Markdown', () => {
    for (const name of ['blockout/brief.md', 'documents/doc/blockout/brief.md', 'documents\\doc\\blockout\\brief.md']) {
      const brief = file(name, 'text');
      expect(isBlockoutBriefFile(brief)).toBe(true);
      expect(decideAutoOpenAfterWrite(name, [brief]).shouldOpen).toBe(false);
      expect(selectAutoOpenProducedArtifacts([brief])).toEqual({ focused: null, open: [] });
      expect(selectAutoOpenTurnArtifacts([], [brief], { turnStartedAt: 9_000 })).toEqual({ focused: null, open: [] });
      expect(decideAgentFocusOpen({ declaredPath: name, projectFiles: [brief], preTurnFileNames: new Set(), userTookOverPreview: false }).shouldOpen).toBe(false);
    }
    for (const name of ['brief.md', 'documents/report/brief.md', 'blockout/notes.md', 'notblockout/brief.md']) {
      const output = file(name, 'text');
      expect(isBlockoutBriefFile(output)).toBe(false);
      expect(selectAutoOpenProducedArtifacts([output])).toEqual({ focused: name, open: [name] });
    }
  });
  it.each(paths)('keeps %s available but out of inferred navigation', (name) => {
    const candidate = file(name, name.endsWith('.html') ? 'html' : 'image');
    expect(isHeaderFooterSupportFile(candidate)).toBe(true);
    expect(decideAutoOpenAfterWrite(name, [candidate]).shouldOpen).toBe(false);
    expect(selectAutoOpenProducedArtifacts([candidate])).toEqual({ focused: null, open: [] });
    expect(selectAutoOpenTurnArtifacts([], [candidate], { turnStartedAt: 9_000 })).toEqual({ focused: null, open: [] });
    expect(selectBuildPreviewHtmlEntry([candidate])).toBeNull();
    expect(candidate.path).toBe(name); // No mutation/removal from the user's file snapshot.
  });
  it('preserves document artifacts and standalone user gallery images', () => {
    const logo = file(paths[2]!);
    const body = file('documents/doc/blockout-comparison.html', 'html');
    const image = file('gallery/project-photo.png');
    expect(selectAutoOpenProducedArtifacts([logo, body])).toEqual({ focused: body.name, open: [body.name] });
    expect(decideAutoOpenAfterWrite(image.path, [image])).toEqual({ shouldOpen: true, fileName: image.name });
    expect(isHeaderFooterSupportFile(file('header-footer-study.png'))).toBe(false);
  });
  it('allows an explicit canonical preview focus while declining asset focus', () => {
    for (const path of [paths[1]!, paths[5]!]) {
      const candidate = file(path);
      expect(decideAgentFocusOpen({ declaredPath: path, projectFiles: [candidate], preTurnFileNames: new Set(), userTookOverPreview: false }).shouldOpen).toBe(path.endsWith('preview.html'));
    }
    expect(isHeaderFooterSupportFile(file('C:\\Work\\documents\\doc\\HEADER-FOOTER\\doc\\assets\\logo.svg'))).toBe(true);
  });
});
