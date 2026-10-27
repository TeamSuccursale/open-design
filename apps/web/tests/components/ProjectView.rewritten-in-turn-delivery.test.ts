// A design turn that regenerates an EXISTING page through a script it ran
// (Bash → python gen.py, which overwrites proposta-b.html in place) leaves no
// new file name and no Write/Edit path inside the project. Delivery used to
// see zero produced and zero trace-object files and reported ARTIFACT_NOT_FOUND
// even though the page on disk had just been rewritten. Files whose mtime
// falls inside the turn window — the same window auto-open already trusted —
// now count as trace objects, so the turn is delivered.
import { describe, expect, it } from 'vitest';
import { computeTraceObjectFiles } from '../../src/components/ProjectView';
import { filesRewrittenInTurn } from '../../src/components/auto-open-file';
import { resolveDesignDeliveryOutcome } from '../../src/runtime/design-delivery';

const STARTED = 1_000_000;
const ENDED = 1_660_000;

const file = (name: string, mtime: number, extra: Record<string, unknown> = {}) =>
  ({ type: 'file', name, path: name, kind: 'html', mtime, ...extra }) as any;

const page = file('proposta-b-pianta-e-schede.html', 1_650_000);
const untouched = file('proposta-a.html', 400_000);
const before = [page.name, untouched.name];
// As in the real run: write the generator outside the project, then run it.
const scriptRun = [
  {
    kind: 'tool_use' as const,
    id: 'write-1',
    name: 'Write',
    input: { file_path: 'C:/Temp/scratchpad/gen/newB.py', content: 'print()' },
  },
  {
    kind: 'tool_use' as const,
    id: 'bash-1',
    name: 'Bash',
    input: { command: 'python C:/Temp/scratchpad/gen/newB.py' },
  },
];

function deliveryFor(files: any[], window: { turnStartedAt: number; turnEndedAt: number | null }) {
  const traceObjects =
    computeTraceObjectFiles(before, files, [], undefined, null, filesRewrittenInTurn(files, window)) ?? [];
  return {
    traceObjects,
    outcome: resolveDesignDeliveryOutcome({
      sessionMode: 'design',
      runStatus: 'succeeded',
      content: 'Ho rigenerato la proposta B.',
      events: scriptRun,
      producedFileCount: 0,
      traceObjectFileCount: traceObjects.length,
    }),
  };
}

describe('existing files rewritten during the turn count as delivered', () => {
  it('delivers a page a script rewrote in place inside the turn window', () => {
    const { traceObjects, outcome } = deliveryFor([page, untouched], {
      turnStartedAt: STARTED,
      turnEndedAt: ENDED,
    });
    expect(traceObjects.map((f) => [f.name, f.traceObjectReason])).toEqual([
      ['proposta-b-pianta-e-schede.html', 'modified'],
    ]);
    expect(outcome).toBe('delivered');
  });

  it('still fails a turn whose files were all last written before it started', () => {
    const { traceObjects, outcome } = deliveryFor([file(page.name, 400_000), untouched], {
      turnStartedAt: STARTED,
      turnEndedAt: ENDED,
    });
    expect(traceObjects).toEqual([]);
    expect(outcome).toBe('no_result');
  });

  it('does not credit the turn with an edit made well after it ended', () => {
    const { traceObjects, outcome } = deliveryFor([file(page.name, ENDED + 5 * 60_000), untouched], {
      turnStartedAt: STARTED,
      turnEndedAt: ENDED,
    });
    expect(traceObjects).toEqual([]);
    expect(outcome).toBe('no_result');
  });

  it('keeps the agent-touched restriction: other in-window files are not claimed', () => {
    const other = file('notes.html', 1_200_000);
    const rewritten = filesRewrittenInTurn([page, other, untouched], {
      turnStartedAt: STARTED,
      turnEndedAt: ENDED,
      agentTouchedFileNames: new Set([page.name]),
    });
    expect(rewritten.map((f) => f.name)).toEqual([page.name]);
  });

  it('adds nothing without a turn start stamp', () => {
    expect(filesRewrittenInTurn([page], { turnStartedAt: null, turnEndedAt: ENDED })).toEqual([]);
  });

  it('does not duplicate or relabel a file the turn created', () => {
    const created = file('nuova.html', 1_100_000);
    const files = [page, untouched, created];
    const traceObjects =
      computeTraceObjectFiles(before, files, [], undefined, null, filesRewrittenInTurn(files, {
        turnStartedAt: STARTED,
        turnEndedAt: ENDED,
      })) ?? [];
    expect(traceObjects.map((f) => [f.name, f.traceObjectReason])).toEqual([
      ['nuova.html', 'new'],
      ['proposta-b-pianta-e-schede.html', 'modified'],
    ]);
  });
});
