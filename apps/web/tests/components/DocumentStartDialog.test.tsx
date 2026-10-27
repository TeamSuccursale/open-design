// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isOpenDesignHostAvailable, pickHostWorkingDir } from '@open-design/host';
import { DocumentStartDialog, type DocumentStartDraft } from '../../src/components/document-setup/DocumentStartDialog';
import { I18nProvider } from '../../src/i18n';
import { en } from '../../src/i18n/locales/en';
import { dirExists, openFolderDialog } from '../../src/providers/registry';
import { fetchProjectLocations } from '../../src/state/project-locations';
import { LOCAL_REQUEST_TIMEOUT_MS } from '../../src/runtime/request-deadline';

vi.mock('@open-design/host', () => ({ isOpenDesignHostAvailable: vi.fn(), pickHostWorkingDir: vi.fn() }));
vi.mock('../../src/providers/registry', () => ({ dirExists: vi.fn(), openFolderDialog: vi.fn() }));
vi.mock('../../src/state/project-locations', () => ({ fetchProjectLocations: vi.fn() }));
const text = (key: string) => en[`documentStart.${key}` as keyof typeof en] ?? `documentStart.${key}`;
const wizard = (key: string) => en[`documentWizard.${key}` as keyof typeof en];
function setup(props: Partial<React.ComponentProps<typeof DocumentStartDialog>> = {}) {
  const onConfirm = vi.fn<(draft: DocumentStartDraft) => void>(), onCancel = vi.fn();
  render(<I18nProvider initial="en"><DocumentStartDialog purpose="Prepare the project report" initialProjectName="Test project" onConfirm={onConfirm} onCancel={onCancel} {...props} /></I18nProvider>);
  return { onConfirm, onCancel };
}
function chooseKind(kind = 'free') { fireEvent.change(screen.getByLabelText(text('kind')), { target: { value: kind } }); }
function choosePreset(preset: string) { fireEvent.change(screen.getByLabelText(text('preset')), { target: { value: preset } }); }
function chooseManaged() { fireEvent.click(screen.getByRole('radio', { name: text('managed') })); }
function chooseFolder(path: string) {
  fireEvent.click(screen.getByRole('radio', { name: text('useFolder') }));
  fireEvent.change(screen.getByLabelText(text('workingFolder')), { target: { value: path } });
}
const createButton = () => screen.getByRole('button', { name: text('openChat') });
// One screen: the folder choices sit under the document fields, so there is no step to move to.
async function goToFolders(kind = 'free') { chooseKind(kind); }

beforeEach(() => {
  vi.mocked(fetchProjectLocations).mockResolvedValue([{ id: 'default', name: 'App projects', path: 'C:/TestRuntime/projects', builtIn: true }]);
  vi.mocked(isOpenDesignHostAvailable).mockReturnValue(false);
  vi.mocked(dirExists).mockResolvedValue(true);
  vi.mocked(openFolderDialog).mockResolvedValue(null);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

describe('new document project setup', () => {
  it('shows separate project and document names before choosing a document type', () => {
    setup();
    expect(screen.getByLabelText(text('projectName'))).toBeTruthy();
    expect(screen.getByLabelText(text('documentName'))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(text('documentName')), { target: { value: 'My named report' } });
    chooseKind('report'); choosePreset('technical');
    expect(screen.getByLabelText(text('documentName'))).toHaveValue('My named report');
  });
  it('names the first document independently and preserves the explicit name through folder selection', async () => {
    const { onConfirm } = setup(); chooseKind('report'); choosePreset('technical');
    expect((screen.getByLabelText(text('documentName')) as HTMLInputElement).value).toBe(text('preset.technical'));
    fireEvent.change(screen.getByLabelText(text('documentName')), { target: { value: 'Relazione B — metodo' } });
    chooseFolder('C:/Working'); chooseManaged();
    expect((screen.getByLabelText(text('documentName')) as HTMLInputElement).value).toBe('Relazione B — metodo');
    fireEvent.click(createButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0]![0].intent).toMatchObject({ documentName: 'Relazione B — metodo' });
  });
  it('says what goes in the empty working-folder field', async () => {
    setup(); await goToFolders();
    fireEvent.click(screen.getByRole('radio', { name: text('useFolder') }));
    expect(screen.getByLabelText(text('workingFolder')).getAttribute('placeholder')).toBe(text('workingFolderHint'));
  });
  it('shows the actual daemon-provided storage parent when app storage is selected', async () => {
    setup(); await goToFolders(); chooseManaged();
    expect(await screen.findByText('C:/TestRuntime/projects')).toBeTruthy();
    chooseFolder('C:/MyProject');
    expect(screen.queryByText('C:/TestRuntime/projects')).toBeNull();
  });
  it('distinguishes pending storage discovery from failure and retries discovery without losing input', async () => {
    let finishLocations!: (locations: Awaited<ReturnType<typeof fetchProjectLocations>>) => void;
    vi.mocked(fetchProjectLocations).mockImplementationOnce(() => new Promise((resolve) => { finishLocations = resolve; }));
    setup(); await goToFolders(); chooseManaged();
    expect(screen.getByText(text('storageLoading'))).toBeTruthy();
    expect(screen.queryByText(text('storageUnavailable'))).toBeNull();
    await act(async () => { finishLocations([]); });
    expect(screen.getByText(text('storageUnavailable'))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(text('extraFolders')), { target: { value: 'C:/Sources' } });
    fireEvent.click(screen.getByRole('button', { name: text('reloadStorage') }));
    expect(await screen.findByText('C:/TestRuntime/projects')).toBeTruthy();
    expect((screen.getByLabelText(text('extraFolders')) as HTMLTextAreaElement).value).toBe('C:/Sources');
  });
  // With the daemon down every request comes back 502; the dialog showed the check's own English sentence,
  // which says neither why nor what to do.
  it('says the app is not responding when the folder cannot be checked, and keeps the choices', async () => {
    vi.mocked(dirExists).mockRejectedValueOnce(new Error('Could not check the selected folder'));
    const { onConfirm } = setup(); await goToFolders(); chooseFolder('C:/Working');
    fireEvent.click(createButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(text('folderCheckFailed')));
    expect(onConfirm).not.toHaveBeenCalled();
    expect((screen.getByLabelText(text('workingFolder')) as HTMLInputElement).value).toBe('C:/Working');
    expect(createButton().hasAttribute('disabled')).toBe(false);
  });
  it('times out folder validation before creation and lets the same choices be checked again', async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(dirExists).mockImplementationOnce((_path, options) => {
      signals.push(options!.signal!); return new Promise(() => {});
    }).mockResolvedValueOnce(true);
    const { onConfirm } = setup(); await goToFolders(); chooseFolder('C:/Working');
    vi.useFakeTimers(); fireEvent.click(createButton());
    await act(async () => { await vi.advanceTimersByTimeAsync(LOCAL_REQUEST_TIMEOUT_MS); });
    expect(screen.getByRole('alert').textContent).toContain(text('validationTimeout'));
    expect(signals[0]!.aborted).toBe(true); expect(onConfirm).not.toHaveBeenCalled();
    expect((screen.getByLabelText(text('workingFolder')) as HTMLInputElement).value).toBe('C:/Working');
    const retry = screen.getByRole('button', { name: text('retryValidation') });
    expect(retry.hasAttribute('disabled')).toBe(false);
    await act(async () => { fireEvent.click(retry); });
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0]![0].workingDir).toBe('C:/Working');
  });
  it('explains a slow create and keeps observing one callback when the user continues waiting', async () => {
    let finish!: (value: boolean) => void;
    const onConfirm = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const { onCancel } = setup({ onConfirm }); await goToFolders(); chooseManaged();
    vi.useFakeTimers(); await act(async () => { fireEvent.click(createButton()); });
    await act(async () => { await vi.advanceTimersByTimeAsync(LOCAL_REQUEST_TIMEOUT_MS); });
    const continueWaiting = () => screen.getByRole('button', { name: en['projectCreation.continueWaiting'] });
    expect(continueWaiting().hasAttribute('disabled')).toBe(false);
    fireEvent.click(continueWaiting());
    await act(async () => { await vi.advanceTimersByTimeAsync(LOCAL_REQUEST_TIMEOUT_MS); });
    expect(continueWaiting()).toBeTruthy(); expect(onConfirm).toHaveBeenCalledOnce(); expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close' }).hasAttribute('disabled')).toBe(true);
    await act(async () => { finish(false); });
    expect(screen.getByRole('alert').textContent).toContain(wizard('createFailed'));
    expect(createButton().hasAttribute('disabled')).toBe(false);
  });
  it('requires a project name independently of the document type and preserves the typed name', async () => {
    const {onConfirm}=setup({initialProjectName:''});chooseKind();chooseManaged();
    expect(createButton().hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByRole('textbox',{name:'Project name'}),{target:{value:'  Antro — Test job  '}});
    fireEvent.click(createButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0]![0].projectName).toBe('Antro — Test job');
  });
  // The night run of 27 October still met two numbered screens before the chat; the team asked for the
  // agent to guide instead of a wizard, so name, document and folders are one screen with one button.
  it('asks for the document type and the destination on one screen, with no steps, before opening chat', async () => {
    const { onConfirm } = setup();
    expect(screen.queryByRole('list', { name: wizard('progress') })).toBeNull();
    expect(screen.queryByRole('button', { name: wizard('next') })).toBeNull();
    expect((screen.getByLabelText(text('kind')) as HTMLSelectElement).value).toBe('');
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByLabelText(text('purpose'))).toBeNull();
    expect(createButton().hasAttribute('disabled')).toBe(true);
    chooseManaged(); expect(createButton().hasAttribute('disabled')).toBe(true);
    fireEvent.click(createButton()); expect(onConfirm).not.toHaveBeenCalled(); expect(dirExists).not.toHaveBeenCalled();
    chooseKind(); expect(createButton().hasAttribute('disabled')).toBe(false);
    fireEvent.click(createButton()); await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0]![0].intent.imageIntakeConsent).toBe(false);
  });

  it.each([['report', 'technical'], ['tender-offer', 'methodology'], ['tender-form', 'official-form']])('requires a preset for %s', async (kind, preset) => {
    const { onConfirm } = setup(); chooseKind(kind); chooseManaged();
    expect(createButton().hasAttribute('disabled')).toBe(true); fireEvent.click(createButton()); expect(onConfirm).not.toHaveBeenCalled();
    choosePreset(preset); fireEvent.click(createButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0]![0]).toMatchObject({ workingDir: null, intent: { kind, subtype: text(`preset.${preset}`), purpose: 'Prepare the project report', imageIntakeConsent: false } });
  });

  it.each(['report', 'tender-offer', 'tender-form', 'other'])('requires a meaningful custom type for %s', async (kind) => {
    const { onConfirm } = setup(); chooseKind(kind); if (kind !== 'other') choosePreset('other'); chooseManaged();
    expect(createButton().hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText(text('customType')), { target: { value: '   ' } });
    expect(createButton().hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText(text('customType')), { target: { value: '  Structural condition study  ' } });
    fireEvent.click(createButton()); await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0]![0].intent).toMatchObject({ kind, subtype: 'Structural condition study' });
  });

  it('lets a free document open chat without a subtype or separate written purpose', async () => {
    const { onConfirm } = setup({ purpose: '' }); chooseKind(); chooseManaged();
    expect(screen.queryByLabelText(text('preset'))).toBeNull(); expect(screen.queryByLabelText(text('customType'))).toBeNull();
    expect(screen.queryByLabelText(text('purpose'))).toBeNull(); expect(createButton().hasAttribute('disabled')).toBe(false);
    fireEvent.click(createButton()); await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0]![0].intent).toMatchObject({ kind: 'free', subtype: '', imageIntakeConsent: false });
    expect(onConfirm.mock.calls[0]![0].intent.purpose.trim().length).toBeGreaterThan(0);
  });

  it('requires a fresh preset after changing category', () => {
    setup(); chooseManaged(); chooseKind('report'); choosePreset('technical'); expect(createButton().hasAttribute('disabled')).toBe(false);
    chooseKind('tender-offer'); expect((screen.getByLabelText(text('preset')) as HTMLSelectElement).value).toBe('');
    expect(createButton().hasAttribute('disabled')).toBe(true);
  });

  it('forwards the actual working directory separately from trimmed, deduplicated context folders', async () => {
    const { onConfirm } = setup(); await goToFolders(); chooseFolder(' C:\\Projects\\Report ');
    fireEvent.change(screen.getByLabelText(text('extraFolders')), { target: { value: ' C:\\References\\Tender \n\nC:\\References\\Photos\nC:\\References\\Tender' } });
    fireEvent.click(createButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0]![0]).toMatchObject({ workingDir: 'C:\\Projects\\Report', intent: { kind: 'free', subtype: '', purpose: 'Prepare the project report', contextRoots: ['C:\\References\\Tender', 'C:\\References\\Photos'], imageIntakeConsent: false } });
    expect(new Set(vi.mocked(dirExists).mock.calls.map(([path]) => path))).toEqual(new Set(['C:\\References\\Tender', 'C:\\References\\Photos', 'C:\\Projects\\Report']));
  });

  it('preserves explicitly preselected folders without choosing a document type on the user’s behalf', async () => {
    const { onConfirm } = setup({ initialFolder: 'C:\\Projects\\Existing', initialContextRoots: ['C:\\References\\Previous'] });
    expect((screen.getByLabelText(text('kind')) as HTMLSelectElement).value).toBe('');
    expect(createButton().hasAttribute('disabled')).toBe(true);
    await goToFolders();
    expect((screen.getByRole('radio', { name: text('useFolder') }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(text('workingFolder')) as HTMLInputElement).value).toBe('C:\\Projects\\Existing');
    fireEvent.click(createButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0]![0]).toMatchObject({ workingDir: 'C:\\Projects\\Existing', intent: { contextRoots: ['C:\\References\\Previous'] } });
  });

  it('retains the native grant for an unchanged preselected working folder', async () => {
    const { onConfirm } = setup({ initialFolder: 'C:\\Projects\\Granted', initialWorkingDirToken: 'preselected-native-grant' });
    await goToFolders(); fireEvent.click(createButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0]![0]).toMatchObject({ workingDir: 'C:\\Projects\\Granted', workingDirToken: 'preselected-native-grant' });
  });

  it('preserves an existing brief and defers preparation and image permission to chat', async () => {
    const { onConfirm } = setup({ purpose: '  Explain the recorded survey findings  ' }); chooseKind('report'); choosePreset('survey');
    chooseManaged(); expect(screen.queryByRole('checkbox')).toBeNull(); fireEvent.click(createButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0]![0].intent).toMatchObject({ purpose: 'Explain the recorded survey findings', imageIntakeConsent: false });
  });

  it('uses the native working-directory grant and keeps context picks separate', async () => {
    vi.mocked(isOpenDesignHostAvailable).mockReturnValue(true);
    vi.mocked(pickHostWorkingDir).mockResolvedValue({ ok: true, baseDir: 'C:\\Projects\\Granted', token: 'native-working-grant' });
    vi.mocked(openFolderDialog).mockResolvedValue('C:\\References\\Documents');
    const { onConfirm } = setup(); await goToFolders(); chooseFolder('');
    fireEvent.click(screen.getByRole('button', { name: text('browse') }));
    await waitFor(() => expect((screen.getByLabelText(text('workingFolder')) as HTMLInputElement).value).toBe('C:\\Projects\\Granted'));
    fireEvent.click(screen.getByRole('button', { name: text('addContextFolder') }));
    await waitFor(() => expect((screen.getByLabelText(text('extraFolders')) as HTMLTextAreaElement).value).toBe('C:\\References\\Documents'));
    fireEvent.click(createButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(pickHostWorkingDir).toHaveBeenCalledOnce(); expect(openFolderDialog).toHaveBeenCalledWith({ throwOnError: true });
    expect(onConfirm.mock.calls[0]![0]).toMatchObject({ workingDir: 'C:\\Projects\\Granted', workingDirToken: 'native-working-grant', intent: { contextRoots: ['C:\\References\\Documents'] } });
  });

  it('clears a native grant when the working-directory path is edited', async () => {
    vi.mocked(isOpenDesignHostAvailable).mockReturnValue(true);
    vi.mocked(pickHostWorkingDir).mockResolvedValue({ ok: true, baseDir: 'C:\\Granted', token: 'grant-for-old-path' });
    const { onConfirm } = setup(); await goToFolders(); chooseFolder('');
    fireEvent.click(screen.getByRole('button', { name: text('browse') }));
    await waitFor(() => expect((screen.getByLabelText(text('workingFolder')) as HTMLInputElement).value).toBe('C:\\Granted'));
    fireEvent.change(screen.getByLabelText(text('workingFolder')), { target: { value: 'C:\\Another' } });
    fireEvent.click(createButton()); await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0]![0]).not.toHaveProperty('workingDirToken');
    expect(onConfirm.mock.calls[0]![0].workingDir).toBe('C:\\Another');
  });

  it('uses the browser folder picker when no native host is available', async () => {
    vi.mocked(openFolderDialog).mockResolvedValue('C:\\Projects\\Browser');
    setup(); await goToFolders(); chooseFolder(''); fireEvent.click(screen.getByRole('button', { name: text('browse') }));
    await waitFor(() => expect((screen.getByLabelText(text('workingFolder')) as HTMLInputElement).value).toBe('C:\\Projects\\Browser'));
    expect(pickHostWorkingDir).not.toHaveBeenCalled();
  });

  it('keeps canceled native picks unchanged and never opens a second picker', async () => {
    vi.mocked(isOpenDesignHostAvailable).mockReturnValue(true);
    vi.mocked(pickHostWorkingDir).mockResolvedValue({ ok: false, canceled: true });
    setup({ initialFolder: 'C:\\Original' }); await goToFolders(); fireEvent.click(screen.getByRole('button', { name: text('browse') }));
    await waitFor(() => expect(pickHostWorkingDir).toHaveBeenCalledOnce());
    expect((screen.getByLabelText(text('workingFolder')) as HTMLInputElement).value).toBe('C:\\Original');
    expect(screen.queryByRole('alert')).toBeNull(); expect(openFolderDialog).not.toHaveBeenCalled();
  });

  it('surfaces a failed native pick without falling back to a path lacking a grant', async () => {
    vi.mocked(isOpenDesignHostAvailable).mockReturnValue(true);
    vi.mocked(pickHostWorkingDir).mockResolvedValue({ ok: false, reason: 'Native picker unavailable' });
    const { onConfirm } = setup(); await goToFolders(); chooseFolder(''); fireEvent.click(screen.getByRole('button', { name: text('browse') }));
    expect((await screen.findByRole('alert')).textContent).toContain('Native picker unavailable');
    expect(openFolderDialog).not.toHaveBeenCalled(); expect(onConfirm).not.toHaveBeenCalled();
  });

  it('recovers after an unavailable folder without losing the selected document or purpose', async () => {
    vi.mocked(dirExists).mockResolvedValueOnce(false).mockResolvedValue(true);
    const { onConfirm } = setup(); await goToFolders(); chooseFolder('C:\\Missing'); fireEvent.click(createButton());
    expect((await screen.findByRole('alert')).textContent).toContain('C:\\Missing'); expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(text('workingFolder')), { target: { value: 'C:\\Valid' } });
    fireEvent.click(createButton()); await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onConfirm.mock.calls[0]![0]).toMatchObject({ workingDir: 'C:\\Valid', intent: { kind: 'free', purpose: 'Prepare the project report' } });
  });

  it('requires an actual path when the user chooses a working folder', async () => {
    const { onConfirm } = setup(); await goToFolders(); chooseFolder('   '); expect(createButton().hasAttribute('disabled')).toBe(true); fireEvent.click(createButton());
    expect(screen.queryByRole('checkbox', { name: text('intakeConsent') })).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled(); expect(dirExists).not.toHaveBeenCalled();
  });

  it('lets the user remove an unavailable additional root before retrying', async () => {
    vi.mocked(dirExists).mockImplementation(async (path) => path !== 'C:\\UnavailableContext');
    const { onConfirm } = setup(); await goToFolders(); chooseFolder('C:\\ValidDestination');
    fireEvent.change(screen.getByLabelText(text('extraFolders')), { target: { value: 'C:\\UnavailableContext' } });
    fireEvent.click(createButton());
    expect((await screen.findByRole('alert')).textContent).toContain('C:\\UnavailableContext');
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(text('extraFolders')), { target: { value: '' } });
    fireEvent.click(createButton()); await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0]![0]).toMatchObject({ workingDir: 'C:\\ValidDestination', intent: { contextRoots: [] } });
  });

  it('allows retry after a browser-picker error and preserves an existing folder', async () => {
    vi.mocked(openFolderDialog).mockRejectedValueOnce(new Error('Picker failed')).mockResolvedValueOnce('C:\\Recovered');
    setup({ initialFolder: 'C:\\Original' }); await goToFolders();
    fireEvent.click(screen.getByRole('button', { name: text('browse') }));
    expect((await screen.findByRole('alert')).textContent).toContain('Picker failed');
    expect((screen.getByLabelText(text('workingFolder')) as HTMLInputElement).value).toBe('C:\\Original');
    fireEvent.click(screen.getByRole('button', { name: text('browse') }));
    await waitFor(() => expect((screen.getByLabelText(text('workingFolder')) as HTMLInputElement).value).toBe('C:\\Recovered'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('locks destination choices during validation and opens chat only after success', async () => {
    let finishCheck!: (value: boolean) => void;
    vi.mocked(dirExists).mockImplementationOnce(() => new Promise((resolve) => { finishCheck = resolve; }));
    const { onConfirm } = setup(); await goToFolders(); chooseFolder('C:\\Working'); fireEvent.click(createButton());
    expect((screen.getByRole('radio', { name: text('useFolder') }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: text('managed') }) as HTMLInputElement).disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled(); await act(async () => { finishCheck(true); });
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce()); expect(onConfirm.mock.calls[0]![0].workingDir).toBe('C:\\Working');
  });

  it('keeps preset, folders and a native grant together on the one screen', async () => {
    const { onConfirm } = setup({ initialFolder: 'C:\\SurveyReport', initialWorkingDirToken: 'survey-grant' }); chooseKind('report'); choosePreset('survey');
    fireEvent.change(screen.getByLabelText(text('extraFolders')), { target: { value: 'C:\\SurveySources' } });
    expect((screen.getByLabelText(text('kind')) as HTMLSelectElement).value).toBe('report');
    expect((screen.getByLabelText(text('preset')) as HTMLSelectElement).value).toBe('survey');
    expect((screen.getByLabelText(text('workingFolder')) as HTMLInputElement).value).toBe('C:\\SurveyReport');
    expect((screen.getByLabelText(text('extraFolders')) as HTMLTextAreaElement).value).toBe('C:\\SurveySources');
    expect(onConfirm).not.toHaveBeenCalled(); fireEvent.click(createButton()); await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0]![0]).toMatchObject({ workingDirToken: 'survey-grant', intent: { kind: 'report', subtype: text('preset.survey'), contextRoots: ['C:\\SurveySources'] } });
  });

  it('keeps the folder screen when creation returns false and retries with the same choices', async () => {
    const onConfirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { onCancel } = setup({ onConfirm }); await goToFolders(); chooseFolder('C:\\ChosenWorkingFolder');
    fireEvent.change(screen.getByLabelText(text('extraFolders')), { target: { value: 'C:\\ChosenReference' } }); fireEvent.click(createButton());
    expect((await screen.findByRole('alert')).textContent).toContain(wizard('createFailed'));
    expect((screen.getByLabelText(text('workingFolder')) as HTMLInputElement).value).toBe('C:\\ChosenWorkingFolder'); expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(createButton()); await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
    expect(onConfirm.mock.calls[1]![0]).toEqual(onConfirm.mock.calls[0]![0]); await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('waits for async creation and prevents duplicate final submissions', async () => {
    let finishCreate!: (value: boolean) => void;
    const onConfirm = vi.fn(() => new Promise<boolean>((resolve) => { finishCreate = resolve; }));
    setup({ onConfirm }); await goToFolders(); chooseManaged();
    const button = createButton(); fireEvent.click(button);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(button.hasAttribute('disabled')).toBe(true);
    expect((screen.getByLabelText(text('extraFolders')) as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: en['common.cancel'] }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(button); expect(onConfirm).toHaveBeenCalledOnce();
    await act(async () => { finishCreate(false); });
    expect(screen.getByRole('alert').textContent).toContain(wizard('createFailed'));
    expect(createButton().hasAttribute('disabled')).toBe(false);
  });

  it('shows a rejected async create as a recoverable error on the same final step', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('Could not create the project'));
    setup({ onConfirm }); await goToFolders(); chooseManaged(); fireEvent.click(createButton());
    expect((await screen.findByRole('alert')).textContent).toContain('Could not create the project');
    expect(screen.getByLabelText(text('projectName'))).toBeTruthy();
    expect(createButton().hasAttribute('disabled')).toBe(false);
  });

  it('allows cancellation without creating a project or beginning intake', () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCancel).toHaveBeenCalledOnce(); expect(onConfirm).not.toHaveBeenCalled(); expect(dirExists).not.toHaveBeenCalled();
  });
});
