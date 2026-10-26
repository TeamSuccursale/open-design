// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentProjectContext } from '@open-design/contracts';
import { ProjectContextActions } from '../../../src/components/chat/ProjectContextActions';
import { checkProjectContext, projectContextReferences } from '../../../src/providers/project-context-actions';
import { I18nProvider } from '../../../src/i18n';

const picker = vi.hoisted(() => ({ selections: [] as { project: { id: string; name: string }; resolvedDir: string }[] }));
vi.mock('../../../src/providers/project-context-actions', () => ({
  checkProjectContext: vi.fn(), projectContextReferences: vi.fn(), DOCUMENT_CONTEXT_UPDATED_EVENT: 'test:document-context-updated',
}));
vi.mock('../../../src/components/chat/DocumentResearchStatus', () => ({ DocumentResearchStatus: () => null }));
vi.mock('../../../src/components/ProjectReferenceModal', () => ({
  ProjectReferenceModal: ({ onSelect, onClose, currentProjectId }: { onSelect: (items: unknown[]) => void; onClose: () => void; currentProjectId: string }) => <div role="dialog" aria-label="Project picker" data-project={currentProjectId}>
    <button onClick={() => onSelect(picker.selections)}>Use selected projects</button><button onClick={onClose}>Cancel picker</button>
  </div>,
}));
const saved = (id: string): DocumentProjectContext => ({ projectId: id, name: `Project ${id}`, workingDirectory: `C:\\${id}` });
let rows: DocumentProjectContext[];
const writes = () => vi.mocked(projectContextReferences).mock.calls.filter((call) => call[2] !== undefined);
function view(projectId = 'current') {
  return <I18nProvider initial="en"><textarea aria-label="Chat draft" /><ProjectContextActions projectId={projectId} /></I18nProvider>;
}
beforeEach(() => {
  rows = [saved('one')]; picker.selections = [{ project: { id: 'two', name: 'Project two' }, resolvedDir: 'C:\\Untrusted-picker-path' }];
  vi.mocked(projectContextReferences).mockImplementation(async (_id, _context, ids) => {
    if (ids) rows = ids.map(saved);
    return rows;
  });
  vi.mocked(checkProjectContext).mockResolvedValue(null);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('persistent project references beside chat', () => {
  it('adds and removes saved project references without adding paths, sending a chat draft or starting a scan', async () => {
    render(view()); await screen.findByText('Project one');
    const draft = screen.getByRole('textbox', { name: 'Chat draft' }) as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: 'My page instructions' } });
    expect(writes()).toHaveLength(0); expect(checkProjectContext).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Consult another project' }));
    expect(screen.getByRole('dialog').getAttribute('data-project')).toBe('current');
    fireEvent.click(screen.getByRole('button', { name: 'Use selected projects' }));
    await screen.findByText('Project two');
    expect(writes()[0]?.[2]).toEqual(['one', 'two']);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Project one from context' }));
    await waitFor(() => expect(screen.queryByText('Project one')).toBeNull());
    expect(writes()[1]?.[2]).toEqual(['two']);
    expect(draft.value).toBe('My page instructions'); expect(draft.disabled).toBe(false);
    expect(checkProjectContext).not.toHaveBeenCalled();
  });

  it('keeps the previous selection on failed save and retries the same intended change', async () => {
    render(view()); await screen.findByText('Project one');
    vi.mocked(projectContextReferences).mockRejectedValueOnce(new Error('Folder missing'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Project one from context' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Project one')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('Project one')).toBeNull());
    expect(writes().map((call) => call[2])).toEqual([[], []]);
  });

  it('checks on demand, prevents duplicate checks, and keeps the chat draft usable while checking', async () => {
    let finish!: () => void;
    vi.mocked(checkProjectContext).mockImplementation(() => new Promise((resolve) => { finish = () => resolve(null); }));
    render(view()); await screen.findByText('Project one');
    const check = screen.getByRole('button', { name: 'Reread documents' });
    expect(check.getAttribute('title')).toBe('Read the text again from the selected folders');
    fireEvent.click(check); fireEvent.click(check);
    expect(checkProjectContext).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Checking project…' }).hasAttribute('disabled')).toBe(true);
    const draft = screen.getByRole('textbox', { name: 'Chat draft' }) as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: 'Keep writing' } }); expect(draft.disabled).toBe(false);
    await act(async () => finish());
    await screen.findByText('Project context checked.');
    expect(draft.value).toBe('Keep writing'); expect(writes()).toHaveLength(0);
  });

  it('recovers from a catalog error before allowing saved reference edits', async () => {
    vi.mocked(projectContextReferences).mockRejectedValueOnce(new Error('Offline'));
    render(view()); await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Consult another project' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Project one');
    expect(screen.getByRole('button', { name: 'Consult another project' }).hasAttribute('disabled')).toBe(false);
    expect(writes()).toHaveLength(0);
  });

  it('rejects more than ten references without truncating the saved selection', async () => {
    rows = Array.from({ length: 10 }, (_, i) => saved(`reference-${i}`));
    render(view()); await screen.findByText('Project reference-9');
    fireEvent.click(screen.getByRole('button', { name: 'Consult another project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use selected projects' }));
    expect(screen.getByRole('alert').textContent).toContain('up to 10');
    expect(writes()).toHaveLength(0); expect(screen.getAllByRole('listitem')).toHaveLength(10);
  });

  it('does not let an old project read replace the new project references', async () => {
    let oldResult!: (value: DocumentProjectContext[]) => void;
    vi.mocked(projectContextReferences).mockImplementationOnce(() => new Promise((resolve) => { oldResult = resolve; }));
    const { rerender } = render(view('old'));
    rerender(view('new')); await screen.findByText('Project one');
    await act(async () => oldResult([saved('stale')]));
    expect(screen.queryByText('Project stale')).toBeNull();
    expect(projectContextReferences).toHaveBeenLastCalledWith('new', undefined, undefined, expect.any(AbortSignal));
  });
});
