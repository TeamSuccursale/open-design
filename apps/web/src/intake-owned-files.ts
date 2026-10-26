import type { ProjectIntakeCatalog, ProjectIntakeSettings } from '@open-design/contracts';

interface FileIdentity { readonly name?: string; readonly path?: string; readonly fullPath?: string }
// Ownership belongs to this authority-scoped fetched snapshot, not to a global
// filename cache or a new wire DTO. Files remain available to Files and Gallery.
const owned = new WeakSet<object>();
const normalized = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '');
function relativePath(value: string, root?: string): string | null {
  let result = normalized(value);
  if (root) {
    const prefix = normalized(root).replace(/\/$/, '') + '/';
    const windows = /^[a-z]:\//i.test(prefix);
    if ((windows ? result.toLowerCase().startsWith(prefix.toLowerCase()) : result.startsWith(prefix))) result = result.slice(prefix.length);
  }
  return !result || result.startsWith('/') || /^[a-z]:\//i.test(result) || result.split('/').includes('..') ? null : result;
}
export function markIntakeOwnedFiles<T extends FileIdentity>(files: readonly T[], settings?: ProjectIntakeSettings | null, catalog?: ProjectIntakeCatalog | null): void {
  const paths = new Set(['intake.config.json', 'intake-assets/catalog.json']);
  const add = (value?: string) => { const relative = value && relativePath(value, settings?.projectDir); if (relative) paths.add(relative); };
  add(settings?.configPath); add(settings?.catalogPath);
  for (const asset of catalog?.assets ?? []) { add(asset.imagePath); add(asset.tableDataPath); }
  for (const file of files) if ([file.name, file.path].some((value) => value && paths.has(normalized(value)))) owned.add(file);
}
export const isIntakeOwnedFile = (file: object): boolean => owned.has(file);

/** Also cleans previously persisted message copies against the current snapshot. */
export function filterIntakeOwnedFiles<T extends FileIdentity>(files: readonly T[], currentFiles: readonly FileIdentity[] = []): T[] {
  const paths = new Set(currentFiles.filter(isIntakeOwnedFile).flatMap((file) => [file.name, file.path].filter((value): value is string => !!value).map(normalized)));
  return files.filter((file) => !isIntakeOwnedFile(file) && ![file.name, file.path, file.fullPath].some((value) => value && paths.has(normalized(value))));
}
