import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { intakeVectorDirectory, type IntakeAsset, type IntakeVectorPreference, type IntakeVectorVersion, type ProjectIntakeCatalog, type RegisterIntakeVectorRequest, type SetIntakeVectorPreferenceRequest } from '@open-design/contracts';
import { containedIntakePath, insideDirectory } from './project-intake-settings.js';
import { withProjectHistoryMutation } from '../project-history-observer.js';

const indexPath = 'intake-assets/vector-links.json';
interface Link { path: string; label?: string }
interface Entry { links: Link[]; preference?: Omit<IntakeVectorPreference, 'available'> }
interface Index { version: 1; assets: Record<string, Entry> }
const locks = new Map<string, Promise<unknown>>();
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

async function readIndex(root: string): Promise<Index> {
  try {
    const file = await containedIntakePath(root, indexPath);
    if ((await stat(file)).size > 2 * 1024 * 1024) throw new Error('Vector links index is too large');
    const value = JSON.parse(await readFile(file, 'utf8')) as Index;
    if (value.version !== 1 || !value.assets || typeof value.assets !== 'object' || Array.isArray(value.assets)) throw new Error('Invalid vector links index');
    for (const entry of Object.values(value.assets)) {
      if (!entry || !Array.isArray(entry.links) || entry.links.length > 100 || entry.links.some((link) => !link || typeof link.path !== 'string' || (link.label !== undefined && typeof link.label !== 'string'))) throw new Error('Invalid vector links entry');
      const pref = entry.preference;
      if (pref && ['versionId', 'path', 'sha256', 'reason', 'updatedAt'].some((key) => typeof pref[key as keyof typeof pref] !== 'string')) throw new Error('Invalid SVG preference');
    }
    return value;
  } catch (error) { if (missing(error)) return { version: 1, assets: {} }; throw error; }
}

async function inspectVector(root: string, link: Link): Promise<IntakeVectorVersion> {
  if (!link.path || path.isAbsolute(link.path) || !/\.svg$/i.test(link.path)) throw new Error('Choose an SVG inside the project folder');
  const target = await containedIntakePath(root, link.path);
  const base = await realpath(root), actual = await realpath(target);
  if (!insideDirectory(base, actual)) throw new Error('SVG must stay inside the project');
  const info = await stat(actual);
  if (!info.isFile() || info.size > 4 * 1024 * 1024) throw new Error('SVG must be a file smaller than 4 MB');
  const bytes = await readFile(actual);
  const xml = load(bytes.toString('utf8'), { xml: true });
  const activeAttributes = xml('*').toArray().some((element) => 'attribs' in element && Object.entries(element.attribs).some(([name, value]) => /^on/i.test(name) || (/^(?:xlink:)?href$/i.test(name) && !value.startsWith('#'))));
  if (xml.root().children().length !== 1 || xml.root().children()[0]?.tagName !== 'svg'
    || activeAttributes || xml('script, foreignObject, image').length || !xml('path, rect, circle, ellipse, line, polyline, polygon, text, use').length) throw new Error('Expected a native vector SVG, without scripts or embedded raster images');
  const relative = path.relative(base, target).replaceAll('\\', '/');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { id: createHash('sha256').update(`${relative}\0${sha256}`).digest('hex').slice(0, 32), path: relative, label: (link.label?.trim() || path.basename(relative)).slice(0, 160), sha256, updatedAt: info.mtime.toISOString() };
}

async function vectorState(root: string, asset: IntakeAsset, entry?: Entry): Promise<IntakeAsset> {
  const links = [...(entry?.links ?? [])];
  const directory = intakeVectorDirectory(asset.id);
  try {
    const folder = await containedIntakePath(root, directory);
    for (const file of (await readdir(folder, { withFileTypes: true })).filter((file) => file.isFile() && /\.svg$/i.test(file.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, 100)) links.push({ path: `${directory}/${file.name}` });
  } catch (error) { if (!missing(error)) throw error; }
  // Recognize SVGs produced by the first shortcut before per-asset version folders existed.
  links.push({ path: `${directory}.svg` });
  const vectorVersions: IntakeVectorVersion[] = [];
  for (const link of links) {
    if (vectorVersions.length >= 100) break;
    try {
      const version = await inspectVector(root, link);
      if (!vectorVersions.some((item) => item.path === version.path)) vectorVersions.push(version);
    } catch { /* Incomplete, missing or non-vector files never become reusable versions. */ }
  }
  const preference = entry?.preference;
  const { vectorVersions: _oldVersions, vectorPreference: _oldPreference, ...source } = asset;
  return { ...source, vectorVersions, ...(preference ? { vectorPreference: { ...preference, available: vectorVersions.some((version) => version.id === preference.versionId && version.sha256 === preference.sha256) } } : {}) };
}

/** Read-only discovery: naming a version folder links its files to the original asset. */
export async function withIntakeVectors(root: string, catalog: ProjectIntakeCatalog): Promise<ProjectIntakeCatalog> {
  const index = await readIndex(root);
  const assets: IntakeAsset[] = [];
  for (const asset of catalog.assets) assets.push(await vectorState(root, asset, Object.hasOwn(index.assets, asset.id) ? index.assets[asset.id] : undefined));
  return { ...catalog, assets };
}

async function mutate(root: string, asset: IntakeAsset, action: (entry: Entry) => Promise<void>): Promise<IntakeAsset> {
  const canonical = await realpath(root);
  const task = (locks.get(canonical) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const index = await readIndex(canonical);
    const entry = Object.hasOwn(index.assets, asset.id) ? index.assets[asset.id]! : { links: [] };
    await action(entry);
    Object.defineProperty(index.assets, asset.id, { value: entry, enumerable: true, configurable: true, writable: true });
    await containedIntakePath(canonical, 'intake-assets', true);
    const destination = await containedIntakePath(canonical, indexPath);
    const temporary = await containedIntakePath(canonical, `${indexPath}.${randomUUID()}.tmp`);
    await withProjectHistoryMutation({ root: canonical, paths: [indexPath] }, async () => {
      await writeFile(temporary, JSON.stringify(index, null, 2));
      await rename(temporary, destination);
    });
    return vectorState(canonical, asset, entry);
  });
  locks.set(canonical, task);
  try { return await task; } finally { if (locks.get(canonical) === task) locks.delete(canonical); }
}

export async function registerIntakeVector(root: string, asset: IntakeAsset, input: RegisterIntakeVectorRequest): Promise<IntakeAsset> {
  if (!input || typeof input.path !== 'string' || input.path.length > 1200 || (input.label !== undefined && (typeof input.label !== 'string' || input.label.length > 160))) throw new Error('Expected a project-relative SVG path and optional label');
  const version = await inspectVector(root, input);
  return mutate(root, asset, async (entry) => {
    const existing = entry.links.find((link) => link.path === version.path);
    if (existing) existing.label = version.label;
    else { if (entry.links.length >= 100) throw new Error('At most 100 SVG links per source'); entry.links.push({ path: version.path, label: version.label }); }
  });
}

export async function preferIntakeVector(root: string, asset: IntakeAsset, input: SetIntakeVectorPreferenceRequest): Promise<IntakeAsset> {
  if (!input || (input.versionId !== null && typeof input.versionId !== 'string') || (input.reason !== undefined && typeof input.reason !== 'string') || (input.reason?.length ?? 0) > 12000) throw new Error('Expected a versionId and a preference explanation');
  return mutate(root, asset, async (entry) => {
    if (input.versionId === null) { delete entry.preference; return; }
    if (!input.reason?.trim()) throw new Error('Explain why you prefer this SVG version');
    const current = await vectorState(root, asset, entry);
    const version = current.vectorVersions?.find((item) => item.id === input.versionId);
    if (!version) throw new Error('SVG version is missing or changed. Refresh and choose it again.');
    entry.preference = { versionId: version.id, path: version.path, sha256: version.sha256, reason: input.reason.trim(), updatedAt: new Date().toISOString() };
  });
}
