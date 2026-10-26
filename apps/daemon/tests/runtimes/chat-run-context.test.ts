import { describe, expect, it } from 'vitest';

import {
  mergeRunContextSelections,
  normalizeRunContextSelection,
  normalizeWorkspaceContextItems,
  renderRunContextPrompt,
} from '../../src/runtimes/chat-run-context.js';

describe('chat run context helpers', () => {
  it('preserves the explicit edit target independently from referenced tabs and rejects unsafe paths', () => {
    const current = { editTargetFile: 'documents/report/blockout-comparison.html', workspaceItems: [{ id: 'ref', kind: 'file', label: 'Reference', path: 'documents/other/blockout-comparison.html' }] };
    expect(normalizeRunContextSelection(current).editTargetFile).toBe(current.editTargetFile);
    expect(mergeRunContextSelections({ editTargetFile: 'old.html' }, current).editTargetFile).toBe(current.editTargetFile);
    expect(renderRunContextPrompt(current, {})).toContain('Explicit editing target');
    for (const editTargetFile of ['../escape.html', 'C:\\private\\secret.html', '/absolute.html', 'file//bad.html']) expect(normalizeRunContextSelection({ editTargetFile }).editTargetFile).toBeUndefined();
    expect(normalizeRunContextSelection({ workspaceItems: current.workspaceItems }).editTargetFile).toBeUndefined();
  });
  it('normalizes workspace context items and dedupes by kind/id', () => {
    expect(normalizeWorkspaceContextItems([
      { kind: 'browser', id: ' tab-1 ', label: ' Docs ', url: ' https://example.com/docs ' },
      { kind: 'browser', id: 'tab-1', label: 'Duplicate' },
      { kind: 'unknown', id: 'x', label: 'Ignored' },
      { kind: 'file', id: 'file-1', label: 'App', path: 'src/app.ts' },
      null,
    ])).toEqual([
      {
        kind: 'browser',
        id: 'tab-1',
        label: 'Docs',
        url: 'https://example.com/docs',
      },
      {
        kind: 'file',
        id: 'file-1',
        label: 'App',
        path: 'src/app.ts',
      },
    ]);
  });

  it('merges project metadata context before per-run context without duplicate ids', () => {
    expect(mergeRunContextSelections(
      { pluginIds: ['brand-kit'], connectorIds: ['figma'] },
      { pluginIds: ['brand-kit', 'motion'], mcpServerIds: ['browser'] },
    )).toEqual({
      pluginIds: ['brand-kit', 'motion'],
      mcpServerIds: ['browser'],
      connectorIds: ['figma'],
    });
  });

  it('renders selected workspace and connector context for the agent prompt', () => {
    const prompt = renderRunContextPrompt(
      {
        workspaceItems: [
          {
            kind: 'terminal',
            id: 'term-1',
            label: 'Dev server',
            tabId: 'terminal-tab',
          },
        ],
        connectorIds: ['figma'],
      },
      {
        contextConnectors: [
          {
            id: 'figma',
            name: 'Figma',
            provider: 'figma',
            status: 'connected',
          },
        ],
      },
    );

    expect(prompt).toContain('## Selected run context');
    expect(prompt).toContain('terminal: Dev server (`term-1`)');
    expect(prompt).toContain('Selected connectors');
    expect(prompt).toContain('- Figma (`figma`)');
  });
});
