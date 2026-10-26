// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {UserMessageImpl} from '../../../src/components/ChatPane';
import {blockoutHandoffAttachmentDocument} from '../../../src/components/blockout/handoff-attachment';
import {OPEN_BLOCKOUT_PROPOSALS_EVENT} from '../../../src/components/blockout/events';
const t=((key:string,args?:Record<string,string>)=>key==='chat.openFile'?`Open ${args?.name}`:key==='blockout.file'?'Blockout file':key) as never;
afterEach(cleanup);
it('recognizes canonical requests and matching child aliases only',()=>{
  expect(blockoutHandoffAttachmentDocument('blockouts/report/handoffs/request.blockout-update.json')).toBe('report');
  expect(blockoutHandoffAttachmentDocument('documents/report/blockouts/report/handoffs/request.blockout-update.json')).toBe('report');
  for(const path of ['documents/other/blockouts/report/handoffs/request.blockout-update.json','uploads/request.blockout-update.json','blockouts/report/ordinary.json','blockouts/../handoffs/request.blockout-update.json']) expect(blockoutHandoffAttachmentDocument(path)).toBeNull();
});
it('opens an old persisted typed request as Blockout proposals, never as its raw UUID file',()=>{
  const open=vi.fn(),receive=vi.fn();window.addEventListener(OPEN_BLOCKOUT_PROPOSALS_EVENT,receive);
  render(<UserMessageImpl message={{id:'m',role:'user',content:'One alternative',createdAt:1,attachments:[{path:'documents/report/blockouts/report/handoffs/uuid.blockout-update.json',name:'uuid.blockout-update.json',kind:'file'}]} as never} projectId="p" t={t} appliedContextItems={[]} onRequestOpenFile={open}/>);
  fireEvent.click(screen.getByRole('button',{name:'Open Blockout file'}));
  expect(receive.mock.calls[0]![0].detail).toMatchObject({projectId:'p',documentId:'report'});expect(open).not.toHaveBeenCalled();expect(screen.queryByText('uuid.blockout-update')).toBeNull();
  window.removeEventListener(OPEN_BLOCKOUT_PROPOSALS_EVENT,receive);
});
