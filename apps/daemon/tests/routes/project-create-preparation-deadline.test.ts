import type http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerProjectRoutes } from '../../src/routes/project/index.js';
import { ensureProject, removeProjectDir, resolveProjectDir } from '../../src/projects.js';

// POST /api/projects must answer within one request-wide deadline (15s in
// production) and commit nothing when it cannot: the Web enters an optimistic
// project surface the moment it sends the request, so a stalled catalogue
// read has to become a definite, retryable 504 the client can roll back from.

const servers: http.Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function noop() {}

function functionProxy(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get(target, property) {
      return property in target ? target[property as string] : noop;
    },
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function buildDeps(input: {
  insertProject: ReturnType<typeof vi.fn>;
  insertConversation: ReturnType<typeof vi.fn>;
  projectCreatePreparationTimeoutMs: number;
  designSystemDelayMs?: number;
  skillDelayMs?: number;
  getLocalPluginBySource?: ReturnType<typeof vi.fn>;
  projectsDir?: string;
}) {
  return {
    projectCreatePreparationTimeoutMs: input.projectCreatePreparationTimeoutMs,
    db: {
      transaction: (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) => fn(...args),
    },
    design: {},
    http: {
      createSseResponse: noop,
      sendApiError: (
        res: express.Response,
        status: number,
        code: string,
        message: string,
        init: Record<string, unknown> = {},
      ) => res.status(status).json({ error: { code, message, ...init } }),
    },
    paths: {
      DESIGN_SYSTEMS_DIR: '',
      PROJECTS_DIR: input.projectsDir ?? '',
      SKILLS_DIR: '',
      BRANDS_DIR: '',
      USER_DESIGN_SYSTEMS_DIR: '',
    },
    projectStore: functionProxy({
      insertProject: input.insertProject,
      updateProject: vi.fn(),
      validateLinkedDirs: () => ({ dirs: [] }),
      getProject: () => null,
      getWorkspaceProject: () => null,
      getWorkspaceProjectByProjectId: () => null,
      listWorkspaceProjects: () => [],
      listProjects: () => [],
      ...(input.projectsDir ? { removeProjectDir } : {}),
    }),
    projectFiles: functionProxy({
      listFiles: () => [],
      listTabs: () => [],
      resolveProjectDir: () => '',
      ...(input.projectsDir ? { resolveProjectDir, ensureProject } : {}),
    }),
    conversations: functionProxy({ insertConversation: input.insertConversation }),
    templates: functionProxy({ listTemplates: () => [] }),
    status: functionProxy({
      listLatestProjectRunStatuses: () => new Map(),
      listProjectsAwaitingInput: () => new Set(),
      listProjects: () => [],
      listUnboundProjects: () => [],
    }),
    events: functionProxy({ activeProjectEventSinks: new Map() }),
    ids: { randomId: () => 'conversation-id' },
    telemetry: { reportFinalizedMessage: noop },
    appConfig: { readAppConfig: async () => ({}), writeAppConfig: noop },
    agents: {},
    validation: {
      validateProjectDesignSystemId: vi.fn(async (id: string | null) => {
        if (input.designSystemDelayMs) await sleep(input.designSystemDelayMs);
        return { ok: true, id };
      }),
      validateProjectSkillId: vi.fn(async (id: string | null) => {
        if (input.skillDelayMs) await sleep(input.skillDelayMs);
        return { ok: true, id };
      }),
    },
    collabSync: functionProxy(),
    authorizeProjectRequest: vi.fn(async () => true),
    fetchProjectCreationWorkspaceDirectory: vi.fn(async () => ({ ok: false, items: [] })),
    pluginScope: {
      loadRegistry: vi.fn(async () => ({
        skills: [],
        designSystems: [],
        craft: [],
        atoms: [],
        scenarios: [],
      })),
      getPlugin: vi.fn(async () => ({})),
      ...(input.getLocalPluginBySource
        ? { getLocalPluginBySource: input.getLocalPluginBySource }
        : {}),
    },
  } as unknown as Parameters<typeof registerProjectRoutes>[1];
}

async function start(deps: Parameters<typeof registerProjectRoutes>[1]) {
  const app = express();
  app.use(express.json());
  registerProjectRoutes(app, deps);
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function post(baseUrl: string, overrides: Record<string, unknown> = {}) {
  return fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'deadline-project',
      name: 'Deadline project',
      skillId: null,
      designSystemId: null,
      metadata: { kind: 'prototype' },
      // The automatic OD Next route keeps this scaffold off the default
      // scenario plugin lookup, which needs a real SQLite handle.
      conversationMode: 'design',
      automaticStrategyTaskProfile: 'prototype',
      pendingPrompt: 'Make a landing page',
      ...overrides,
    }),
  });
}

describe('POST /api/projects preparation deadline', () => {
  it('answers 504 PROJECT_CREATE_PREPARATION_TIMEOUT and commits nothing when one read stalls', async () => {
    const insertProject = vi.fn();
    const insertConversation = vi.fn();
    const baseUrl = await start(buildDeps({
      insertProject,
      insertConversation,
      projectCreatePreparationTimeoutMs: 40,
      designSystemDelayMs: 400,
    }));

    const response = await post(baseUrl);
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'PROJECT_CREATE_PREPARATION_TIMEOUT',
        retryable: true,
        details: { stage: 'validating the selected design system' },
      },
    });
    expect(insertProject).not.toHaveBeenCalled();
    expect(insertConversation).not.toHaveBeenCalled();
  });

  it('shares one deadline across stages instead of restarting it per read', async () => {
    const insertProject = vi.fn();
    const insertConversation = vi.fn();
    // Each stage alone fits inside the deadline; together they do not.
    const baseUrl = await start(buildDeps({
      insertProject,
      insertConversation,
      projectCreatePreparationTimeoutMs: 60,
      designSystemDelayMs: 40,
      skillDelayMs: 40,
    }));

    const response = await post(baseUrl);
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'PROJECT_CREATE_PREPARATION_TIMEOUT',
        details: { stage: 'validating the selected skill' },
      },
    });
    expect(insertProject).not.toHaveBeenCalled();
  });

  it('bounds the example-card lookup that runs after the catalogue validations', async () => {
    const insertProject = vi.fn();
    const insertConversation = vi.fn();
    // Home Send takes this path when an official example card was picked under
    // an automatic OD Next route; the lookup must not escape the deadline.
    const getLocalPluginBySource = vi.fn(() => new Promise<never>(() => undefined));
    const baseUrl = await start(buildDeps({
      insertProject,
      insertConversation,
      projectCreatePreparationTimeoutMs: 60,
      getLocalPluginBySource,
    }));

    const response = await post(baseUrl, {
      exampleReference: { pluginId: 'example-web-prototype', source: '/tmp/example-web-prototype' },
    });
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'PROJECT_CREATE_PREPARATION_TIMEOUT',
        retryable: true,
        details: { stage: 'resolving the selected example' },
      },
    });
    expect(getLocalPluginBySource).toHaveBeenCalledTimes(1);
    expect(insertProject).not.toHaveBeenCalled();
    expect(insertConversation).not.toHaveBeenCalled();
  });

  it('still creates the project when preparation finishes inside the deadline', async () => {
    const insertProject = vi.fn((_: unknown, project: Record<string, unknown>) => project);
    const insertConversation = vi.fn();
    const baseUrl = await start(buildDeps({
      insertProject,
      insertConversation,
      projectCreatePreparationTimeoutMs: 2_000,
      designSystemDelayMs: 5,
    }));

    const response = await post(baseUrl);
    const happyBody = await response.json();
    expect([response.status, happyBody]).toEqual([
      200,
      expect.objectContaining({
        project: expect.objectContaining({ id: 'deadline-project', name: 'Deadline project' }),
        conversationId: 'conversation-id',
      }),
    ]);
    expect(insertProject).toHaveBeenCalledTimes(1);
    expect(insertConversation).toHaveBeenCalledTimes(1);
  });

  it('materializes a managed document directory before committing, without a first agent run', async () => {
    const projectsDir = await mkdtemp(path.join(tmpdir(), 'document-create-'));
    directories.push(projectsDir);
    const insertProject = vi.fn((_: unknown, project: Record<string, unknown>) => {
      expect(existsSync(path.join(projectsDir, 'deadline-project'))).toBe(true);
      return project;
    });
    const baseUrl = await start(buildDeps({ insertProject, insertConversation: vi.fn(), projectCreatePreparationTimeoutMs: 2_000, projectsDir }));
    const response = await post(baseUrl, {
      metadata: { kind: 'other', documentSetupIntent: { kind: 'free', purpose: '', contextRoots: [], imageIntakeConsent: false } },
      conversationMode: 'chat', automaticStrategyTaskProfile: undefined, pendingPrompt: null,
    });
    expect([response.status, await response.json()]).toEqual([200, expect.objectContaining({ conversationId: 'conversation-id' })]);
    expect(insertProject).toHaveBeenCalledOnce();
    expect(existsSync(path.join(projectsDir, 'deadline-project'))).toBe(true);
  });

  it('compensates a newly created managed directory when the database commit fails', async () => {
    const projectsDir = await mkdtemp(path.join(tmpdir(), 'document-create-failed-'));
    directories.push(projectsDir);
    const insertProject = vi.fn(() => { throw new Error('commit failed'); });
    const baseUrl = await start(buildDeps({ insertProject, insertConversation: vi.fn(), projectCreatePreparationTimeoutMs: 2_000, projectsDir }));
    expect((await post(baseUrl)).status).toBe(400);
    expect(insertProject).toHaveBeenCalledOnce();
    expect(existsSync(path.join(projectsDir, 'deadline-project'))).toBe(false);
  });

  it('preserves an existing managed folder when a later create commit fails', async () => {
    const projectsDir = await mkdtemp(path.join(tmpdir(), 'document-create-existing-'));
    directories.push(projectsDir);
    const directory = path.join(projectsDir, 'deadline-project');
    await mkdir(directory); await writeFile(path.join(directory, 'original.txt'), 'Keep existing files');
    const baseUrl = await start(buildDeps({ insertProject: vi.fn(() => { throw new Error('commit failed'); }), insertConversation: vi.fn(), projectCreatePreparationTimeoutMs: 2_000, projectsDir }));
    expect((await post(baseUrl)).status).toBe(400);
    expect(await readFile(path.join(directory, 'original.txt'), 'utf8')).toBe('Keep existing files');
  });
  it('creates a fast project in its own managed folder and defaults to a direct Design conversation', async () => {
    const projectsDir = await mkdtemp(path.join(tmpdir(), 'fast-project-create-'));
    directories.push(projectsDir);
    const insertProject = vi.fn((_: unknown, project: Record<string, unknown>) => project), insertConversation = vi.fn();
    const deps = buildDeps({ insertProject, insertConversation, projectCreatePreparationTimeoutMs: 2_000, projectsDir });
    const baseUrl = await start(deps);
    const response = await post(baseUrl, { metadata: { kind: 'other', projectMode: 'fast' }, conversationMode: undefined, automaticStrategyTaskProfile: undefined });
    expect(response.status).toBe(200);
    expect((await response.json() as { project: { metadata: unknown } }).project.metadata).toMatchObject({ kind: 'other', projectMode: 'fast' });
    expect(existsSync(path.join(projectsDir, 'deadline-project'))).toBe(true);
    expect(insertConversation.mock.calls[0]?.[1]).toMatchObject({ sessionMode: 'design' });
    expect(deps.pluginScope?.loadRegistry).not.toHaveBeenCalled();
  });

  it('rejects conflicting fast setup and external working folders before creating anything', async () => {
    const insertProject = vi.fn(), insertConversation = vi.fn();
    const baseUrl = await start(buildDeps({ insertProject, insertConversation, projectCreatePreparationTimeoutMs: 2_000 }));
    for (const extra of [{ userWorkingDir: 'C:/unselected' }, { documentSetupIntent: {} }, { linkedDirs: ['C:/unselected'] }]) {
      const response = await post(baseUrl, { metadata: { kind: 'other', projectMode: 'fast', ...extra } });
      expect(response.status).toBe(400);
    }
    expect(insertProject).not.toHaveBeenCalled(); expect(insertConversation).not.toHaveBeenCalled();
  });

});
