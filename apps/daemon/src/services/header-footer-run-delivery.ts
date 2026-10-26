import type { HeaderFooterDraftDeliveryReceipt } from '@open-design/contracts';

/** Manual edits, failed saves and another project's run cannot satisfy a turn's delivery check. */
export function recordHeaderFooterDraftRunDelivery<Run extends { projectId: string | null; status: string }>(input: {
  runId?: string;
  requestedProjectId: string;
  collectionId: string;
  setId: string;
  draftVersion: number;
  stage: 'structural' | 'graphic';
  getRun(id: string): Run | null | undefined;
  collectionForProject(id: string): string;
  emit(run: Run, receipt: HeaderFooterDraftDeliveryReceipt): void;
}): boolean {
  if (!input.runId || !input.setId || !Number.isInteger(input.draftVersion) || input.draftVersion < 1) return false;
  const run = input.getRun(input.runId);
  if (!run?.projectId || run.status !== 'running') return false;
  if (input.collectionForProject(run.projectId) !== input.collectionId
    || input.collectionForProject(input.requestedProjectId) !== input.collectionId) return false;
  input.emit(run, { name: 'header_footer_draft_saved', source: 'daemon-header-footer', shape: {
    projectId: input.collectionId, setId: input.setId, draftVersion: input.draftVersion, stage: input.stage,
  } });
  return true;
}
