import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DocumentSetupIntent, ProjectMetadata } from '@open-design/contracts';
import { documentSetupReasoning } from '../../src/services/document-setup.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const intent: DocumentSetupIntent = { kind: 'tender-offer', subtype: 'Offerta tecnica', purpose: '', contextRoots: [], imageIntakeConsent: false, imageIntakeDecision: 'declined' };
const withSetup: ProjectMetadata = { kind: 'other', documentSetupIntent: intent };
async function project(status?: 'draft' | 'review' | 'confirmed') {
  const root = await mkdtemp(path.join(tmpdir(), 'setup-reasoning-')); roots.push(root);
  if (status) {
    const directory = path.join(root, '.melillodesign/projects/p1'); await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'document-setup.json'), JSON.stringify({ version: 1, projectId: 'p1', status, workingDirectory: root, updatedAt: new Date().toISOString(),
      intent, scan: { status: 'complete', sources: [], constraints: [], warnings: [] } }));
  }
  return root;
}

describe('document setup reasoning', () => {
  it('runs a setup chat turn at medium effort at most, because it reads and asks rather than designs', async () => {
    const root = await project('review');
    expect(await documentSetupReasoning(root, withSetup, 'p1', 'chat', 'xhigh')).toBe('medium');
    expect(await documentSetupReasoning(root, withSetup, 'p1', 'chat', 'max')).toBe('medium');
    expect(await documentSetupReasoning(await project(), withSetup, 'p1', 'chat', 'high')).toBe('medium');
  });
  it('keeps the requested effort below the ceiling, after confirmation, outside chat and in projects without document setup', async () => {
    expect(await documentSetupReasoning(await project('review'), withSetup, 'p1', 'chat', 'low')).toBe('low');
    expect(await documentSetupReasoning(await project('review'), withSetup, 'p1', 'chat', null)).toBeNull();
    expect(await documentSetupReasoning(await project('confirmed'), withSetup, 'p1', 'chat', 'xhigh')).toBe('xhigh');
    expect(await documentSetupReasoning(await project('review'), withSetup, 'p1', 'design', 'xhigh')).toBe('xhigh');
    expect(await documentSetupReasoning(await project(), { kind: 'other' }, 'p1', 'chat', 'xhigh')).toBe('xhigh');
    expect(await documentSetupReasoning(await project('review'), { ...withSetup, projectMode: 'fast' }, 'p1', 'chat', 'xhigh')).toBe('xhigh');
  });
});
