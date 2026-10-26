import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DOCUMENT_RESEARCH_SPECIALISTS } from '@open-design/contracts';
import type { RuntimeImageSpecialist } from '../runtimes/types.js';

const pendingProfileWrites = new Map<string, Promise<void>>();

async function ensureProfile(configFile: string, body: string): Promise<void> {
  // Serialize the entire read/replace operation: Windows cannot rename over a
  // destination that another concurrent materialization is still reading.
  const previous = pendingProfileWrites.get(configFile) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    let current: string | null = null;
    try { current = await readFile(configFile, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (current === body) return;
    const temporary = `${configFile}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, body, { flag: 'wx' });
      await rename(temporary, configFile);
    } finally { await rm(temporary, { force: true }); }
  });
  pendingProfileWrites.set(configFile, operation);
  try { await operation; }
  finally {
    if (pendingProfileWrites.get(configFile) === operation) pendingProfileWrites.delete(configFile);
  }
}

export interface DocumentResearchSpecialistOptions {
  /** Pass the current persisted decision; unknown consent leaves visual roles unavailable. */
  imageConsent?: boolean;
  projectMode?: 'fast';
}

/** Materialize per-run role resources under the daemon's resolved data root. */
export async function prepareDocumentResearchSpecialists(
  dataDir: string,
  options: DocumentResearchSpecialistOptions = {},
): Promise<RuntimeImageSpecialist[]> {
  if (!path.isAbsolute(dataDir)) {
    throw new Error('Document research specialists require the resolved daemon data root');
  }
  if (options.projectMode === 'fast') return [];
  const profiles = DOCUMENT_RESEARCH_SPECIALISTS
    .filter((role) => !role.requiresImageConsent || options.imageConsent === true)
    .map((role) => {
      const fields = {
        name: role.id,
        description: role.description,
        developer_instructions: role.instructions,
        model: role.model,
        model_reasoning_effort: role.reasoningEffort,
      };
      // These canonical values use JSON basic-string escaping, also valid in TOML.
      const body = Object.entries(fields)
        .map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n') + '\n';
      return { role, body };
    });
  const digest = createHash('sha256').update(profiles.map(({ body }) => body).join('\n')).digest('hex');
  const directory = path.join(dataDir, 'agent-resources', 'document-research-specialists', digest);
  await mkdir(directory, { recursive: true });

  return Promise.all(profiles.map(async ({ role, body }) => {
    const configFile = path.join(directory, `${role.id}.toml`);
    await ensureProfile(configFile, body);
    return { id: role.id, description: role.description, configFile };
  }));
}
