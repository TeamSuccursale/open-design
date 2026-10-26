// @vitest-environment jsdom
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { ChatComposer,STAGE_ATTACHMENT_EVENT } from '../../src/components/ChatComposer';
import { BLOCKOUT_OPEN_EVENT,type BlockoutAgentRequest } from '../../src/components/blockout/events';
import { I18nProvider } from '../../src/i18n';
import { composerText,flushMounts,typeAndSettle } from '../helpers/lexical-composer';
const request:BlockoutAgentRequest={requestId:'immutable-request',documentId:'report',text:'Make one alternative.',attachments:[{path:'blockouts/report/handoffs/immutable-request.blockout-update.json',name:'Blockout report',kind:'file'}]};
vi.mock('../../src/components/blockout/BlockoutWorkspace',()=>({BlockoutWorkspace:({onRequestAlternatives,onClose,initialBlockId}:{onRequestAlternatives?:(request:BlockoutAgentRequest)=>Promise<boolean>;onClose:()=>void;initialBlockId?:string})=><button onClick={async()=>{if(await onRequestAlternatives?.(request))onClose();}}>Send dedicated request {initialBlockId}</button>}));
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(async()=>Response.json({}))));
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();});
it('sends a separate alternative intent without consuming handwritten text, attachments or the normal composer send',async()=>{
  const onSend=vi.fn(),onBlockoutRequest=vi.fn().mockResolvedValue(true);
  render(<I18nProvider initial="en"><ChatComposer projectId="p" projectFiles={[]} streaming={false} onSend={onSend} onBlockoutRequest={onBlockoutRequest} onStop={vi.fn()} onEnsureProject={vi.fn()}/></I18nProvider>);
  await flushMounts();await typeAndSettle('My unfinished independent note');
  fireEvent(window,new CustomEvent(STAGE_ATTACHMENT_EVENT,{detail:{attachments:[{path:'notes.pdf',name:'notes.pdf',kind:'file'}]}}));
  act(()=>window.dispatchEvent(new CustomEvent(BLOCKOUT_OPEN_EVENT,{detail:{projectId:'p',documentId:'report',pageId:'page-2',blockId:'figure'}})));
  fireEvent.click(await screen.findByRole('button',{name:'Send dedicated request figure'}));
  await waitFor(()=>expect(onBlockoutRequest).toHaveBeenCalledWith(request));
  expect(onSend).not.toHaveBeenCalled();expect(composerText()).toBe('My unfinished independent note');
  fireEvent.click(screen.getByTestId('chat-send'));
  await waitFor(()=>expect(onSend).toHaveBeenCalledOnce());
  expect(onSend.mock.calls[0]![0]).toBe('My unfinished independent note');
  expect(onSend.mock.calls[0]![1]).toEqual([expect.objectContaining({path:'notes.pdf'})]);
});
