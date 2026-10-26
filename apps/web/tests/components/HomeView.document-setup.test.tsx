// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isOpenDesignHostAvailable, pickHostWorkingDir } from '@open-design/host';
import { HomeView } from '../../src/components/HomeView';
import { I18nProvider } from '../../src/i18n';
import { en } from '../../src/i18n/locales/en';
import { dirExists, openFolderDialog } from '../../src/providers/registry';
import { clearHomeComposerAttachments, stashHomeComposerAttachments } from '../../src/state/home-composer-stash';
import { writeHomeGuideStage } from '../../src/components/home-hero/firstRunGuide';
import { homeHeroPromptText, setHomeHeroPrompt } from '../helpers/home-hero-lexical';

vi.mock('../../src/components/home-hero/PlaceholderCarousel', () => ({ PlaceholderCarousel: () => null }));
vi.mock('../../src/collab/useWorkspaceContext', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/collab/useWorkspaceContext')>(),
  useWorkspaceContext: () => ({ context: null, loading: false, failure: 'unsupported' as const }),
}));
vi.mock('@open-design/host', async (importOriginal) => ({
  ...await importOriginal<typeof import('@open-design/host')>(),
  isOpenDesignHostAvailable: vi.fn(), pickHostWorkingDir: vi.fn(),
}));
vi.mock('../../src/providers/registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/providers/registry')>(),
  dirExists: vi.fn(), openFolderDialog: vi.fn(), fetchProjectFiles: vi.fn().mockResolvedValue([]),
}));
const text = (key: string) => en[`documentStart.${key}` as keyof typeof en];
const entryText = (key: string) => en[`documentEntry.${key}` as keyof typeof en];
const wizardText = (key: string) => en[`documentWizard.${key}` as keyof typeof en];
async function nextToFolders(dialog: ReturnType<typeof within>) {
  const projectName=dialog.getByRole('textbox',{name:text('projectName')}) as HTMLInputElement;
  if(!projectName.value) fireEvent.change(projectName,{target:{value:'Antro — Test job'}});
  fireEvent.click(dialog.getByRole('button', { name: wizardText('next') })); await dialog.findByRole('radio', { name: text('managed') });
}
function setup(props: Partial<React.ComponentProps<typeof HomeView>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(true);
  render(<I18nProvider initial="en"><HomeView projects={[]} onSubmit={onSubmit} onOpenProject={() => undefined} {...props} /></I18nProvider>);
  return onSubmit;
}
async function showOtherCreations() {
  const choice = screen.queryByTestId('home-other-creations'); if (choice) fireEvent.click(choice);
  await screen.findByTestId('home-hero-input');
}
async function start(prompt = 'Prepare a tender offer about our project experience') {
  await showOtherCreations(); setHomeHeroPrompt(prompt);
  fireEvent.click(screen.getByTestId('home-hero-submit'));
  return within(await screen.findByRole('dialog', { name: text('title') }));
}
beforeEach(() => {
  localStorage.clear(); writeHomeGuideStage('done');
  vi.mocked(isOpenDesignHostAvailable).mockReturnValue(false);
  vi.mocked(dirExists).mockResolvedValue(true); vi.mocked(openFolderDialog).mockResolvedValue(null);
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    if (url === '/api/plugins') return new Response(JSON.stringify({ plugins: [] }), { headers: { 'content-type': 'application/json' } });
    throw new Error(`Unexpected fetch ${url}`);
  }));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); clearHomeComposerAttachments(); localStorage.clear(); });

describe('Home document-project creation', () => {
  it('keeps the folder step after async creation fails, then retries without duplicate submits', async () => {
    let finish!: (accepted: boolean) => void;
    const onSubmit = vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; })).mockResolvedValueOnce(true);
    setup({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: entryText('newProject') }));
    const dialog = within(await screen.findByRole('dialog', { name: text('title') }));
    fireEvent.change(dialog.getByLabelText(text('kind')), { target: { value: 'report' } });
    fireEvent.change(dialog.getByLabelText(text('preset')), { target: { value: 'survey' } });
    await nextToFolders(dialog);
    fireEvent.click(dialog.getByRole('radio', { name: text('useFolder') }));
    fireEvent.change(dialog.getByLabelText(text('workingFolder')), { target: { value: 'C:\SurveyProject' } });
    fireEvent.change(dialog.getByLabelText(text('extraFolders')), { target: { value: 'C:\ReferenceDocuments' } });
    fireEvent.click(dialog.getByRole('button', { name: text('openChat') }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const pending = dialog.getByRole('button', { name: en['common.loading'] });
    expect(pending.hasAttribute('disabled')).toBe(true); fireEvent.click(pending); expect(onSubmit).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog', { name: text('title') })).toBeTruthy();
    await act(async () => { finish(false); });
    expect((await dialog.findByRole('alert')).textContent).toContain(wizardText('createFailed'));
    expect((dialog.getByLabelText(text('workingFolder')) as HTMLInputElement).value).toBe('C:\SurveyProject');
    expect((dialog.getByLabelText(text('extraFolders')) as HTMLTextAreaElement).value).toBe('C:\ReferenceDocuments');
    fireEvent.click(dialog.getByRole('button', { name: wizardText('back') }));
    expect((dialog.getByLabelText(text('kind')) as HTMLSelectElement).value).toBe('report');
    expect((dialog.getByLabelText(text('preset')) as HTMLSelectElement).value).toBe('survey');
    await nextToFolders(dialog); fireEvent.click(dialog.getByRole('button', { name: text('openChat') }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]![0]).toEqual(onSubmit.mock.calls[0]![0]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: text('title') })).toBeNull());
  });

  it('retains the folder choices when creation rejects instead of accepting', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Create service unavailable')); setup({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: entryText('newProject') }));
    const dialog = within(await screen.findByRole('dialog', { name: text('title') }));
    fireEvent.change(dialog.getByLabelText(text('kind')), { target: { value: 'free' } });
    await nextToFolders(dialog); fireEvent.click(dialog.getByRole('radio', { name: text('managed') }));
    fireEvent.click(dialog.getByRole('button', { name: text('openChat') }));
    expect((await dialog.findByRole('alert')).textContent).toContain(wizardText('createFailed'));
    expect(dialog.getByRole('button', { name: text('openChat') }).hasAttribute('disabled')).toBe(false);
    expect((dialog.getByRole('radio', { name: text('managed') }) as HTMLInputElement).checked).toBe(true); expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('shows New project and Open existing before the generic composer on first open', () => {
    const onSubmit = setup(), entry = within(screen.getByTestId('document-project-entry'));
    expect(entry.getByRole('button', { name: entryText('newProject') })).toBeTruthy();
    expect(entry.getByRole('button', { name: entryText('existingProject') })).toBeTruthy();
    expect(screen.queryByTestId('home-hero-input')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled(); expect(dirExists).not.toHaveBeenCalled();
  });

  it('opens a new document chat after only type and folder selection with intake awaiting later consent', async () => {
    const onSubmit = setup(); fireEvent.click(screen.getByRole('button', { name: entryText('newProject') }));
    const dialog = within(await screen.findByRole('dialog', { name: text('title') }));
    expect(screen.queryByTestId('home-hero-input')).toBeNull(); expect(dialog.queryByLabelText(text('purpose'))).toBeNull();
    fireEvent.change(dialog.getByLabelText(text('kind')), { target: { value: 'free' } });
    await nextToFolders(dialog); expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('radio', { name: text('managed') }));
    expect(dialog.queryByRole('checkbox')).toBeNull(); expect(onSubmit).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    fireEvent.click(dialog.getByRole('button', { name: text('openChat') }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ projectName:'Antro — Test job', conversationMode: 'blockout', projectMetadata: { intent: 'document', documentSetupIntent: { kind: 'free', imageIntakeConsent: false } } });
    expect(onSubmit.mock.calls[0]![0].prompt.trim().length).toBeGreaterThan(0);
  });

  it('opens existing-project selection without creating a project or entering the generic composer', () => {
    const onOpenExistingProjects = vi.fn(), onSubmit = setup({ onOpenExistingProjects });
    fireEvent.click(screen.getByRole('button', { name: entryText('existingProject') }));
    expect(onOpenExistingProjects).toHaveBeenCalledOnce(); expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByTestId('home-hero-input')).toBeNull();
  });

  it('returns to the project entry when new-project setup is canceled', async () => {
    const onSubmit = setup(); fireEvent.click(screen.getByRole('button', { name: entryText('newProject') }));
    const dialog = within(await screen.findByRole('dialog', { name: text('title') }));
    fireEvent.click(dialog.getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('document-project-entry')).toBeTruthy(); expect(screen.queryByTestId('home-hero-input')).toBeNull(); expect(onSubmit).not.toHaveBeenCalled();
  });

  it('forwards the existing brief, selected preset, destination and additional context', async () => {
    const onSubmit = setup(), prompt = 'Present selected structural survey experience in six pages', dialog = await start(prompt);
    expect(onSubmit).not.toHaveBeenCalled(); expect((dialog.getByLabelText(text('kind')) as HTMLSelectElement).value).toBe('');
    fireEvent.change(dialog.getByLabelText(text('kind')), { target: { value: 'tender-offer' } });
    fireEvent.change(dialog.getByLabelText(text('preset')), { target: { value: 'experience' } });
    await nextToFolders(dialog); fireEvent.click(dialog.getByRole('radio', { name: text('useFolder') }));
    fireEvent.change(dialog.getByLabelText(text('workingFolder')), { target: { value: 'C:\Projects\Offer' } });
    fireEvent.change(dialog.getByLabelText(text('extraFolders')), { target: { value: 'C:\References\Disciplinare' } });
    fireEvent.click(dialog.getByRole('button', { name: text('openChat') })); await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ prompt, pluginId: null, projectKind: 'other', conversationMode: 'blockout', workingDir: 'C:\Projects\Offer', linkedDirs: ['C:\References\Disciplinare'], projectMetadata: expect.objectContaining({ intent: 'document', documentSetupIntent: expect.objectContaining({ kind: 'tender-offer', subtype: text('preset.experience'), purpose: prompt, contextRoots: ['C:\References\Disciplinare'], imageIntakeConsent: false }) }) }));
  });

  it('keeps the Home draft and attachments when setup is canceled and later resumed', async () => {
    const file = new File(['source'], 'project-brief.pdf', { type: 'application/pdf' }); stashHomeComposerAttachments([file]);
    const onSubmit = setup(), prompt = 'My report brief must survive cancel', dialog = await start(prompt);
    fireEvent.click(dialog.getByRole('button', { name: 'Close' })); expect(onSubmit).not.toHaveBeenCalled();
    expect(homeHeroPromptText()).toBe(prompt); expect(screen.getByTestId('home-hero-staged-files').textContent).toContain('project-brief.pdf');
    fireEvent.click(screen.getByTestId('home-hero-submit'));
    const reopened = within(await screen.findByRole('dialog', { name: text('title') }));
    fireEvent.change(reopened.getByLabelText(text('kind')), { target: { value: 'free' } });
    await nextToFolders(reopened); fireEvent.click(reopened.getByRole('radio', { name: text('managed') }));
    fireEvent.click(reopened.getByRole('button', { name: text('openChat') })); await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ prompt, attachments: [file], projectMetadata: { documentSetupIntent: { purpose: prompt, imageIntakeConsent: false } } });
  });

  it('clears a prior native path and grant when managed storage is explicitly chosen', async () => {
    vi.mocked(isOpenDesignHostAvailable).mockReturnValue(true); vi.mocked(pickHostWorkingDir).mockResolvedValue({ ok: true, baseDir: 'C:\PriorWorkingFolder', token: 'prior-native-grant' });
    const onSubmit = setup(); await showOtherCreations(); fireEvent.click(screen.getByTestId('working-dir-trigger')); fireEvent.click(screen.getByTestId('working-dir-pick'));
    await waitFor(() => expect(pickHostWorkingDir).toHaveBeenCalledOnce()); const dialog = await start('A free project report');
    fireEvent.change(dialog.getByLabelText(text('kind')), { target: { value: 'free' } }); await nextToFolders(dialog);
    expect((dialog.getByLabelText(text('workingFolder')) as HTMLInputElement).value).toBe('C:\PriorWorkingFolder');
    fireEvent.click(dialog.getByRole('radio', { name: text('managed') })); fireEvent.click(dialog.getByRole('button', { name: text('openChat') }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce()); expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('workingDir'); expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('workingDirToken');
  });

  it('preserves a preselected native grant when the working folder remains unchanged', async () => {
    vi.mocked(isOpenDesignHostAvailable).mockReturnValue(true); vi.mocked(pickHostWorkingDir).mockResolvedValue({ ok: true, baseDir: 'C:\GrantedWorkingFolder', token: 'native-grant' });
    const onSubmit = setup(); await showOtherCreations(); fireEvent.click(screen.getByTestId('working-dir-trigger')); fireEvent.click(screen.getByTestId('working-dir-pick'));
    await waitFor(() => expect(pickHostWorkingDir).toHaveBeenCalledOnce()); const dialog = await start('A report for this working folder');
    fireEvent.change(dialog.getByLabelText(text('kind')), { target: { value: 'free' } }); await nextToFolders(dialog);
    fireEvent.click(dialog.getByRole('button', { name: text('openChat') })); await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ workingDir: 'C:\GrantedWorkingFolder', workingDirToken: 'native-grant' });
  });
});


describe('Fast project creation entry', () => {
  it('starts one direct managed session with optional files and no guided document setup', async () => {
    const onSubmit = setup();
    fireEvent.click(screen.getByRole('button', { name: en['fastProject.title'] }));
    const dialog = within(await screen.findByRole('dialog', { name: en['fastProject.title'] }));
    const file = new File(['Prepared package'], 'package.zip', { type: 'application/zip' });
    fireEvent.change(dialog.getByLabelText(text('projectName')), { target: { value: 'Antro — Materiali grafici' } });
    fireEvent.change(dialog.getByLabelText(en['fastProject.files']), { target: { files: [file] } });
    fireEvent.change(dialog.getByLabelText(en['fastProject.goal']), { target: { value: 'Make a project sheet from this package' } });
    expect(dialog.queryByLabelText(text('kind'))).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: en['fastProject.create'] }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const payload = onSubmit.mock.calls[0]![0];
    expect(payload).toMatchObject({ projectName: 'Antro — Materiali grafici', prompt: 'Make a project sheet from this package', projectKind: 'other', projectMetadata: { kind: 'other', projectMode: 'fast' }, conversationMode: 'design', pluginId: null, skillId: null });
    expect(payload.attachments).toEqual([file]); expect(payload.projectMetadata.documentSetupIntent).toBeUndefined();
    expect(payload.workingDir).toBeUndefined();
  });
  it('contains keyboard focus and restores the entry button when cancelled with Escape', async () => {
    setup(); const entry = screen.getByRole('button', { name: en['fastProject.title'] }); entry.focus(); fireEvent.click(entry);
    const modal = await screen.findByRole('dialog', { name: en['fastProject.title'] }), dialog = within(modal);
    expect(document.activeElement).toBe(dialog.getByLabelText(text('projectName')));
    const close = dialog.getByRole('button', { name: 'Close' }), create = dialog.getByRole('button', { name: en['fastProject.create'] });
    create.focus(); fireEvent.keyDown(document, { key: 'Tab' }); expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(create);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: en['fastProject.title'] })).toBeNull());
    expect(document.activeElement).toBe(entry);
  });
  it('allows a material-free start and retains the dialog and request after a failed create', async () => {
    const onSubmit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true); setup({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: en['fastProject.title'] }));
    const dialog = within(await screen.findByRole('dialog', { name: en['fastProject.title'] }));
    fireEvent.click(dialog.getByRole('button', { name: en['fastProject.create'] }));
    await dialog.findByRole('alert');
    expect(onSubmit.mock.calls[0]![0].prompt).toBe(en['fastProject.startPrompt']);
    expect(onSubmit.mock.calls[0]![0].attachments).toEqual([]);
    fireEvent.click(dialog.getByRole('button', { name: en['fastProject.create'] }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: en['fastProject.title'] })).toBeNull());
  });
});
