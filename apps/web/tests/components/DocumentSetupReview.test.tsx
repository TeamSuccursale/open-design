// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentSetup, ProjectIntakeCatalog, ProjectIntakeSettings } from '@open-design/contracts';
import { DocumentSetupReview } from '../../src/components/document-setup/DocumentSetupReview';
import { I18nProvider } from '../../src/i18n';
import { en } from '../../src/i18n/locales/en';
import { DOCUMENT_PREPARATION_RESUME_EVENT, documentSetupRequest } from '../../src/providers/document-setup';
import { fetchIntakeSettings, fetchProjectIntake, PROJECT_INTAKE_RETRY_EVENT, PROJECT_INTAKE_UPDATED_EVENT } from '../../src/providers/project-intake';

vi.mock('../../src/providers/document-setup', () => ({ documentSetupRequest: vi.fn(), DOCUMENT_PREPARATION_RESUME_EVENT: 'test:preparation-resume' }));
vi.mock('../../src/providers/project-intake', () => ({ fetchIntakeSettings: vi.fn(), fetchProjectIntake: vi.fn(), PROJECT_INTAKE_RETRY_EVENT: 'test:intake-retry', PROJECT_INTAKE_UPDATED_EVENT: 'test:intake-updated' }));
vi.mock('../../src/providers/header-footer', () => ({ getHeaderFooterSourceFiles: vi.fn(async () => ({ files: [], truncated: false })) }));
const chat = (key: string) => en[`documentChat.${key}` as keyof typeof en];
const start = (key: string) => en[`documentStart.${key}` as keyof typeof en];
const emptyCatalog: ProjectIntakeCatalog = { version: 1, documents: [], assets: [] };
const settings: ProjectIntakeSettings = { version: 1, sourceDirs: ['C:\\ExistingReferences'], outputDir: 'prepared-images', projectDir: 'C:\\Working', configPath: 'intake.config.json', catalogPath: 'intake.catalog.json', outputPath: 'C:\\Working\\prepared-images', uploadPath: 'C:\\Working\\uploads' };
const fixture = (patch: Partial<DocumentSetup> = {}): DocumentSetup => ({
  version: 1, status: 'review', intent: { kind: 'report', subtype: 'Survey report', purpose: 'Illustrate the survey results', contextRoots: ['C:\\ExtraReferences'], imageIntakeConsent: false },
  workingDirectory: 'C:\\Working', scan: { status: 'complete', sources: [{ id: 'source-1', path: 'disciplinare.pdf', root: 'C:\\Working', page: 7, title: 'Formatting instructions', excerpt: 'Use A3 and at most 8 pages.', readable: true, role: 'rules' }], constraints: [
    { id: 'paper', kind: 'paper', value: 'A3', status: 'suggested', sourceIds: ['source-1'] },
    { id: 'pages', kind: 'page-limit', value: '8 pages', status: 'suggested', sourceIds: ['source-1'] },
  ], warnings: [], coverage: '2 relevant documents inspected; searchable text only.' }, updatedAt: '2026-10-23T12:00:00Z', ...patch,
});
let source: DocumentSetup, sequence = 0, revision = 0;
const nextRevision = () => `2026-10-23T12:${String(++revision).padStart(2, '0')}:00Z`;
function prepared(dispatched = true): DocumentSetup {
  const value = fixture();
  value.intent = { ...value.intent, imageIntakeDecision: 'declined', preparationConversation: { requestId: 'preparation-stable-id', dispatched, blockoutRequestId: 'blockout-stable-id' } };
  return value;
}
function confirmed(value = source): DocumentSetup {
  return { ...value, status: 'confirmed', confirmed: { purpose: 'Engineer-confirmed survey report', constraints: value.scan.constraints, blockoutApproach: 'agent', confirmedAt: '2026-10-23T13:00:00Z' }, updatedAt: nextRevision() };
}
function setup(overrides: Partial<React.ComponentProps<typeof DocumentSetupReview>> = {}) {
  const props = { projectId: `document-conversation-${++sequence}`, enabled: true, canStart: true, onExit: vi.fn(), onPrepareChat: vi.fn().mockResolvedValue(true), onStart: vi.fn().mockResolvedValue(true), onPendingChange: vi.fn(), ...overrides };
  const view = render(<I18nProvider initial="en"><DocumentSetupReview {...props} /></I18nProvider>);
  return { ...props, ...view, rerenderProps: (next: Partial<typeof props>) => view.rerender(<I18nProvider initial="en"><DocumentSetupReview {...props} {...next} /></I18nProvider>) };
}
const continueButton = () => screen.getByRole('button', { name: chat('prepareContinue') });
const writes = () => vi.mocked(documentSetupRequest).mock.calls.filter((call) => call[2] === 'intent');
async function continuePreparation(images = true) {
  const checkbox = await screen.findByRole('checkbox', { name: chat('prepareImages') });
  if (!images) fireEvent.click(checkbox);
  fireEvent.click(continueButton());
}

beforeEach(() => {
  revision = 0; source = fixture();
  vi.mocked(documentSetupRequest).mockImplementation(async (_id, _context, operation, input) => {
    if (operation === 'intent') source = { ...source, intent: { ...source.intent, ...structuredClone(input as Partial<DocumentSetup['intent']>) }, updatedAt: nextRevision() };
    if (operation === 'scan') source = { ...source, status: 'review', scan: { ...source.scan, status: 'complete' }, updatedAt: nextRevision() };
    return structuredClone(source);
  });
  vi.mocked(fetchIntakeSettings).mockResolvedValue(settings); vi.mocked(fetchProjectIntake).mockResolvedValue(emptyCatalog);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('agent-led document preparation', () => {
  it('offers default image preparation and one Continue, then starts the real conversation callback and hides setup', async () => {
    const view = setup(), checkbox = await screen.findByRole('checkbox', { name: chat('prepareImages') });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryByRole('textbox')).toBeNull(); expect(screen.queryByRole('combobox')).toBeNull(); expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByLabelText(start('purpose'))).toBeNull(); expect(screen.queryByText(start('contextReady'))).toBeNull();
    expect(view.onPrepareChat).not.toHaveBeenCalled(); expect(view.onStart).not.toHaveBeenCalled(); expect(fetchProjectIntake).not.toHaveBeenCalled();
    fireEvent.click(continueButton());
    await waitFor(() => expect(source.intent.preparationConversation?.dispatched).toBe(true));
    expect(view.onPrepareChat).toHaveBeenCalledOnce(); expect(view.onStart).not.toHaveBeenCalled();
    const sent = vi.mocked(view.onPrepareChat).mock.calls[0]![0];
    expect(sent.intent).toMatchObject({ imageIntakeConsent: true, imageIntakeDecision: 'accepted', preparationConversation: { dispatched: false } });
    expect(sent.intent.preparationConversation?.requestId).toBeTruthy(); expect(sent.intent.preparationConversation?.blockoutRequestId).toBeTruthy();
    expect(writes()[0]![3]).toMatchObject({ preparationConversation: sent.intent.preparationConversation });
    expect(writes()[1]![3]).toMatchObject({ preparationConversation: { ...sent.intent.preparationConversation, dispatched: true } });
    const firstSave = vi.mocked(documentSetupRequest).mock.calls.findIndex((call) => call[2] === 'intent');
    expect(vi.mocked(documentSetupRequest).mock.invocationCallOrder[firstSave]!).toBeLessThan(vi.mocked(view.onPrepareChat).mock.invocationCallOrder[0]!);
    expect(screen.queryByRole('region', { name: chat('title') })).toBeNull();
    expect(view.onPendingChange).toHaveBeenCalledWith(true);
  });

  it('starts the conversation after declining images and never configures or launches intake', async () => {
    const view = setup(); await continuePreparation(false);
    await waitFor(() => expect(source.intent.preparationConversation?.dispatched).toBe(true));
    expect(view.onPrepareChat).toHaveBeenCalledOnce(); expect(view.onStart).not.toHaveBeenCalled();
    expect(source.intent).toMatchObject({ imageIntakeConsent: false, imageIntakeDecision: 'declined' });
    expect(fetchIntakeSettings).not.toHaveBeenCalled(); expect(fetchProjectIntake).not.toHaveBeenCalled();
  });

  it('starts background text preparation when resuming consent saved before conversation markers existed', async () => {
    source.intent.imageIntakeDecision = 'declined';
    const started = vi.fn();
    window.addEventListener('melillodesign:document-preparation-started', started);
    try {
      const view = setup();
      await waitFor(() => expect(source.intent.preparationConversation?.dispatched).toBe(true));
      expect(view.onPrepareChat).toHaveBeenCalledOnce();
      expect(started).toHaveBeenCalledOnce();
      expect((started.mock.calls[0]![0] as CustomEvent).detail).toEqual({ projectId: view.projectId });
      view.unmount(); setup({ projectId: view.projectId });
      await waitFor(() => expect(documentSetupRequest).toHaveBeenCalled());
      expect(started).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('melillodesign:document-preparation-started', started);
    }
  });

  it('automatically scans unread text before offering Continue, without asking the user to fill context fields', async () => {
    source.scan.status = 'not-run'; source.status = 'draft';
    let finishScan!: (value: DocumentSetup) => void;
    vi.mocked(documentSetupRequest).mockImplementation(async (_id, _context, operation) => operation === 'scan' ? new Promise((resolve) => { finishScan = resolve; }) : structuredClone(source));
    const view = setup();
    await waitFor(() => expect(documentSetupRequest).toHaveBeenCalledWith(view.projectId, undefined, 'scan'));
    expect(screen.getByRole('status').textContent).toContain(chat('reading'));
    expect(continueButton().hasAttribute('disabled')).toBe(true); expect(view.onPrepareChat).not.toHaveBeenCalled();
    await act(async () => { finishScan(fixture()); });
    await screen.findByRole('checkbox', { name: chat('prepareImages') });
    expect(continueButton().hasAttribute('disabled')).toBe(false); expect(screen.queryByRole('textbox')).toBeNull();
    expect(view.onPrepareChat).not.toHaveBeenCalled();
  });

  it('waits for the active agent to finish before dispatching a saved pending preparation request', async () => {
    source = prepared(false); const view = setup({ canStart: false });
    await waitFor(() => expect(view.onPendingChange).toHaveBeenCalledWith(true));
    expect(view.onPrepareChat).not.toHaveBeenCalled(); expect(view.onStart).not.toHaveBeenCalled();
    view.rerenderProps({ canStart: true });
    await waitFor(() => expect(source.intent.preparationConversation?.dispatched).toBe(true));
    expect(view.onPrepareChat).toHaveBeenCalledOnce();
    expect(vi.mocked(view.onPrepareChat).mock.calls[0]![0].intent.preparationConversation?.requestId).toBe('preparation-stable-id');
  });

  it('keeps the saved request identity after a failed conversation dispatch and retries explicitly', async () => {
    const onPrepareChat = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    setup({ onPrepareChat }); await continuePreparation(false);
    expect((await screen.findByRole('alert')).textContent).toContain(chat('agentStartFailed'));
    const requestId = source.intent.preparationConversation?.requestId;
    expect(requestId).toBeTruthy(); expect(source.intent.preparationConversation?.dispatched).toBe(false);
    expect(onPrepareChat).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: start('retry') }));
    await waitFor(() => expect(source.intent.preparationConversation?.dispatched).toBe(true));
    expect(onPrepareChat).toHaveBeenCalledTimes(2);
    expect(onPrepareChat.mock.calls.map(([value]) => value.intent.preparationConversation?.requestId)).toEqual([requestId, requestId]);
  });

  it('does not send a second preparation request when a dispatched marker is reopened', async () => {
    source = prepared(true); const view = setup();
    await waitFor(() => expect(view.onPendingChange).toHaveBeenCalledWith(true));
    expect(view.onPrepareChat).not.toHaveBeenCalled(); expect(view.onStart).not.toHaveBeenCalled();
    view.unmount(); const reopened = setup({ projectId: view.projectId });
    await waitFor(() => expect(reopened.onPendingChange).toHaveBeenCalledWith(true));
    expect(reopened.onPrepareChat).not.toHaveBeenCalled(); expect(reopened.onStart).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
  });

  it('resumes a retired brief question with a new request while preserving all saved answers', async () => {
    source = prepared(true);
    source.intent.intakeAnswers = { documentPreset: 'technical', materialState: 'ready', notes: 'Eight A4 pages, cover not numbered; answer already given.' };
    const view = setup();
    fireEvent.click(await screen.findByRole('button', { name: chat('resumeBrief') }));
    await waitFor(() => expect(source.intent.preparationConversation?.resumeDispatched).toBe(true));
    const sent = vi.mocked(view.onPrepareChat).mock.calls[0]![0];
    expect(sent.intent.intakeAnswers).toEqual(source.intent.intakeAnswers);
    expect(sent.intent.preparationConversation?.resumeRequestId).toBeTruthy();
    expect(sent.intent.preparationConversation?.requestId).toBe('preparation-stable-id');
    expect(source.status).toBe('review'); expect(view.onStart).not.toHaveBeenCalled();
  });

  it('offers recovery only after the active question is retired, without competing with its answer controls', async () => {
    source = prepared(true); const view = setup({ hasActiveQuestion: true });
    await waitFor(() => expect(view.onPendingChange).toHaveBeenCalledWith(true));
    expect(screen.queryByRole('button', { name: chat('resumeBrief') })).toBeNull();
    expect(view.onPrepareChat).not.toHaveBeenCalled();
    view.rerenderProps({ hasActiveQuestion: false });
    expect(await screen.findByRole('button', { name: chat('resumeBrief') })).toBeTruthy();
    expect(writes()).toHaveLength(0);
    expect(view.onPrepareChat).not.toHaveBeenCalled();
  });

  it('queues applied-header/footer recovery while busy, then resumes from the saved request when ready', async () => {
    source = prepared(true); const view = setup({ canStart: false, hasActiveQuestion: true });
    await waitFor(() => expect(view.onPendingChange).toHaveBeenCalledWith(true));
    await act(async () => { window.dispatchEvent(new CustomEvent(DOCUMENT_PREPARATION_RESUME_EVENT, { detail: { projectId: view.projectId } })); });
    await waitFor(() => expect(source.intent.preparationConversation?.resumeRequestId).toBeTruthy());
    const requestId = source.intent.preparationConversation?.resumeRequestId;
    expect(source.intent.preparationConversation?.resumeDispatched).toBe(false);
    expect(view.onPrepareChat).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: chat('resumeBrief') })).toBeNull();
    view.rerenderProps({ canStart: true, hasActiveQuestion: false });
    await waitFor(() => expect(source.intent.preparationConversation?.resumeDispatched).toBe(true));
    expect(view.onPrepareChat).toHaveBeenCalledOnce();
    expect(vi.mocked(view.onPrepareChat).mock.calls[0]![0].intent.preparationConversation?.resumeRequestId).toBe(requestId);
    expect(source.status).toBe('review'); expect(view.onStart).not.toHaveBeenCalled();
  });

  it('automatically returns from applied header/footer to a fresh consent question, never confirms or generates on its own', async () => {
    source = prepared(true); const view = setup();
    await waitFor(() => expect(view.onPendingChange).toHaveBeenCalledWith(true));
    await act(async () => { window.dispatchEvent(new CustomEvent(DOCUMENT_PREPARATION_RESUME_EVENT, { detail: { projectId: view.projectId } })); });
    await waitFor(() => expect(source.intent.preparationConversation?.resumeDispatched).toBe(true));
    expect(view.onPrepareChat).toHaveBeenCalledOnce(); expect(view.onStart).not.toHaveBeenCalled();
    expect(source.status).toBe('review'); expect(source.confirmed).toBeUndefined();
  });

  it('retries a failed resumed question under the same durable request identity', async () => {
    source = prepared(true); const onPrepareChat = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    setup({ onPrepareChat });
    fireEvent.click(await screen.findByRole('button', { name: chat('resumeBrief') }));
    await screen.findByRole('alert');
    const requestId = source.intent.preparationConversation?.resumeRequestId;
    expect(requestId).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: start('retry') }));
    await waitFor(() => expect(source.intent.preparationConversation?.resumeDispatched).toBe(true));
    expect(onPrepareChat.mock.calls.map(([value]) => value.intent.preparationConversation?.resumeRequestId)).toEqual([requestId, requestId]);
  });

  it('keeps the header/footer handoff separate from body generation and resumes only after every required binding is applied', async () => {
    source = confirmed(prepared(true));
    source.intent.editorialSettings = [{ documentId: 'report', presentation: { version: 1, status: 'confirmed', name: 'Report', header: true, footer: true, cover: false, pageNumbers: false, numberOnCover: null, coverCountsTowardPageLimit: null, coverCountsInNumbering: null, numberingStart: 1 } }];
    const onStart = vi.fn().mockResolvedValueOnce('header-footer').mockResolvedValueOnce(true);
    const view = setup({ onStart });
    await waitFor(() => expect(source.intent.preparationConversation?.headerFooterDispatched).toBe(true));
    expect(source.intent.preparationConversation?.headerFooterRequestId).toBeTruthy();
    expect(source.intent.preparationConversation?.blockoutDispatched).not.toBe(true);
    expect(onStart).toHaveBeenCalledOnce();
    // A refresh before application must not issue the header/footer request again.
    await act(async () => { window.dispatchEvent(new CustomEvent('melillodesign:document-context-updated', { detail: { projectId: view.projectId } })); });
    await waitFor(() => expect(documentSetupRequest).toHaveBeenCalled());
    expect(onStart).toHaveBeenCalledOnce();
    source.intent.editorialSettings[0]!.presentation.headerFooter = { version: 1 } as NonNullable<DocumentSetup['intent']['editorialSettings']>[number]['presentation']['headerFooter'];
    source.updatedAt = nextRevision();
    await act(async () => { window.dispatchEvent(new CustomEvent(DOCUMENT_PREPARATION_RESUME_EVENT, { detail: { projectId: view.projectId } })); });
    await waitFor(() => expect(source.intent.preparationConversation?.blockoutDispatched).toBe(true));
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onStart.mock.calls[1]![0].intent.preparationConversation?.blockoutRequestId).toBe('blockout-stable-id');
    expect(view.onPrepareChat).not.toHaveBeenCalled();
  });

  it('keeps a legacy confirmed document without a conversation marker passive, even without an old intake decision', async () => {
    source = confirmed(fixture()); const view = setup();
    await waitFor(() => expect(view.onPendingChange).toHaveBeenCalledWith(false));
    expect(screen.queryByRole('region', { name: chat('title') })).toBeNull();
    expect(view.onPrepareChat).not.toHaveBeenCalled(); expect(view.onStart).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
  });

  it('hands an agent-confirmed brief to Blockout once and persists completion under its saved request ID', async () => {
    source = confirmed(prepared(true)); const view = setup();
    await waitFor(() => expect(source.intent.preparationConversation?.blockoutDispatched).toBe(true));
    expect(view.onStart).toHaveBeenCalledOnce(); expect(view.onPrepareChat).not.toHaveBeenCalled();
    expect(vi.mocked(view.onStart).mock.calls[0]![0]).toMatchObject({ status: 'confirmed', confirmed: { purpose: 'Engineer-confirmed survey report' }, intent: { preparationConversation: { blockoutRequestId: 'blockout-stable-id' } } });
    view.unmount(); const reopened = setup({ projectId: view.projectId });
    await waitFor(() => expect(reopened.onPendingChange).toHaveBeenCalledWith(false));
    expect(reopened.onStart).not.toHaveBeenCalled(); expect(reopened.onPrepareChat).not.toHaveBeenCalled();
  });

  it('rereads the agent-authored confirmation after the agent becomes ready and then starts Blockout', async () => {
    source = prepared(true); const view = setup({ canStart: false });
    await waitFor(() => expect(view.onPendingChange).toHaveBeenCalledWith(true));
    source = confirmed(source); view.rerenderProps({ canStart: true });
    await waitFor(() => expect(source.intent.preparationConversation?.blockoutDispatched).toBe(true));
    expect(view.onStart).toHaveBeenCalledOnce(); expect(view.onPrepareChat).not.toHaveBeenCalled();
    expect(vi.mocked(view.onStart).mock.calls[0]![0].status).toBe('confirmed');
  });

  it('keeps the Blockout request identity and saved confirmation after a failed handoff', async () => {
    source = confirmed(prepared(true)); const onStart = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const view = setup({ onStart });
    expect((await screen.findByRole('alert')).textContent).toContain(start('sendFailed'));
    expect(source.status).toBe('confirmed'); expect(source.intent.preparationConversation?.blockoutDispatched).not.toBe(true);
    fireEvent.click(screen.getByRole('button', { name: start('retry') }));
    await waitFor(() => expect(source.intent.preparationConversation?.blockoutDispatched).toBe(true));
    expect(onStart).toHaveBeenCalledTimes(2); expect(view.onPrepareChat).not.toHaveBeenCalled();
    expect(onStart.mock.calls.map(([value]) => value.intent.preparationConversation?.blockoutRequestId)).toEqual(['blockout-stable-id', 'blockout-stable-id']);
  });

  it('keeps the conversation working after intake launch fails and retries only from the intake retry event', async () => {
    vi.mocked(fetchIntakeSettings).mockRejectedValueOnce(new Error('Image worker unavailable')).mockResolvedValue(settings);
    const changed = vi.fn(); window.addEventListener(PROJECT_INTAKE_UPDATED_EVENT, changed);
    const view = setup(); await continuePreparation();
    await waitFor(() => expect(source.intent.preparationConversation?.dispatched).toBe(true));
    expect(view.onPrepareChat).toHaveBeenCalledOnce(); expect(view.onStart).not.toHaveBeenCalled();
    expect(changed.mock.calls.some(([event]) => event.detail.projectId === view.projectId && event.detail.launchError === 'Image worker unavailable')).toBe(true);
    expect(fetchProjectIntake).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new CustomEvent(PROJECT_INTAKE_RETRY_EVENT, { detail: { projectId: view.projectId } })); });
    await waitFor(() => expect(fetchProjectIntake).toHaveBeenCalledWith(view.projectId, undefined, { retry: true }));
    expect(fetchIntakeSettings).toHaveBeenCalledWith(view.projectId, undefined, { version: 1, sourceDirs: ['C:\\ExistingReferences', 'C:\\ExtraReferences'], outputDir: 'prepared-images' });
    expect(view.onPrepareChat).toHaveBeenCalledOnce(); window.removeEventListener(PROJECT_INTAKE_UPDATED_EVENT, changed);
  });

  it('rejects a destination mismatch before text scanning, intake or agent callbacks', async () => {
    source.scan.status = 'not-run'; source.intent.imageIntakeConsent = true;
    const view = setup({ expectedWorkingDirectory: 'C:\\DifferentProject' });
    expect((await screen.findByRole('alert')).textContent).toContain(start('destinationMismatch'));
    expect(vi.mocked(documentSetupRequest).mock.calls.some((call) => call[2] === 'scan')).toBe(false);
    expect(fetchIntakeSettings).not.toHaveBeenCalled(); expect(fetchProjectIntake).not.toHaveBeenCalled();
    expect(view.onPrepareChat).not.toHaveBeenCalled(); expect(view.onStart).not.toHaveBeenCalled();
  });

  it('also rejects a destination mismatch in the confirmation reread after the agent finishes', async () => {
    source = prepared(true); const view = setup({ canStart: false, expectedWorkingDirectory: 'C:\\Working' });
    await waitFor(() => expect(view.onPendingChange).toHaveBeenCalledWith(true));
    source = { ...confirmed(source), workingDirectory: 'C:\\DifferentProject' };
    view.rerenderProps({ canStart: true });
    expect((await screen.findByRole('alert')).textContent).toContain(start('destinationMismatch'));
    expect(view.onPrepareChat).not.toHaveBeenCalled(); expect(view.onStart).not.toHaveBeenCalled();
  });

  it('recovers a failed automatic text read before making a preparation request', async () => {
    source.scan.status = 'not-run'; let failed = false;
    vi.mocked(documentSetupRequest).mockImplementation(async (_id, _context, operation, input) => {
      if (operation === 'scan' && !failed) { failed = true; throw new Error('Text extraction unavailable'); }
      if (operation === 'scan') source = { ...source, scan: { ...source.scan, status: 'complete' }, updatedAt: nextRevision() };
      if (operation === 'intent') source = { ...source, intent: { ...source.intent, ...input as Partial<DocumentSetup['intent']> }, updatedAt: nextRevision() };
      return structuredClone(source);
    });
    const view = setup(); expect((await screen.findByRole('alert')).textContent).toContain('Text extraction unavailable');
    expect(view.onPrepareChat).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: start('retry') }));
    await screen.findByRole('checkbox', { name: chat('prepareImages') }); await continuePreparation(false);
    await waitFor(() => expect(source.intent.preparationConversation?.dispatched).toBe(true)); expect(view.onPrepareChat).toHaveBeenCalledOnce();
  });
});
