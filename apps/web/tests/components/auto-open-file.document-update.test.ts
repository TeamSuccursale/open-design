import { describe, expect, it } from 'vitest';
import {
  isRegisteredDocumentCopy,
  registeredDocumentEntryNames,
  selectAutoOpenProducedArtifact,
  selectAutoOpenTurnArtifacts,
} from '../../src/components/auto-open-file';

// UX-01: the Fast design update of 26 October rewrote the registered document in
// place and also created a `-v2.html` copy. The created-this-turn tie-break
// focused the copy, so the canonical preview never refreshed on screen.
const parent = 'parent-collection', child = 'child-workspace', documentId = 'doc-75b5';
const document = (entryFile: string | undefined, overrides: Record<string, unknown> = {}) => ({
  id: documentId, projectId: parent, workspaceProjectId: child, entryFile, archivedAt: null, ...overrides,
});
const html = (name: string, mtime: number) => ({ name, path: name, kind: 'html', mtime });
const canonical = `documents/${documentId}/relazione-finale-rapida.html`;
const copy = `documents/${documentId}/relazione-finale-rapida-v2.html`;

describe('registeredDocumentEntryNames', () => {
  it('names a child-owned document under its managed folder in the parent collection', () => {
    expect([...registeredDocumentEntryNames([document('relazione-finale-rapida.html')], parent)]).toEqual([canonical]);
    expect([...registeredDocumentEntryNames([document('relazione-finale-rapida.html')], child)]).toEqual(['relazione-finale-rapida.html']);
    expect(registeredDocumentEntryNames([document('relazione-finale-rapida.html')], 'unrelated').size).toBe(0);
  });
  it('ignores proposal comparisons, archived documents and documents without a designed file', () => {
    expect(registeredDocumentEntryNames([
      document(`documents/${documentId}/blockout-comparison.html`, { workspaceProjectId: parent }),
      document('relazione.html', { archivedAt: '2026-10-26T00:00:00.000Z' }),
      document(undefined),
    ], parent).size).toBe(0);
  });
});

describe('a design update returns to the registered document', () => {
  const entries = registeredDocumentEntryNames([document('relazione-finale-rapida.html')], parent);
  const files = [html(canonical, 5_000), html(copy, 4_000)];
  const turn = { preTurnFileNames: new Set([canonical]), turnStartedAt: 1_000, turnEndedAt: 6_000 };

  it('reproduces the original focus on the created copy without registry knowledge', () => {
    expect(selectAutoOpenTurnArtifacts([html(copy, 4_000)], files, turn).focused).toBe(copy);
  });
  it('focuses the rewritten canonical entry and does not open the copy beside it', () => {
    expect(selectAutoOpenTurnArtifacts([html(copy, 4_000)], files, { ...turn, registeredDocumentEntries: entries }))
      .toEqual({ focused: canonical, open: [canonical] });
    expect(selectAutoOpenProducedArtifact(files, { preTurnFileNames: turn.preTurnFileNames, registeredDocumentEntries: entries }))
      .toBe(canonical);
  });
  it('still surfaces the copy when the run never touched the canonical entry', () => {
    expect(selectAutoOpenTurnArtifacts([html(copy, 4_000)], [html(canonical, 500), html(copy, 4_000)], { ...turn, turnStartedAt: 3_000, registeredDocumentEntries: entries }).focused)
      .toBe(copy);
  });
  it('keeps a first design opening while the registered entry is only the comparison', () => {
    const comparison = `documents/${documentId}/blockout-comparison.html`, design = `documents/${documentId}/relazione.html`;
    const beforeDesign = registeredDocumentEntryNames([document(comparison, { workspaceProjectId: parent })], parent);
    expect(selectAutoOpenTurnArtifacts([html(design, 4_000)], [html(comparison, 4_500), html(design, 4_000)], {
      preTurnFileNames: new Set([comparison]), turnStartedAt: 1_000, turnEndedAt: 6_000, registeredDocumentEntries: beforeDesign,
    }).focused).toBe(design);
  });
});

describe('isRegisteredDocumentCopy', () => {
  const entries = new Set([canonical, `documents/${documentId}/fascicolo.html`]);
  it.each([copy, `documents/${documentId}/relazione-finale-rapida_bozza.html`, `documents/${documentId}/Relazione-Finale-Rapida.v2.HTML`])('treats %s as a copy', (name) => {
    expect(isRegisteredDocumentCopy(name, entries)).toBe(true);
  });
  it.each([
    canonical,
    `documents/${documentId}/fascicolo.html`,
    `documents/${documentId}/blockout-comparison.html`,
    `documents/${documentId}/relazione-finale-rapidamente.html`,
    `documents/other/relazione-finale-rapida-v2.html`,
    `documents/${documentId}/relazione-finale-rapida-v2.png`,
  ])('keeps %s eligible', (name) => {
    expect(isRegisteredDocumentCopy(name, entries)).toBe(false);
  });
  it('has no effect without registered documents', () => {
    expect(isRegisteredDocumentCopy(copy, new Set())).toBe(false);
    expect(isRegisteredDocumentCopy(copy, null)).toBe(false);
  });
});
