// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blockoutHandoffSnapshot, createBlockoutDocument, type BlockoutDesignRevision, type BlockoutDesignState } from '@open-design/contracts';
import { BlockoutCompositionAction } from '../../src/components/blockout/BlockoutCompositionAction';
import { I18nProvider } from '../../src/i18n';
import { loadBlockoutDesign } from '../../src/providers/blockout-design';

vi.mock('../../src/providers/blockout-design', () => ({ loadBlockoutDesign: vi.fn() }));

const html = '<article data-blockout-document-id="document-1" data-blockout-page-id="page-1"></article>';
let revision: BlockoutDesignRevision;
let state: BlockoutDesignState;

beforeEach(() => {
  const snapshot = blockoutHandoffSnapshot(createBlockoutDocument());
  revision = {
    revisionId: 'completed-design', runId: 'run-1', handoffId: 'handoff-1',
    entryFile: 'report.html', files: [], snapshot, requested: structuredClone(snapshot),
    pages: [{ pageId: 'page-1', filePath: 'report.html', widthPx: 794, heightPx: 1123, blocks: [] }],
    status: 'applied', createdAt: '2026-10-26', baseDesignRevisionId: null, inputDigest: 'digest',
  };
  state = { version: 1, documentId: 'document-1', applied: null, pending: [{ ...revision, status: 'pending' }], sourceChanged: false, pendingChanges: false };
  vi.mocked(loadBlockoutDesign).mockImplementation(async () => ({ state: structuredClone(state), projectId: 'project' }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

function action(generating: boolean, filePath = 'report.html') {
  return <I18nProvider initial="en"><BlockoutCompositionAction projectId="project" filePath={filePath} html={html} generating={generating} getFrame={() => null} /></I18nProvider>;
}

it('discovers the applied composition when generation finishes without changing the preview HTML or path', async () => {
  const view = render(action(true));
  await act(async () => {});
  expect(loadBlockoutDesign).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Edit page composition' })).toBeNull();

  state = { ...state, applied: revision, pending: [] };
  view.rerender(action(false));

  expect(await screen.findByRole('button', { name: 'Edit page composition' })).toBeTruthy();
  expect(loadBlockoutDesign).toHaveBeenCalledTimes(2);
});

it('rechecks an explicitly pending receipt after the completion event until validation applies it', async () => {
  vi.useFakeTimers();
  const view = render(action(true));
  await act(async () => {});
  view.rerender(action(false));
  await act(async () => {});
  expect(loadBlockoutDesign).toHaveBeenCalledTimes(2);

  state = { ...state, applied: revision, pending: [] };
  await act(async () => { await vi.advanceTimersByTimeAsync(9_999); });
  expect(loadBlockoutDesign).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByRole('button', { name: 'Edit page composition' })).toBeTruthy();
  expect(loadBlockoutDesign).toHaveBeenCalledTimes(3);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(loadBlockoutDesign).toHaveBeenCalledTimes(3);
});

it.each([
  ['project', 'report.html', true],
  ['child-project', 'documents/document-1/report.html', true],
  ['project', 'documents/document-1/report.html', false],
  ['child-project', 'documents/other-document/report.html', false],
] as const)('keeps exact file ownership for owner %s and path %s', async (owner, filePath, available) => {
  state = { ...state, applied: revision, pending: [] };
  vi.mocked(loadBlockoutDesign).mockResolvedValue({ state, projectId: owner });
  render(action(false, filePath));
  await act(async () => {});

  expect(Boolean(screen.queryByRole('button', { name: 'Edit page composition' }))).toBe(available);
});

it('does not poll indefinitely when completion has no pending or applied receipt', async () => {
  vi.useFakeTimers();
  state.pending = [];
  render(action(false));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(loadBlockoutDesign).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Edit page composition' })).toBeNull();
});
