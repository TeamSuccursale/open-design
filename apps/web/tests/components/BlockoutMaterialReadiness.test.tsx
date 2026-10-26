// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import { en } from '../../src/i18n/locales/en';
import { DocumentProjectWorkspace } from '../../src/components/document-setup/DocumentProjectWorkspace';
import { BlockoutReadiness } from '../../src/components/blockout/BlockoutReadiness';
import { useBlockoutReadiness } from '../../src/components/blockout/useBlockoutReadiness';
import { BLOCKOUT_COMPARISON_RESULT_EVENT, BLOCKOUT_MATERIALS_UPDATED_EVENT } from '../../src/providers/blockout-materials';
import { listBlockoutDocuments, loadBlockout, saveBlockout } from '../../src/providers/blockout';
import { PROJECT_HISTORY_UPDATED_EVENT } from '../../src/providers/project-history';
import { materialAssessment, materialDocument, materialInventory } from '../helpers/blockout-materials-fixtures';

vi.mock('../../src/providers/blockout', () => ({ listBlockoutDocuments: vi.fn(), loadBlockout: vi.fn(), saveBlockout: vi.fn() }));
vi.mock('../../src/providers/document-setup', () => ({ documentSetupRequest: vi.fn(async () => null) }));
vi.mock('../../src/components/chat/ProjectIntakeProgress', () => ({ ProjectIntakeProgress: () => null }));
const key = (name: string) => en[`blockoutMaterials.${name}` as keyof typeof en];
function workspace(running = false) {
  return <I18nProvider initial="en"><DocumentProjectWorkspace projectId="project" title="Survey" enabled running={running} failed={false} chatOpen={false} left={0} onBack={vi.fn()} onChat={vi.fn()} onFiles={vi.fn()} onStop={vi.fn()} /></I18nProvider>;
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.mocked(listBlockoutDocuments).mockResolvedValue([{ id: 'document-1', title: 'Survey' }]);
  vi.mocked(loadBlockout).mockResolvedValue({ document: materialDocument(), raw: 'saved' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('material-aware blockout readiness', () => {
  it('remeasures explicit composition checks after this project is restored, while ignoring other projects', async () => {
    const fetch = vi.fn(async (url: string) => url.endsWith('/blockout-materials') ? Response.json({ inventory: materialInventory() }) : Response.json({ assessment: materialAssessment() }));
    vi.stubGlobal('fetch', fetch); render(workspace());
    await waitFor(() => expect(screen.getAllByText(key('ready')).length).toBeGreaterThan(0));
    const count = fetch.mock.calls.filter(([url]) => url.endsWith('/assessment')).length;
    fireEvent(window, new CustomEvent(PROJECT_HISTORY_UPDATED_EVENT, { detail: { projectId: 'other' } }));
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/assessment'))).toHaveLength(count);
    fireEvent(window, new CustomEvent(PROJECT_HISTORY_UPDATED_EVENT, { detail: { projectId: 'project', restoredPaths: ['blockout/layout.json'] } }));
    expect(screen.queryByText(key('ready'))).toBeNull();
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url.endsWith('/assessment')).length).toBeGreaterThan(count));
    await waitFor(() => expect(screen.getAllByText(key('ready')).length).toBeGreaterThan(0));
  });
  it('shows a service area as a schematic marker without turning feedback into printable content', async () => {
    const document = materialDocument();
    document.variants[0]!.pages[0]!.blocks.push({ ...document.variants[0]!.pages[0]!.blocks[0]!, id: 'caption', materialRole: 'service', contentIds: [], label: 'Figure 1 · West wall', expectation: 'Keep the original legend; this is feedback, not printable text.' });
    vi.mocked(loadBlockout).mockResolvedValue({ document, raw: 'saved' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/blockout-materials') ? Response.json({ inventory: materialInventory() }) : Response.json({ assessment: materialAssessment(document) })));
    render(workspace());
    const caption = await screen.findByTestId('blockout-content-caption');
    expect(caption.textContent).toContain('Figure 1 · West wall');
    expect(caption.getAttribute('data-role')).toBe('navigation');
    expect(screen.getAllByText('Figure 1 · West wall')).toHaveLength(1);
    expect(caption.textContent).not.toContain('feedback');
  });

  it('keeps the explicit composition checks separate from schematic Blockout previews', async () => {
    let inventoried = false;
    const fetch = vi.fn(async (url: string) => url.endsWith('/blockout-materials') ? Response.json({ inventory: materialInventory(inventoried ? 'ready' : 'preparing') }) : Response.json({ assessment: materialAssessment() }));
    vi.stubGlobal('fetch', fetch); render(workspace());
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByText(key('waitInventory'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose Proposal A' })).toBeNull();
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/assessment'))).toBe(false);
    inventoried = true; window.dispatchEvent(new CustomEvent(BLOCKOUT_MATERIALS_UPDATED_EVENT, { detail: { projectId: 'project' } }));
    await waitFor(() => expect(screen.getAllByText(key('ready')).length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: 'Choose Proposal A' })).toBeTruthy();
    expect(screen.getByTestId('blockout-content-body').textContent).toContain('Body text');
    expect(screen.getByTestId('blockout-content-body').textContent).not.toContain('The survey records cracking near the west wall.');
    expect(screen.getByTestId('blockout-content-photo').querySelector('img')).toBeNull();
    expect(screen.getByText('Page coverage 60–60%')).toBeTruthy();
  });

  it('removes the old ready result immediately on edits, rejects an older geometry result, and leaves the draft usable', async () => {
    const document = materialDocument(); let changed = false;
    const fetch = vi.fn(async (url: string) => url.endsWith('/blockout-materials') ? Response.json({ inventory: materialInventory() }) : Response.json({ assessment: materialAssessment() }));
    vi.stubGlobal('fetch', fetch);
    function Harness() { const value = useBlockoutReadiness('project', changed ? { ...document, title: 'Edited report' } : document); return <><BlockoutReadiness value={value} /><button>Edit draft</button></>; }
    const view = render(<I18nProvider initial="en"><Harness /></I18nProvider>);
    await screen.findByText(key('ready'));
    changed = true; view.rerender(<I18nProvider initial="en"><Harness /></I18nProvider>);
    expect(screen.queryByText(key('ready'))).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit draft' })).toBeTruthy();
    expect(await screen.findByText(key('checkFailed'))).toBeTruthy();
    expect(screen.queryByText(key('ready'))).toBeNull();
  });

  it('shows gaps without claiming ready and lets the user retry a failed inventory', async () => {
    let failed = true;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/blockout-materials')) {
        if (init?.method === 'POST') failed = false;
        return Response.json({ inventory: { ...materialInventory(failed ? 'needs-input' : 'ready'), gaps: failed ? ['The scanned page has no readable text.'] : [] } });
      }
      return Response.json({ assessment: materialAssessment() });
    });
    vi.stubGlobal('fetch', fetch); render(workspace());
    await screen.findByText(key('needsInput'));
    expect(screen.queryByText(key('ready'))).toBeNull();
    fireEvent.click(screen.getByText(key('details')));
    expect(screen.getByText('The scanned page has no readable text.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getAllByText(key('ready')).length).toBeGreaterThan(0));
    expect(fetch.mock.calls.some(([url, init]) => url.endsWith('/blockout-materials') && init?.method === 'POST')).toBe(true);
  });

  it('does not measure or present partial new proposals while the native generator is running', async () => {
    const fetch = vi.fn(async (_url: string) => Response.json({ inventory: materialInventory() })); vi.stubGlobal('fetch', fetch);
    render(workspace(true));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Choose Proposal A' })).toBeNull();
    expect(fetch.mock.calls.every(([url]) => String(url).endsWith('/blockout-materials'))).toBe(true);
    expect(screen.queryByText(key('ready'))).toBeNull();
  });

  it('clears a saved geometry check before remeasurement and shows actual warning/density details without disabling edits', async () => {
    let needsReview = false;
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/blockout-materials')) return Response.json({ inventory: materialInventory() });
      const assessment = materialAssessment();
      if (needsReview) {
        assessment.status = 'warning'; assessment.variants[0]!.status = 'warning';
        const page = assessment.variants[0]!.pages[0]!; page.status = 'warning'; page.density = .08;
        page.issues.push({ code: 'sparse-page', severity: 'warning', message: 'The page contains very little supplied material.', contentIds: [] });
      }
      return Response.json({ assessment });
    });
    vi.stubGlobal('fetch', fetch); render(workspace());
    await waitFor(() => expect(screen.getAllByText(key('ready')).length).toBeGreaterThan(0));
    needsReview = true; fireEvent(window, new CustomEvent('melillodesign:blockout-saved', { detail: { projectId: 'project' } }));
    expect(screen.queryByText(key('ready'))).toBeNull();
    await waitFor(() => expect(screen.getAllByText(key('warning')).length).toBeGreaterThan(0));
    expect(screen.getByText('Page coverage 8–8%')).toBeTruthy();
    fireEvent.click(screen.getByText('1 pages checked · 1 findings'));
    expect(screen.getByText('The page contains very little supplied material.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose Proposal A' }));
    expect(await screen.findByRole('button', { name: 'Edit the selected proposal' })).toBeTruthy();
    expect(saveBlockout).toHaveBeenCalled();
  });

  it('distinguishes native text coverage from images that the user has not requested', async () => {
    const inventory = materialInventory(); inventory.sources.entries[0]!.coverage = { text: 'complete', images: 'not-requested' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/blockout-materials') ? Response.json({ inventory }) : Response.json({ assessment: materialAssessment() })));
    render(workspace());
    expect(await screen.findByText(key('textOnly'))).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(key('ready')).length).toBeGreaterThan(0));
  });

  it('keeps a preview failure separate from saved layout/fit status and clears it only on this document’s successful save', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/blockout-materials') ? Response.json({ inventory: materialInventory() }) : Response.json({ assessment: materialAssessment() })));
    render(workspace());
    await waitFor(() => expect(screen.getAllByText(key('ready')).length).toBeGreaterThan(0));
    const result = (detail: { projectId: string; documentId: string; error?: string; path?: string }) => fireEvent(window, new CustomEvent(BLOCKOUT_COMPARISON_RESULT_EVENT, { detail }));
    result({ projectId: 'other', documentId: 'document-1', error: 'Renderer failed' });
    expect(screen.queryByText(key('previewNotUpdated'))).toBeNull();
    result({ projectId: 'project', documentId: 'document-1', error: 'Renderer failed' });
    expect(screen.getByText(key('previewNotUpdated'))).toBeTruthy();
    expect(screen.getAllByText(key('ready')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Choose Proposal A' })).toBeTruthy();
    result({ projectId: 'project', documentId: 'another-document', path: 'comparison.html' });
    expect(screen.getByText(key('previewNotUpdated'))).toBeTruthy();
    result({ projectId: 'project', documentId: 'document-1', path: 'comparison.html' });
    expect(screen.queryByText(key('previewNotUpdated'))).toBeNull();
  });
});
