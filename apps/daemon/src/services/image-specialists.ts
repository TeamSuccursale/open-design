import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IMAGE_SPECIALISTS, resolveSvgExecutionPolicy } from '@open-design/contracts';
import type { RuntimeBuildOptions, RuntimeImageSpecialist } from '../runtimes/types.js';

/** Host-owned resources, scoped to the resolved daemon data root, never CODEX_HOME. */
export async function prepareImageSpecialists(
  dataDir: string,
  parent: RuntimeBuildOptions = {},
): Promise<RuntimeImageSpecialist[]> {
  if (!path.isAbsolute(dataDir)) throw new Error('Image specialists require the resolved daemon data root');
  const policy = resolveSvgExecutionPolicy({
    agentId: 'codex', prompt: 'Create a detailed native SVG tracing from a photograph',
    model: parent.model ?? null, reasoning: parent.reasoning ?? null,
  })!;
  const profiles = IMAGE_SPECIALISTS.map((role) => {
    const fields = {
      name: role.id,
      description: role.description,
      developer_instructions: role.instructions,
      ...(role.vectorWork ? { model: policy.model, model_reasoning_effort: policy.reasoning } : {}),
    };
    // JSON basic strings are valid TOML strings for these host-owned values.
    const body = Object.entries(fields).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n') + '\n';
    return { role, body };
  });
  const digest = createHash('sha256').update(profiles.map(({ body }) => body).join('\n')).digest('hex');
  const directory = path.join(dataDir, 'agent-resources', 'image-specialists', digest);
  await mkdir(directory, { recursive: true });
  // Atomic rename avoids a second concurrent run observing a partially written profile.
  return Promise.all(profiles.map(async ({ role, body }) => {
    const configFile = path.join(directory, `${role.id}.toml`);
    let current: string | null = null;
    try { current = await readFile(configFile, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (current !== body) {
      const temporary = `${configFile}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, body, { flag: 'wx' });
        await rename(temporary, configFile);
      } finally { await rm(temporary, { force: true }); }
    }
    return { id: role.id, description: role.description, configFile };
  }));
}
