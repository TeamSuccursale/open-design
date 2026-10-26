import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DOCUMENT_RESEARCH_SPECIALISTS } from '@open-design/contracts';
import { prepareDocumentResearchSpecialists } from '../../src/services/document-research-specialists.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function dataRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'melillo-research-'));
  roots.push(root);
  return root;
}
function profileFields(body: string): Record<string, string> {
  return Object.fromEntries(body.trim().split('\n').map((line) => {
    const split = line.indexOf(' = ');
    return [line.slice(0, split), JSON.parse(line.slice(split + 3))];
  }));
}

describe('native document research specialist resources', () => {
  it('materializes canonical Sol instructions and distinct low/xhigh effort with consent', async () => {
    const root = await dataRoot();
    const roles = await prepareDocumentResearchSpecialists(root, { imageConsent: true });
    expect(roles.map(({ id }) => id)).toEqual(DOCUMENT_RESEARCH_SPECIALISTS.map(({ id }) => id));
    expect(roles).toHaveLength(5);
    for (const role of roles) {
      const definition = DOCUMENT_RESEARCH_SPECIALISTS.find(({ id }) => id === role.id)!;
      const relative = path.relative(root, role.configFile);
      expect(relative.startsWith('..')).toBe(false);
      expect(path.isAbsolute(relative)).toBe(false);
      const fields = profileFields(await readFile(role.configFile, 'utf8'));
      expect(fields).toEqual({
        name: definition.id,
        description: definition.description,
        developer_instructions: definition.instructions,
        model: 'gpt-6.1-sol',
        model_reasoning_effort: definition.reasoningEffort,
      });
    }
    expect(DOCUMENT_RESEARCH_SPECIALISTS.filter(({ reasoningEffort }) => reasoningEffort === 'low')).toHaveLength(3);
    expect(DOCUMENT_RESEARCH_SPECIALISTS.filter(({ reasoningEffort }) => reasoningEffort === 'xhigh')).toHaveLength(2);
  });

  it('registers only text roles when consent is absent or declined, including after a consented run', async () => {
    const root = await dataRoot();
    const consented = await prepareDocumentResearchSpecialists(root, { imageConsent: true });
    const absent = await prepareDocumentResearchSpecialists(root);
    const declined = await prepareDocumentResearchSpecialists(root, { imageConsent: false });
    expect(absent).toEqual(declined);
    expect(absent.map(({ id }) => id)).toEqual([
      'melillo_document_sources', 'melillo_document_facts', 'melillo_research_text',
    ]);
    expect(absent).toHaveLength(3);
    expect(path.dirname(absent[0]!.configFile)).not.toBe(path.dirname(consented[0]!.configFile));
    expect((await readdir(path.dirname(absent[0]!.configFile))).sort()).toEqual(absent.map(({ id }) => `${id}.toml`).sort());
  });

  it('supports concurrent runs with stable complete files and no temporary-file residue', async () => {
    const root = await dataRoot();
    const batches = await Promise.all(Array.from({ length: 8 }, () =>
      prepareDocumentResearchSpecialists(root, { imageConsent: true })));
    for (const batch of batches) expect(batch).toEqual(batches[0]);
    for (const role of batches[0]!) {
      const fields = profileFields(await readFile(role.configFile, 'utf8'));
      expect(fields.name).toBe(role.id);
      expect(fields.developer_instructions).toBe(DOCUMENT_RESEARCH_SPECIALISTS.find(({ id }) => id === role.id)!.instructions);
    }
    expect((await readdir(path.dirname(batches[0]![0]!.configFile))).sort())
      .toEqual(batches[0]!.map(({ id }) => `${id}.toml`).sort());
  });

  it('restores a modified host-owned profile without changing the content-addressed identity', async () => {
    const root = await dataRoot();
    const first = await prepareDocumentResearchSpecialists(root);
    const role = first[0]!;
    const original = await readFile(role.configFile, 'utf8');
    await writeFile(role.configFile, 'model = "wrong-model"\n');
    const repairs = await Promise.all(Array.from({ length: 8 }, () => prepareDocumentResearchSpecialists(root)));
    for (const repair of repairs) expect(repair).toEqual(first);
    expect(await readFile(role.configFile, 'utf8')).toBe(original);
  });

  it('registers no research profiles in fast projects while normal consented roles remain available', async () => {
    const root = await dataRoot();
    expect(await prepareDocumentResearchSpecialists(root, { projectMode: 'fast', imageConsent: true })).toEqual([]);
    expect(await readdir(root)).toEqual([]);
    expect(await prepareDocumentResearchSpecialists(root, { imageConsent: true })).toHaveLength(5);
  });

  it('requires an explicit absolute data root', async () => {
    await expect(prepareDocumentResearchSpecialists('relative-data')).rejects.toThrow('resolved daemon data root');
    await expect(prepareDocumentResearchSpecialists('')).rejects.toThrow('resolved daemon data root');
  });
});
