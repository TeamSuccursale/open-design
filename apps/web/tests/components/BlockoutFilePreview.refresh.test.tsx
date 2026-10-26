// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWorkspacePermissions, buildWorkspaceSeatSummary, createBlockoutDocument, createBlockoutPage, type WorkspaceCollabContext } from '@open-design/contracts';
import { BlockoutComparisonPreview, BlockoutFilePreview } from '../../src/components/blockout/BlockoutFilePreview';
import { I18nProvider } from '../../src/i18n';
import { loadBlockout, registeredBlockoutComparisonDocument, saveBlockout } from '../../src/providers/blockout';
import { PROJECT_HISTORY_UPDATED_EVENT } from '../../src/providers/project-history';
const previewAuthority = vi.hoisted(() => ({ value: null as WorkspaceCollabContext | null }));
vi.mock('../../src/collab/collab-context', () => ({ useProjectCollabContext: () => ({ workspaceContext: previewAuthority.value }) }));
vi.mock('../../src/providers/blockout', () => ({ loadBlockout: vi.fn(), saveBlockout: vi.fn(), listBlockoutDocuments: vi.fn(), registeredBlockoutComparisonDocument: vi.fn() }));
afterEach(() => { cleanup(); previewAuthority.value = null; vi.resetAllMocks(); });
function authority(): WorkspaceCollabContext { return {
  workspaceId:'workspace-a', workspaceType:'team', workspaceMemberId:'member-a', role:'member', memberStatus:'active', lifecycleState:'active',
  billingState:'active', providerMode:'platform_credits', planId:null,
  seatSummary:buildWorkspaceSeatSummary({seatLimit:5,usedSeats:2}),
  permissions:buildWorkspacePermissions({role:'member',lifecycleState:'active'}), teamId:'team-a',
}; }


it('keeps page two open during a same-owner revision refresh and permits page three afterward', async () => {
  const doc = createBlockoutDocument(); doc.documentId = 'report';
  doc.variants[0]!.label = 'Continuous report';
  doc.variants[0]!.pages = [1, 2, 3].map((n) => createBlockoutPage(`page-${n}`, `Section ${n}`));
  vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'one' });
  const show = (revision: number) => <I18nProvider initial="en"><BlockoutFilePreview projectId="p" documentId="report" path="documents/report/blockout-comparison.html" revision={revision} generating /></I18nProvider>;
  const view = render(show(1));
  fireEvent.click(await screen.findByRole('button', { name: 'Preview Section 1 · Continuous report' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Next page' }));
  expect(within(screen.getByRole('dialog')).getByRole('img', { name: '2. Section 2' })).toBeTruthy();
  let finish!: (value: { document: typeof doc; raw: string }) => void;
  vi.mocked(loadBlockout).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  view.rerender(show(2));
  expect(within(screen.getByRole('dialog')).getByRole('img', { name: '2. Section 2' })).toBeTruthy();
  const refreshed = structuredClone(doc); refreshed.title = 'Updated title';
  finish({ document: refreshed, raw: 'two' });
  await screen.findByRole('heading', { name: 'Updated title' });
  expect(within(screen.getByRole('dialog')).getByRole('img', { name: '2. Section 2' })).toBeTruthy();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Next page' }));
  expect(within(screen.getByRole('dialog')).getByRole('img', { name: '3. Section 3' })).toBeTruthy();
  expect(saveBlockout).not.toHaveBeenCalled();
});

it('keeps the comparison’s page preview mounted while its registered entry is rechecked for a content revision', async () => {
  const document = createBlockoutDocument(); document.documentId = 'report'; document.variants[0]!.label = 'Continuous report';
  document.variants[0]!.pages = [1, 2, 3].map((n) => createBlockoutPage(`page-${n}`, `Section ${n}`));
  vi.mocked(registeredBlockoutComparisonDocument).mockResolvedValue('report');
  vi.mocked(loadBlockout).mockResolvedValue({ document, raw: 'saved' });
  const show = (revision: number) => <I18nProvider initial="en"><BlockoutComparisonPreview projectId="parent" path="documents/report/blockout-comparison.html" revision={revision} generating /></I18nProvider>;
  const view = render(show(1));
  fireEvent.click(await screen.findByRole('button', { name: 'Preview Section 2 · Continuous report' }));
  const modal = screen.getByRole('dialog');
  let resolveRegistration!: (id: string) => void;
  vi.mocked(registeredBlockoutComparisonDocument).mockReturnValueOnce(new Promise((resolve) => { resolveRegistration = resolve; }));
  view.rerender(show(2));
  expect(screen.getByRole('dialog')).toBe(modal);
  expect(within(modal).getByRole('img', { name: '2. Section 2' })).toBeTruthy();
  resolveRegistration('report');
  await waitFor(() => expect(registeredBlockoutComparisonDocument).toHaveBeenCalledTimes(2));
  fireEvent.click(within(modal).getByRole('button', { name: 'Next page' }));
  expect(within(modal).getByRole('img', { name: '3. Section 3' })).toBeTruthy();
  expect(saveBlockout).not.toHaveBeenCalled();
});

it('keeps Compare all across content refresh but reflects an actual canonical selection change', async () => {
  const doc = createBlockoutDocument(); doc.selectedVariantId = 'brief';
  doc.variants[0]!.label = 'First';
  doc.variants.push({ ...structuredClone(doc.variants[0]!), id: 'second', label: 'Second' });
  vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'one' });
  const show = (revision: number) => <I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockout/layout.json" revision={revision} /></I18nProvider>;
  const view = render(show(1));
  fireEvent.click(await screen.findByRole('button', { name: 'Compare all proposals' }));
  const updated = structuredClone(doc); updated.title = 'Refreshed';
  vi.mocked(loadBlockout).mockResolvedValue({ document: updated, raw: 'two' });
  view.rerender(show(2)); await screen.findByRole('heading', { name: 'Refreshed' });
  expect(screen.getByRole('button', { name: 'Choose Second' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Edit or approve the structure' })).toBeNull();
  const externallySelected = structuredClone(updated); externallySelected.selectedVariantId = 'second'; externallySelected.title = 'New canonical choice';
  vi.mocked(loadBlockout).mockResolvedValue({ document: externallySelected, raw: 'three' });
  view.rerender(show(3)); await screen.findByRole('heading', { name: 'New canonical choice' });
  expect(screen.getByRole('button', { name: 'Compare all proposals' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Choose Second' })).toBeNull();
  expect(saveBlockout).not.toHaveBeenCalled();
});

it('retains the last preview and reports failed refresh without permitting a stale selection write', async () => {
  const doc = createBlockoutDocument(); doc.variants[0]!.label = 'Continuous report';
  vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'one' });
  const show = (revision: number) => <I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockout/layout.json" revision={revision} /></I18nProvider>;
  const view = render(show(1));
  fireEvent.click(await screen.findByRole('button', { name: 'Preview Page · Continuous report' }));
  vi.mocked(loadBlockout).mockRejectedValue(new Error('offline'));
  view.rerender(show(2)); await screen.findByRole('alert');
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Choose this structure' }));
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeTruthy());
  expect(saveBlockout).not.toHaveBeenCalled();
});

it.each(['project', 'path', 'document', 'restore'] as const)('clears local modal on %s identity change', async (change) => {
  const doc = createBlockoutDocument(); doc.variants[0]!.label = 'Original';
  vi.mocked(loadBlockout).mockResolvedValue({ document: doc, raw: 'one' });
  const show = (changed: boolean) => <I18nProvider initial="en"><BlockoutFilePreview projectId={changed && change === 'project' ? 'other' : 'p'} path={changed && change === 'path' ? 'documents/other/blockout-comparison.html' : 'blockout/layout.json'} documentId={changed && change === 'document' ? 'other' : 'document-1'} /></I18nProvider>;
  const view = render(show(false));
  fireEvent.click(await screen.findByRole('button', { name: 'Preview Page · Original' }));
  if (change === 'restore') fireEvent(window, new CustomEvent(PROJECT_HISTORY_UPDATED_EVENT, { detail: { projectId: 'p' } }));
  else view.rerender(show(true));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(saveBlockout).not.toHaveBeenCalled();
});


it('ignores irrelevant context property and key-order churn while keeping page two mounted', async () => {
  const doc=createBlockoutDocument(); doc.variants[0]!.label='Structure';
  doc.variants[0]!.pages=[1,2,3].map(n=>createBlockoutPage(`page-${n}`,`Section ${n}`));
  previewAuthority.value=authority();
  vi.mocked(loadBlockout).mockResolvedValue({document:doc,raw:'one'});
  const show=()=> <I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockout/layout.json" /></I18nProvider>;
  const view=render(show());
  fireEvent.click(await screen.findByRole('button',{name:'Preview Section 2 · Structure'}));
  const {workspaceId,...rest}=previewAuthority.value;
  previewAuthority.value={...rest,billingState:'past_due',planId:'changed-plan',teamName:'Changed display name',workspaceId};
  view.rerender(show());
  expect(within(screen.getByRole('dialog')).getByRole('img',{name:'2. Section 2'})).toBeTruthy();
  expect(loadBlockout).toHaveBeenCalledTimes(1);
});

it.each(['workspace','member','role','permission'] as const)('clears on %s request-authority change and ignores the aborted old response', async (change) => {
  const doc=createBlockoutDocument(); doc.title='Initial'; doc.variants[0]!.label='Structure';
  previewAuthority.value=authority();
  vi.mocked(loadBlockout).mockResolvedValue({document:doc,raw:'one'});
  const show=(revision:number)=> <I18nProvider initial="en"><BlockoutFilePreview projectId="p" path="blockout/layout.json" revision={revision} /></I18nProvider>;
  const view=render(show(1));
  fireEvent.click(await screen.findByRole('button',{name:'Preview Page · Structure'}));
  let finishOld!: (value:{document:typeof doc;raw:string})=>void;
  vi.mocked(loadBlockout).mockReturnValueOnce(new Promise(resolve=>{finishOld=resolve;}));
  view.rerender(show(2));
  expect(screen.getByRole('dialog')).toBeTruthy();
  const oldSignal=vi.mocked(loadBlockout).mock.calls.at(-1)![2];
  const nextAuthority={...authority()};
  if(change==='workspace') nextAuthority.workspaceId='workspace-b';
  if(change==='member') nextAuthority.workspaceMemberId='member-b';
  if(change==='role') nextAuthority.role='admin';
  if(change==='permission') nextAuthority.permissions={...nextAuthority.permissions,canWriteSyncedFiles:false};
  previewAuthority.value=nextAuthority;
  const latest=structuredClone(doc); latest.title='New authority';
  vi.mocked(loadBlockout).mockResolvedValue({document:latest,raw:'new'});
  view.rerender(show(2));
  await screen.findByRole('heading',{name:'New authority'});
  expect(oldSignal?.aborted).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
  const stale=structuredClone(doc);stale.title='Stale authority';
  finishOld({document:stale,raw:'stale'});
  await Promise.resolve();
  expect(screen.queryByRole('heading',{name:'Stale authority'})).toBeNull();
  expect(saveBlockout).not.toHaveBeenCalled();
});

it('keeps a comparison-wrapper modal across billing/display context churn', async () => {
  const doc=createBlockoutDocument(); doc.variants[0]!.label='Structure';
  doc.variants[0]!.pages=[1,2,3].map(n=>createBlockoutPage(`page-${n}`,`Section ${n}`));
  previewAuthority.value=authority();
  vi.mocked(registeredBlockoutComparisonDocument).mockResolvedValue('document-1');
  vi.mocked(loadBlockout).mockResolvedValue({document:doc,raw:'one'});
  const show=()=> <I18nProvider initial="en"><BlockoutComparisonPreview projectId="p" path="documents/report/blockout-comparison.html" /></I18nProvider>;
  const view=render(show());
  fireEvent.click(await screen.findByRole('button',{name:/^Preview Section 2 . Structure$/}));
  previewAuthority.value={...authority(),billingState:'past_due',teamName:'Changed display name'};
  view.rerender(show());
  expect(within(screen.getByRole('dialog')).getByRole('img',{name:'2. Section 2'})).toBeTruthy();
  expect(registeredBlockoutComparisonDocument).toHaveBeenCalledTimes(1);
  expect(loadBlockout).toHaveBeenCalledTimes(1);
});
