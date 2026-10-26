import path from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import type { ProjectIntakeConfig, ProjectIntakeSettings } from '@open-design/contracts';
import { isBlocked } from '../linked-dirs.js';
import { sandboxImportedProjectRootUnavailableReason } from '../sandbox-mode.js';
import { withProjectHistoryMutation } from '../project-history-observer.js';
import { replaceFileAtomically } from '../storage/atomic-file.js';

export const INTAKE_CONFIG_FILE = 'intake.config.json';
export const INTAKE_CATALOG_DIR = 'intake-assets';
const defaults: ProjectIntakeConfig = { version: 1, sourceDirs: [], outputDir: INTAKE_CATALOG_DIR };
const configWrites = new Map<string, Promise<unknown>>();
export function insideDirectory(root: string, target: string): boolean {
  const difference = path.relative(root, target);
  return difference === '' || (difference !== '..' && !difference.startsWith(`..${path.sep}`) && !path.isAbsolute(difference));
}

/** Validate the existing ancestor before creating any output directories. */
export async function containedIntakePath(root: string, relative: string, create = false): Promise<string> {
  const base = await realpath(root);
  const target = path.resolve(base, relative);
  if (!relative || path.isAbsolute(relative) || target === base || !insideDirectory(base, target)) throw new Error('Intake output must be a folder inside the project');
  let ancestor = target;
  while (true) {
    try {
      if (!insideDirectory(base, await realpath(ancestor))) throw new Error('Intake path must stay inside the project');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  if (create) {
    await mkdir(target, { recursive: true });
    if (!insideDirectory(base, await realpath(target))) throw new Error('Intake path must stay inside the project');
  }
  return target;
}

async function sourceDirectory(root: string, value: string): Promise<string> {
  const absolute = await realpath(path.resolve(root, value));
  if (!(await stat(absolute)).isDirectory()) throw new Error(`Source is not a folder: ${value}`);
  const home = await realpath(homedir()).catch(() => homedir());
  if (absolute === path.parse(absolute).root || absolute === home || isBlocked(absolute)
    || ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.codex'].some((name) => insideDirectory(path.join(home, name), absolute))) {
    throw new Error('Choose a project documents folder, not a system or credentials folder');
  }
  const unavailable = sandboxImportedProjectRootUnavailableReason(absolute);
  if (unavailable) throw new Error(unavailable);
  return absolute;
}

export async function validateIntakeConfig(root: string, value: unknown): Promise<ProjectIntakeConfig> {
  const input = value as Partial<ProjectIntakeConfig> | null;
  if (!input || input.version !== 1 || typeof input.outputDir !== 'string' || !Array.isArray(input.sourceDirs)
    || input.sourceDirs.length > 20 || !input.sourceDirs.every((entry) => typeof entry === 'string' && entry.trim())) throw new Error('Expected intake format version 1, outputDir and up to 20 sourceDirs');
  const outputDir = path.normalize(input.outputDir.trim());
  await containedIntakePath(root, outputDir);
  if (outputDir.split(path.sep).some((part) => part.startsWith('.')) || outputDir.split(path.sep).includes('node_modules')) throw new Error('Choose a regular project folder for extracted images');
  const sourceDirs: string[] = [];
  for (const source of input.sourceDirs) {
    const canonical = await sourceDirectory(root, source);
    if (!sourceDirs.includes(canonical) && canonical !== await realpath(root)) sourceDirs.push(canonical);
  }
  return { version: 1, sourceDirs, outputDir: outputDir.replaceAll('\\', '/') };
}

/** Loading tolerates an offline source drive; scans report which folder is unavailable. */
export async function readIntakeConfig(root: string): Promise<ProjectIntakeConfig> {
  try {
    const file = await containedIntakePath(root, INTAKE_CONFIG_FILE);
    const config = JSON.parse(await readFile(file, 'utf8')) as ProjectIntakeConfig;
    if (config.version !== 1 || typeof config.outputDir !== 'string' || !Array.isArray(config.sourceDirs)
      || config.sourceDirs.length > 20 || !config.sourceDirs.every((entry) => typeof entry === 'string' && entry.trim())) throw new Error('Invalid intake.config.json; restore format version 1');
    await containedIntakePath(root, config.outputDir);
    return config;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return { ...defaults, sourceDirs: [] };
}

export async function intakeSettings(root: string): Promise<ProjectIntakeSettings> {
  const projectDir = await realpath(root), config = await readIntakeConfig(projectDir);
  return { ...config, projectDir, configPath: path.join(projectDir, INTAKE_CONFIG_FILE),
    catalogPath: path.join(projectDir, INTAKE_CATALOG_DIR, 'catalog.json'),
    outputPath: await containedIntakePath(projectDir, config.outputDir), uploadPath: path.join(projectDir, 'sources') };
}

export async function writeIntakeConfig(root: string, value: unknown): Promise<ProjectIntakeSettings> {
  const canonical = await realpath(root);
  const previous = configWrites.get(canonical) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const config = await validateIntakeConfig(canonical, value);
    const target = await containedIntakePath(canonical, INTAKE_CONFIG_FILE);
    const temporary = await containedIntakePath(canonical, `${INTAKE_CONFIG_FILE}.${randomUUID()}.tmp`);
    await withProjectHistoryMutation({ root: canonical, paths: [INTAKE_CONFIG_FILE] }, async () => { try {
      await writeFile(temporary, JSON.stringify(config, null, 2), { flag: 'wx' });
      await replaceFileAtomically(temporary, target);
    } finally { await rm(temporary, { force: true }); }
    });
    return intakeSettings(canonical);
  });
  configWrites.set(canonical, next);
  try { return await next; }
  finally { if (configWrites.get(canonical) === next) configWrites.delete(canonical); }
}

/** External PDFs must be under an explicitly registered, canonical source folder. */
export async function resolveIntakeSource(root: string, source: string, config: ProjectIntakeConfig): Promise<string> {
  const absolute = await realpath(path.resolve(root, source));
  const base = await realpath(root);
  if (insideDirectory(base, absolute)) return absolute;
  for (const value of config.sourceDirs) {
    const registered = await sourceDirectory(root, value);
    if (insideDirectory(registered, absolute)) return absolute;
  }
  throw new Error('PDF must be inside the project or a registered intake folder');
}
