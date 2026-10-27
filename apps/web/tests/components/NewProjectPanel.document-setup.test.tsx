// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewProjectPanel } from '../../src/components/NewProjectPanel';
import { I18nProvider } from '../../src/i18n';
import { en } from '../../src/i18n/locales/en';
import { dirExists } from '../../src/providers/registry';

vi.mock('../../src/providers/registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/providers/registry')>(),
  dirExists: vi.fn(), openFolderDialog: vi.fn(),
}));
const text = (key: string) => en[`documentStart.${key}` as keyof typeof en];
// The dialog is one screen: naming the project is all that stands between the document fields and the folders.
async function nameProject(dialog: ReturnType<typeof within>) {
  const projectName=dialog.getByRole('textbox',{name:text('projectName')}) as HTMLInputElement;
  if(!projectName.value)fireEvent.change(projectName,{target:{value:'Survey project'}});
  await dialog.findByRole('radio', { name: text('managed') });
}
class ResizeObserverMock { observe() {} disconnect() {} unobserve() {} }
function setup() {
  const onCreate = vi.fn();
  render(<I18nProvider initial="en"><NewProjectPanel initialTab="other" skills={[]} designSystems={[]} defaultDesignSystemId={null} templates={[]} onDeleteTemplate={vi.fn()} promptTemplates={[]} onCreate={onCreate} /></I18nProvider>);
  return onCreate;
}
beforeEach(() => { vi.mocked(dirExists).mockResolvedValue(true); vi.stubGlobal('ResizeObserver', ResizeObserverMock); });
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe('New Project document setup', () => {
  it('requires the document-start dialog before creating a free document in managed storage', async () => {
    const onCreate = setup();
    fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: 'Project experience collection' } });
    fireEvent.click(screen.getByTestId('create-project'));
    expect(onCreate).not.toHaveBeenCalled();
    const dialog = within(await screen.findByRole('dialog', { name: text('title') }));
    expect((dialog.getByLabelText(text('kind')) as HTMLSelectElement).value).toBe('');
    fireEvent.change(dialog.getByLabelText(text('kind')), { target: { value: 'free' } });
    await nameProject(dialog);
    fireEvent.click(dialog.getByRole('radio', { name: text('managed') }));
    fireEvent.click(dialog.getByRole('button', { name: text('openChat') }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    const created = onCreate.mock.calls[0]![0];
    expect(created).toMatchObject({ name:'Project experience collection', metadata: { nameSource:'user',kind: 'other', intent: 'document', linkedDirs: [], documentSetupIntent: { kind: 'free', subtype: '', purpose: 'Project experience collection', contextRoots: [], imageIntakeConsent: false } } });
    expect(created.metadata).not.toHaveProperty('userWorkingDir');
    expect(created).not.toHaveProperty('userWorkingDirToken');
  });

  it('forwards an explicit working folder and additional sources without promoting sources to the destination', async () => {
    const onCreate = setup(); fireEvent.click(screen.getByTestId('create-project'));
    const dialog = within(await screen.findByRole('dialog', { name: text('title') }));
    fireEvent.change(dialog.getByLabelText(text('kind')), { target: { value: 'report' } });
    fireEvent.change(dialog.getByLabelText(text('preset')), { target: { value: 'survey' } });
    await nameProject(dialog);
    fireEvent.click(dialog.getByRole('radio', { name: text('useFolder') }));
    fireEvent.change(dialog.getByLabelText(text('workingFolder')), { target: { value: 'C:\\Projects\\SurveyReport' } });
    fireEvent.change(dialog.getByLabelText(text('extraFolders')), { target: { value: 'C:\\References\\PreviousReport\nC:\\References\\Photos' } });
    fireEvent.click(dialog.getByRole('button', { name: text('openChat') }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ metadata: { userWorkingDir: 'C:\\Projects\\SurveyReport', linkedDirs: ['C:\\References\\PreviousReport', 'C:\\References\\Photos'], documentSetupIntent: { kind: 'report', subtype: text('preset.survey'), contextRoots: ['C:\\References\\PreviousReport', 'C:\\References\\Photos'], imageIntakeConsent: false } } });
  });

  it('returns to the existing project form on cancellation without creating a project', async () => {
    const onCreate = setup();
    fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: 'Keep this project name' } });
    fireEvent.click(screen.getByTestId('create-project'));
    const dialog = within(await screen.findByRole('dialog', { name: text('title') }));
    fireEvent.click(dialog.getByRole('button', { name: 'Close' }));
    expect(onCreate).not.toHaveBeenCalled();
    expect((screen.getByTestId('new-project-name') as HTMLInputElement).value).toBe('Keep this project name');
    expect(screen.queryByRole('dialog', { name: text('title') })).toBeNull();
  });
});
