import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatIntakeAttachmentContext, INTAKE_VECTOR_WORKFLOW_DIRECTIVE, withoutXmlForbiddenCharacters, type ProjectIntakeCatalog } from '@open-design/contracts';
import { intakeProjectFile } from './project-intake.js';
import { containedIntakePath } from './project-intake-settings.js';
import { withIntakeVectors } from './project-intake-vectors.js';

/** Inline verified frozen reference bytes so a model need not discover a second text attachment. */
export function renderFrozenIntakeContext(files: readonly { mediaType: string; content: Buffer }[]): string {
  const references = files.filter((file) => file.mediaType === 'text/plain' && file.content.length <= 40000)
    .map((file) => withoutXmlForbiddenCharacters(file.content.toString('utf8')).trim())
    .filter((text) => text.startsWith('<project-intake-reference>\n') && text.endsWith('</project-intake-reference>'));
  if (!references.length) return '';
  // Follow-up snapshots can retain older context attachments. The last one
  // captures the latest selection and saved preference.
  const body = references.slice(-1).join('\n').replace(/<\/od-next-context>/gi, '&lt;/od-next-context>');
  return `<od-next-context kind="instruction" name="intake-svg-workflow">\n${INTAKE_VECTOR_WORKFLOW_DIRECTIVE}\n</od-next-context>\n\n<od-next-context kind="fact" name="intake-source-reference">\n${body}\n</od-next-context>`;
}

async function intakeReference(root: string, attachments: readonly string[]): Promise<{ text: string; preferredFiles: string[] }> {
  if (!attachments.length) return { text: '', preferredFiles: [] };
  try {
    const catalogPath = await intakeProjectFile(root, 'intake-assets/catalog.json');
    if ((await stat(catalogPath)).size > 16 * 1024 * 1024) throw new Error('Intake catalog exceeds the context read limit');
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as ProjectIntakeCatalog;
    if (catalog.version !== 1 || !Array.isArray(catalog.assets)) throw new Error('Invalid intake catalog');
    const enriched = await withIntakeVectors(root, catalog);
    const paths = new Set(attachments.map((file) => file.replaceAll('\\', '/').replace(/^\.\//, '')));
    const selected = enriched.assets.filter((asset) => paths.has(asset.imagePath) || asset.vectorVersions?.some((version) => paths.has(version.path))).slice(0, 24);
    return { text: formatIntakeAttachmentContext(enriched.assets, attachments), preferredFiles: selected.flatMap((asset) => asset.vectorPreference?.available ? [asset.vectorPreference.path] : []) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: '', preferredFiles: [] }; throw error; }
}

export async function loadIntakeAttachmentContext(root: string, attachments: readonly string[]): Promise<string> {
  return (await intakeReference(root, attachments)).text;
}

/** Frozen OD Next inputs include the same private context as ordinary CLI/API runs. */
export async function prepareIntakeContextFiles(root: string, attachments: readonly string[]): Promise<string[]> {
  const { text, preferredFiles } = await intakeReference(root, attachments);
  if (!text) return [];
  const digest = createHash('sha256').update(text).digest('hex');
  const relative = `intake-assets/.context/${digest}.txt`;
  await containedIntakePath(root, 'intake-assets/.context', true);
  const target = path.join(root, relative);
  try { await writeFile(target, text, { flag: 'wx' }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const safe = await intakeProjectFile(root, relative);
  if (await readFile(safe, 'utf8') !== text) throw new Error('Intake context file does not match its content identity');
  return [...new Set([relative, ...preferredFiles.filter((file) => !attachments.includes(file))])];
}
