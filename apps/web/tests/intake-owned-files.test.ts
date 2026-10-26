import { describe, expect, it } from 'vitest';
import type { ProjectIntakeCatalog, ProjectIntakeSettings } from '@open-design/contracts';
import { filterIntakeOwnedFiles, isIntakeOwnedFile, markIntakeOwnedFiles } from '../src/intake-owned-files';
import { filterImplicitProducedFiles } from '../src/produced-files';
import { decideAgentFocusOpen, decideAutoOpenAfterWrite, selectAutoOpenTurnArtifacts } from '../src/components/auto-open-file';
import type { ProjectFile } from '../src/types';

const file = (name: string): ProjectFile => ({ name, path: name, kind: name.endsWith('.png') ? 'image' : 'code', mime: name.endsWith('.png') ? 'image/png' : 'application/json', size: 100, mtime: 10_000 });
const settings: ProjectIntakeSettings = { version: 1, sourceDirs: [], outputDir: 'prepared/custom', projectDir: 'C:\\Work', configPath: 'C:\\Work\\intake.config.json', catalogPath: 'C:\\Work\\intake-assets\\catalog.json', outputPath: 'C:\\Work\\prepared\\custom', uploadPath: 'C:\\Work\\sources' };
const asset = (imagePath: string, tableDataPath?: string): ProjectIntakeCatalog['assets'][number] => ({ id: imagePath, documentId: 'doc', sourcePath: 'source.pdf', sourceName: 'source.pdf', page: 1, box: [0, 0, 1000, 1000], imagePath, width: 800, height: 600, kind: 'page', title: 'Extracted page', description: '', tags: [], status: 'ready', tableDataPath });
const catalog: ProjectIntakeCatalog = { version: 1, documents: [], assets: [asset('prepared/custom/doc/page-0001.png'), asset('prepared/custom/doc/crop.png', 'prepared/custom/doc/crop.table.json')] };
const snapshot = () => ['intake.config.json', 'intake-assets/catalog.json', 'prepared/custom/doc/page-0001.png', 'prepared/custom/doc/crop.png', 'prepared/custom/doc/crop.table.json', 'prepared/custom/designed.png', 'catalog.json', 'report.table.json', 'outputs/report.json'].map(file);

describe('intake-owned files at the chat deliverable boundary', () => {
  it('excludes only reserved metadata and exact catalog assets, preserving the complete gallery/file snapshot', () => {
    const files = snapshot(), before = structuredClone(files); markIntakeOwnedFiles(files, settings, catalog);
    expect(filterImplicitProducedFiles(files).map((entry) => entry.name)).toEqual(['prepared/custom/designed.png', 'catalog.json', 'report.table.json', 'outputs/report.json']);
    expect(files).toEqual(before);
    expect(filterIntakeOwnedFiles(structuredClone(files), files).map((entry) => entry.name)).toEqual(['prepared/custom/designed.png', 'catalog.json', 'report.table.json', 'outputs/report.json']);
  });
  it('never opens concurrent extraction outputs from diffs, mtime inference or a declared focus', () => {
    const files = snapshot().slice(0, 5); markIntakeOwnedFiles(files, settings, catalog);
    const options = { turnStartedAt: 9_000, turnEndedAt: 11_000 };
    expect(selectAutoOpenTurnArtifacts(structuredClone(files), files, options)).toEqual({ open: [], focused: null });
    expect(selectAutoOpenTurnArtifacts([], files, options)).toEqual({ open: [], focused: null });
    expect(decideAutoOpenAfterWrite(files[2]!.path!, files).shouldOpen).toBe(false);
    expect(decideAgentFocusOpen({ declaredPath: files[2]!.path!, projectFiles: files, preTurnFileNames: new Set(), userTookOverPreview: false }).shouldOpen).toBe(false);
    const output = file('prepared/custom/designed.png');
    expect(selectAutoOpenTurnArtifacts([output], [...files, output], options)).toEqual({ open: [output.name], focused: output.name });
  });
  it('does not transfer ownership to a different authority snapshot with identical names', () => {
    const files = snapshot(); markIntakeOwnedFiles(files, settings, catalog);
    const anotherProject = file('prepared/custom/doc/crop.png');
    expect(isIntakeOwnedFile(anotherProject)).toBe(false);
    expect(filterImplicitProducedFiles([anotherProject])).toEqual([anotherProject]);
    expect(selectAutoOpenTurnArtifacts([anotherProject], [anotherProject])).toEqual({ open: [anotherProject.name], focused: anotherProject.name });
  });
  it('keeps ordinary JSON when only intake metadata is known and ignores paths outside the project root', () => {
    const files = [file('intake.config.json'), file('catalog.json'), file('custom/report.json')];
    markIntakeOwnedFiles(files, { ...settings, catalogPath: 'C:\\OtherProject\\catalog.json' });
    expect(filterImplicitProducedFiles(files).map((entry) => entry.name)).toEqual(['catalog.json', 'custom/report.json']);
  });
});
