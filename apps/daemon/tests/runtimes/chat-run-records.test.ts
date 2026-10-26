import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProject } from '../../src/db.js';
import { validateChatRunDeliverable, revalidateMissingChatRunBlockout, runTouchedArtifactPaths } from '../../src/runtimes/chat-run-records.js';
import { blockoutComparisonFilePath, createBlockoutDocument } from '@open-design/contracts';
import { ProjectDocumentsStore } from '../../src/services/project-documents.js';
import { saveBlockoutWorkspace } from '../../src/services/blockout-workspaces.js';
import { createChatRunService } from '../../src/runtimes/runs.js';
import { registerRunRoutes } from '../../src/routes/runs.js';
import { createJsonEventStreamHandler } from '../../src/runtimes/json-event-stream.js';
import { recordHeaderFooterDraftRunDelivery } from '../../src/services/header-footer-run-delivery.js';
import { createHash } from 'node:crypto';
import { resolveChatRunBlockoutDesignEvidence } from '../../src/runtimes/chat-run-records.js';
import { recordBlockoutDesign, readBlockoutDesignState } from '../../src/services/blockout-design.js';
import { readBlockoutWorkspace, saveBlockoutWorkspaceStartingPoint } from '../../src/services/blockout-workspaces.js';
import { finalizeSuccessfulRunDeliverable } from '../../src/artifacts/successful-run-deliverable-finalization.js';

vi.mock('../../src/db.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/db.js')>(),
  getProject: vi.fn(),
}));

const receipt = {
  type: 'diagnostic',
  name: 'header_footer_draft_saved',
  source: 'daemon-header-footer',
  shape: { projectId: 'project-1', setId: 'model-1', draftVersion: 2, stage: 'structural' },
};
const hostEvent = { event: 'agent', data: receipt };
let projectsRoot: string;

beforeEach(async () => {
  projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'od-run-model-delivery-'));
  vi.mocked(getProject).mockReturnValue({
    id: 'project-1', name: 'Project', createdAt: 1, updatedAt: 1,
    skillId: null, designSystemId: null, pendingPrompt: null,
    appliedPluginSnapshotId: null, customInstructions: null, metadata: { kind: 'other' },
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  await fs.rm(projectsRoot, { recursive: true, force: true });
});

function validate(events: readonly { event: string; data: unknown }[] = [], runStatus: 'succeeded' | 'failed' | 'canceled' = 'succeeded') {
  return validateChatRunDeliverable({
    db: {} as Parameters<typeof getProject>[0], projectsRoot,
    run: { projectId: 'project-1', events }, runStatus, artifactCount: 0,
  });
}

describe('chat run durable header/footer delivery', () => {
  it('accepts the registrar receipt without fabricating files or changing artifact counts', async () => {
    const events: { event: string; data: unknown }[] = [];
    const run = { projectId: 'project-1', status: 'running' };
    expect(recordHeaderFooterDraftRunDelivery({
      runId: 'run-1', requestedProjectId: 'project-1', collectionId: 'project-1',
      setId: 'model-1', draftVersion: 2, stage: 'structural',
      getRun: () => run, collectionForProject: (id) => id,
      emit: (_, saved) => events.push({ event: 'agent', data: { type: 'diagnostic', ...saved } }),
    })).toBe(true);
    const input = { db: {} as Parameters<typeof getProject>[0], projectsRoot,
      run: { projectId: 'project-1', events }, runStatus: 'succeeded' as const, artifactCount: 0 };
    await expect(validateChatRunDeliverable(input)).resolves.toEqual({ valid: true, validation: 'valid' });
    expect(input.artifactCount).toBe(0);
    expect(await fs.readdir(projectsRoot)).toEqual([]);
  });

  it('accepts a document workspace receipt only for its owning collection', async () => {
    vi.mocked(getProject).mockReturnValue({
      id: 'project-1', name: 'Document', createdAt: 1, updatedAt: 1,
      skillId: null, designSystemId: null, pendingPrompt: null,
      appliedPluginSnapshotId: null, customInstructions: null,
      metadata: { kind: 'other', collectionProjectId: 'parent' },
    });
    await expect(validate([{ event: 'agent', data: { ...receipt, shape: { ...receipt.shape, projectId: 'parent' } } }]))
      .resolves.toEqual({ valid: true, validation: 'valid' });
    await expect(validate([hostEvent])).resolves.toEqual({ valid: false, validation: 'no_artifact' });
  });

  it.each(['failed', 'canceled'] as const)('does not turn a %s run into delivery', async (status) => {
    await expect(validate([hostEvent], status)).resolves.toEqual({ valid: false, validation: 'not_succeeded' });
  });

  it.each([
    { event: 'stdout', data: { chunk: JSON.stringify(receipt) } },
    { event: 'agent', data: { type: 'text_delta', delta: JSON.stringify(receipt) } },
    { event: 'agent', data: { type: 'tool_result', content: JSON.stringify(receipt) } },
    { event: 'agent', data: { type: 'raw', parsed: receipt, line: JSON.stringify(receipt) } },
    { event: 'diagnostic', data: receipt },
    { event: 'agent', data: { type: 'diagnostic', forwarded: receipt } },
    { event: 'agent', data: { ...receipt, type: 'tool_result' } },
    { event: 'agent', data: { ...receipt, source: 'agent' } },
    { event: 'agent', data: { ...receipt, shape: { ...receipt.shape, projectId: 'foreign' } } },
    { event: 'agent', data: { ...receipt, shape: { ...receipt.shape, draftVersion: 0 } } },
    { event: 'agent', data: { ...receipt, shape: { ...receipt.shape, stage: 'published' } } },
    { event: 'agent', data: { ...receipt, shape: { ...receipt.shape, setId: '' } } },
  ])('rejects prose, forwarded payloads and malformed receipts: %j', async (event) => {
    await expect(validate([event])).resolves.toEqual({ valid: false, validation: 'no_artifact' });
  });

  it('does not promote a forged native stdout diagnostic to a host receipt', async () => {
    const events: { event: string; data: unknown }[] = [];
    const parser = createJsonEventStreamHandler('codex', (data) => events.push({ event: 'agent', data }));
    parser.feed(`${JSON.stringify(receipt)}\n`);
    parser.flush();
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ type: 'raw' });
    await expect(validate(events)).resolves.toEqual({ valid: false, validation: 'no_artifact' });
  });

  it('does not infer current delivery from an existing saved draft without a receipt', async () => {
    await fs.mkdir(path.join(projectsRoot, 'project-1', 'header-footer'), { recursive: true });
    await fs.writeFile(path.join(projectsRoot, 'project-1', 'header-footer', 'draft.json'), JSON.stringify(receipt));
    await expect(validate()).resolves.toEqual({ valid: false, validation: 'no_artifact' });
  });

  it('does not accept a receipt after its owning project disappeared', async () => {
    vi.mocked(getProject).mockReturnValue(null);
    await expect(validate([hostEvent])).resolves.toEqual({ valid: false, validation: 'no_artifact' });
  });
});

describe('exact run artifact evidence and cached Blockout recovery', () => {
  it('attributes a registered design to its exact parent run before the old comparison registry entry is replaced', async () => {
    const test = await registered();
    const current = await readBlockoutWorkspace(test.record.workingDirectory, test.record.id);
    current.document!.approval = { variantId: 'brief', acceptedAt: '2026-10-26T10:00:00Z' };
    const approved = await saveBlockoutWorkspace(test.record.workingDirectory, test.record.id, { document: current.document, baseRaw: current.raw });
    const handoff = await saveBlockoutWorkspaceStartingPoint(test.record.workingDirectory, test.record.id,
      { document: approved.document, baseRaw: approved.raw, requestId: 'design-approval', action: 'develop-design' });
    const handoffText = await fs.readFile(path.join(test.record.workingDirectory, handoff.path), 'utf8');
    const entry = 'finished-report.html', alias = `documents/${test.record.id}/${entry}`;
    await fs.writeFile(path.join(test.record.workingDirectory, entry), `<article data-blockout-document-id="${test.record.id}" data-blockout-page-id="page-1">Finished design</article>`);
    const run = { id: 'design-run', projectId: 'project-1', artifactPaths: [alias] };
    await recordBlockoutDesign(test.record.workingDirectory, test.record.id, 'child',
      { handoffId: handoff.handoff.id, runId: run.id, entryFile: entry, pages: [{ pageId: 'page-1', filePath: entry, widthPx: 794, heightPx: 1123, blocks: [] }] },
      async () => ({ projectId: run.projectId, status: 'running', blockoutDesignTargets: [{ projectId: 'child', documentId: test.record.id,
        handoffId: handoff.handoff.id, handoffSha256: createHash('sha256').update(handoffText).digest('hex') }] }));
    const evidence = { ...test.input, run };
    const expected = { valid: true, validation: 'valid', entryFile: alias, artifactKind: 'html' };
    // No run-status GET and no comparison rewrite is required for finalization.
    await expect(resolveChatRunBlockoutDesignEvidence({ ...evidence, cached: {} })).resolves.toMatchObject(expected);
    await expect(finalizeSuccessfulRunDeliverable({ projectsRoot, projectId: run.projectId, runId: run.id,
      projectMetadata: getProject({} as never, run.projectId)!.metadata, artifactCount: 1, touchedPaths: [alias], processTreeQuiescent: true,
      documentScope: { dataRoot: test.input.dataRoot, getProject: (id) => getProject({} as never, id) } })).resolves.toMatchObject({ deliverable: expected });
    expect((await test.store.get(test.record.id)).entryFile).toBe(test.entry);
    await expect(resolveChatRunBlockoutDesignEvidence({ ...evidence, run: { ...run, id: 'unrelated-run' }, cached: {} })).resolves.toMatchObject({ valid: false });
    await expect(resolveChatRunBlockoutDesignEvidence({ ...evidence, run: { ...run, artifactPaths: [] }, cached: {} })).resolves.toMatchObject({ valid: false });
    // A receipt marked failed by the previous entry attribution can recover
    // only after the same exact immutable delivery passes the real verifier.
    await readBlockoutDesignState(test.record.workingDirectory, test.record.id, 'child', async () => ({ projectId: run.projectId, status: 'succeeded', deliverableValid: false }));
    const repaired = await resolveChatRunBlockoutDesignEvidence(evidence);
    expect(repaired).toMatchObject(expected);
    const applied = await readBlockoutDesignState(test.record.workingDirectory, test.record.id, 'child', async () => ({ projectId: run.projectId, status: 'succeeded', deliverableValid: repaired!.valid }));
    expect(applied.applied?.runId).toBe(run.id);
    await fs.appendFile(path.join(test.record.workingDirectory, entry), '<p>Changed outside the registered run</p>');
    await expect(resolveChatRunBlockoutDesignEvidence(evidence)).resolves.toBeNull();
  });
  it('retains an authoritative empty or unknown in-memory outcome over persisted paths', () => {
    expect(runTouchedArtifactPaths({ artifactOutcome: { diff: { touchedPaths: [] } }, artifactPaths: ['old.html'] })).toEqual([]);
    expect(runTouchedArtifactPaths({ artifactOutcome: {}, artifactPaths: ['old.html'] })).toBeUndefined();
    expect(runTouchedArtifactPaths({ artifactOutcome: { diff: { touchedPaths: null } }, artifactPaths: ['old.html'] })).toBeUndefined();
    expect(runTouchedArtifactPaths({ artifactPaths: ['current.html', 123, ''] })).toEqual(['current.html']);
    expect(runTouchedArtifactPaths({})).toBeUndefined();
  });

  async function registered() {
    const dataRoot = path.join(projectsRoot, 'runtime'), root = path.join(projectsRoot, 'project-1');
    await fs.mkdir(root, { recursive: true });
    const store = new ProjectDocumentsStore({ dataRoot, projectId: 'project-1', projectRoot: root });
    const parent = getProject({} as never, 'project-1');
    if (!parent) throw new Error('missing test project');
    let child: typeof parent | undefined;
    const record = (await store.create({ name: 'Current report', kind: 'document' }, async (input) => {
      child = { ...parent, id: 'child', metadata: { kind: 'other', baseDir: input.workingDirectory, collectionProjectId: parent.id, collectionDocumentId: input.documentId } };
      return { workspaceProjectId: 'child', conversationId: 'document-chat' };
    })).document;
    vi.mocked(getProject).mockImplementation((_, id) => id === parent.id ? parent : id === child?.id ? child : null);
    const document = createBlockoutDocument(); document.documentId = record.id; document.title = record.name;
    await saveBlockoutWorkspace(record.workingDirectory, record.id, { document, baseRaw: null });
    const entry = blockoutComparisonFilePath(document), alias = `documents/${record.id}/${entry}`;
    await fs.mkdir(path.dirname(path.join(record.workingDirectory, entry)), { recursive: true });
    await fs.writeFile(path.join(record.workingDirectory, entry), '<main>Current comparison</main>');
    await store.synchronize(record.id, { blockoutDocumentId: record.id, entryFile: entry });
    const input = { db: {} as Parameters<typeof getProject>[0], projectsRoot, dataRoot,
      run: { projectId: parent.id, artifactPaths: [alias] }, runStatus: 'succeeded' as const, artifactCount: 1,
      cached: { deliverableValid: false, deliverableValidation: 'entry_missing' as const } };
    return { input, alias, record, entry, store };
  }

  it('recovers a cached absolute-diff miss from the current registered model', async () => {
    const test = await registered();
    const run = { ...test.input.run, artifactOutcome: { diff: { touchedPaths: [path.join(test.record.workingDirectory, test.entry)] } } };
    await expect(revalidateMissingChatRunBlockout({ ...test.input, run })).resolves.toMatchObject({ valid: true, entryFile: test.alias });
  });

  it('recovers the exact persisted paths after real run-service hydration without an outcome', async () => {
    const test = await registered(), runsLogDir = path.join(projectsRoot, 'runs');
    const options = { runsLogDir: runsLogDir as unknown as null, createSseResponse: () => ({ send() {}, end() {} }), createSseErrorPayload: () => ({}) };
    const live = createChatRunService(options), run = live.create({ projectId: 'project-1' });
    run.artifactPaths = [test.alias]; run.artifactCount = 1;
    live.setDeliverableValidation(run, { valid: false, validation: 'entry_missing' });
    live.finish(run, 'succeeded', 0, null);
    await (run as typeof run & { eventsLogFinalFlush?: Promise<boolean> }).eventsLogFinalFlush;
    const hydrated = createChatRunService(options).get(run.id);
    expect(hydrated?.artifactOutcome).toBeUndefined();
    expect(runTouchedArtifactPaths(hydrated!)).toEqual([test.alias]);
    await expect(revalidateMissingChatRunBlockout({ ...test.input, run: hydrated! })).resolves.toMatchObject({ valid: true, entryFile: test.alias });
  });

  it('repairs the cached terminal GET and persists its exact registered entry', async () => {
    const test = await registered();
    const run = { ...test.input.run, id: 'cached-run', status: 'succeeded', artifactCount: 1,
      deliverableValid: false, deliverableValidation: 'entry_missing',
      artifactOutcome: { diff: { touchedPaths: [path.join(test.record.workingDirectory, test.entry)] } } };
    const setDeliverableValidation = vi.fn((_, result) => Object.assign(run, {
      deliverableValid: result.valid, deliverableValidation: result.validation, deliverableEntryFile: result.entryFile,
    }));
    const app = express();
    registerRunRoutes(app, {
      db: { prepare: () => ({ get: () => undefined }) },
      design: { runs: { get: () => run, statusBody: () => ({ ...run }), isTerminal: () => true, setDeliverableValidation }, analytics: { capture() {} }, getAppVersion: () => 'test' },
      http: { createSseResponse: () => ({ send() {}, end() {} }), sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
      paths: { PROJECTS_DIR: projectsRoot, RUNTIME_DATA_DIR: test.input.dataRoot },
      agents: { detectAgents: async () => [], getAgentDef: () => null },
      chat: { startChatRun: async () => undefined },
      plugins: { connectorService: {}, detectSkillPluginCandidateOnRunSuccess() {}, firePipelineForRun() {}, loadPluginRegistryView: async () => ({}), renderPluginBriefTemplate: (text: string) => text },
      telemetry: { reportRunCompletionTelemetryFallback() {}, resolveRunProjectKindForAnalytics: () => null, runArtifactBaselines: { take: () => undefined }, runRetryEventsForAnalytics: () => [] },
      messages: { pinAssistantMessageOnRunCreate: () => ({ ok: true }), reconcileAssistantMessageOnRunEnd() {} },
    } as unknown as Parameters<typeof registerRunRoutes>[1]);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing listener');
      const endpoint = `http://127.0.0.1:${address.port}/api/runs/cached-run`;
      const response = await fetch(endpoint);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ deliverableValid: true, deliverableValidation: 'valid', deliverableEntryFile: test.alias });
      expect(setDeliverableValidation).toHaveBeenCalledTimes(1);
      await expect((await fetch(endpoint)).json()).resolves.toMatchObject({ deliverableValid: true });
      expect(setDeliverableValidation).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); });
    }
  });

  it('keeps cached verdicts when current evidence, successful status or saved ownership is missing', async () => {
    const test = await registered();
    for (const patch of [
      { runStatus: 'failed' as const }, { artifactCount: 0 }, { artifactCount: Number.NaN },
      { cached: { deliverableValid: true, deliverableValidation: 'valid' as const } },
      { cached: { deliverableValid: false, deliverableValidation: 'entry_not_touched' as const } },
      { run: { ...test.input.run, artifactPaths: [] } },
      { run: { ...test.input.run, artifactPaths: ['unregistered.html'] } },
      { run: { ...test.input.run, artifactOutcome: {} } },
      { run: { ...test.input.run, artifactOutcome: { diff: { touchedPaths: [] } } } },
    ]) await expect(revalidateMissingChatRunBlockout({ ...test.input, ...patch })).resolves.toBeNull();
    await fs.unlink(path.join(test.record.workingDirectory, test.entry));
    await expect(revalidateMissingChatRunBlockout(test.input)).resolves.toBeNull();
  });

  it('cannot recover an arbitrary inferred entry or an unregistered legacy Fast catalog', async () => {
    const test = await registered();
    await fs.writeFile(path.join(projectsRoot, 'project-1', 'index.html'), '<main>Existing unrelated output</main>');
    await expect(revalidateMissingChatRunBlockout({ ...test.input, run: { projectId: 'project-1', artifactPaths: ['index.html'] } })).resolves.toBeNull();
    await test.store.update(test.record.id, { archived: true });
    await expect(revalidateMissingChatRunBlockout(test.input)).resolves.toBeNull();
  });
});
