import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IMAGE_SPECIALISTS } from '@open-design/contracts';
import { prepareImageSpecialists } from '../../src/services/image-specialists.js';
import { codexAgentDef, withCodexTransport } from '../../src/runtimes/defs/codex.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function dataRoot() { const root = await mkdtemp(path.join(os.tmpdir(), 'melillo-images-')); roots.push(root); return root; }
function profileFields(text: string): Record<string, string> {
  return Object.fromEntries(text.trim().split('\n').map((line) => {
    const split = line.indexOf(' = ');
    return [line.slice(0, split), JSON.parse(line.slice(split + 3))];
  }));
}

describe('native image specialist registration', () => {
  it('materializes complete role instructions under the explicit data root, including concurrent starts', async () => {
    const root = await dataRoot();
    const batches = await Promise.all(Array.from({ length: 4 }, () => prepareImageSpecialists(root)));
    expect(batches[1]).toEqual(batches[0]);
    for (const role of batches[0]!) {
      expect(path.relative(root, role.configFile).startsWith('..')).toBe(false);
      const fields = profileFields(await readFile(role.configFile, 'utf8'));
      expect(fields.name).toBe(role.id);
      expect(fields.developer_instructions).toBe(IMAGE_SPECIALISTS.find(({ id }) => id === role.id)!.instructions);
      if (role.id !== 'melillo_image_alpha') {
        expect(fields.model).toBe('gpt-6.1-sol');
        expect(fields.model_reasoning_effort).toBe('max');
      } else expect(fields.model).toBeUndefined();
    }
  });

  it('preserves a stronger selected model and effort for SVG specialists', async () => {
    const roles = await prepareImageSpecialists(await dataRoot(), { model: 'gpt-6-astra', reasoning: 'ultra' });
    const fields = profileFields(await readFile(roles.find(({ id }) => id === 'melillo_photo_vector')!.configFile, 'utf8'));
    expect(fields.model).toBe('gpt-6-astra');
    expect(fields.model_reasoning_effort).toBe('ultra');
  });

  it.each(['exec-json', 'app-server'] as const)('registers identical roles for fresh and resumed %s runs', async (transport) => {
    const roles = await prepareImageSpecialists(await dataRoot());
    const def = withCodexTransport(codexAgentDef, transport);
    for (const resumeSessionId of [undefined, 'resume-id']) {
      const args = def.buildArgs('request', [], [], {}, { imageSpecialists: roles, resumeSessionId: resumeSessionId ?? null });
      for (const role of roles) {
        expect(args).toContain(`agents.${role.id}.config_file=${JSON.stringify(role.configFile.replaceAll('\\', '/'))}`);
        expect(args).toContain(`agents.${role.id}.description=${JSON.stringify(role.description)}`);
      }
    }
  });

  it('never guesses a daemon data root', async () => {
    await expect(prepareImageSpecialists('relative-data')).rejects.toThrow('resolved daemon data root');
  });
});
