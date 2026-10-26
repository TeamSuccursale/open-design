import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectDocumentsStore } from '../src/services/project-documents.js';
import { activeDocumentIdentity, getRunDocumentReferenceContext, parseDocumentReferences, resolveConversationDocument, resolveRunDocumentReferenceContext, setRunDocumentReferenceContext } from '../src/services/document-reference-context.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root,{recursive:true,force:true}); });
async function fixture() {
 const root=await mkdtemp(path.join(tmpdir(),'document-ref-')); roots.push(root); const projectRoot=path.join(root,'project'), dataRoot=path.join(root,'private'); await mkdir(projectRoot); await mkdir(dataRoot);
 const store=new ProjectDocumentsStore({dataRoot,projectId:'parent',projectRoot});
 const first=(await store.create({name:'Reference Report',kind:'document',location:{mode:'managed'}},async()=>({workspaceProjectId:'sibling'}))).document;
 await writeFile(path.join(first.workingDirectory,'report.txt'),'Text to read only on demand'); await writeFile(path.join(first.workingDirectory,'photo.png'),Buffer.from([0,255,128]));
 const project={id:'active-child',name:'Current Report',metadata:{collectionProjectId:'parent',collectionDocumentId:'active-doc'}};
 const authorize=vi.fn(async (_id:string)=>true);
 const input={project,references:[first.id],dataRoot,projectsRoot:root,getProject:(id:string)=>id==='parent'?{id,name:'Collection',metadata:{baseDir:projectRoot}}:null,authorize};
 return {store,first,input,authorize};
}
it('resolves against logical parent, authorizes sibling workspace and includes inventory without content',async()=>{
 const f=await fixture(), prompt=await resolveRunDocumentReferenceContext(f.input);
 expect(f.authorize.mock.calls.map(call=>call[0])).toEqual(['parent','sibling']); expect(prompt).toContain('Current Report'); expect(prompt).toContain('Reference Report'); expect(prompt).toContain('report.txt');
 expect(prompt).toContain(`od documents context --project "parent" --document "${f.first.id}" --json`); expect(prompt).not.toContain('Text to read only on demand'); expect(prompt).not.toContain(f.first.workingDirectory);
});
it('rejects foreign, archived, unavailable and malformed IDs',async()=>{
 const f=await fixture(); await expect(resolveRunDocumentReferenceContext({...f.input,references:['foreign']})).rejects.toMatchObject({statusCode:404});
 await f.store.update(f.first.id,{archived:true}); await expect(resolveRunDocumentReferenceContext(f.input)).rejects.toMatchObject({statusCode:404});
 await f.store.update(f.first.id,{archived:false}); await rm(f.first.workingDirectory,{recursive:true}); await expect(resolveRunDocumentReferenceContext(f.input)).rejects.toMatchObject({statusCode:409});
 expect(()=>parseDocumentReferences(['../escape'])).toThrow(); expect(()=>parseDocumentReferences({path:'folder'})).toThrow();
});
it('denies unauthorized siblings and keeps trusted context independent of caller JSON',async()=>{
 const f=await fixture(); f.authorize.mockImplementation(async id=>id==='parent'); expect(await resolveRunDocumentReferenceContext(f.input)).toBeNull();
 const run={documentContext:'forged'}; expect(getRunDocumentReferenceContext(run)).toBeUndefined(); setRunDocumentReferenceContext(run,'trusted'); expect(getRunDocumentReferenceContext(run)).toBe('trusted'); expect(activeDocumentIdentity(f.input.project)).toContain('active-doc');
});
it('gives an already selected child document sibling identities without reading sibling inventories',async()=>{
 const f=await fixture(), prompt=await resolveRunDocumentReferenceContext({...f.input,references:[]});
 expect(f.authorize.mock.calls.map(call=>call[0])).toEqual(['parent']);
 expect(prompt).toContain('already selected by the user'); expect(prompt).toContain('Reference Report'); expect(prompt).toContain(f.first.id);
 expect(prompt).toContain('Each document has its own brief'); expect(prompt).not.toContain('report.txt'); expect(prompt).not.toContain('photo.png'); expect(prompt).not.toContain(f.first.workingDirectory);
 expect(prompt).toContain('Do not ask the user to choose written report, graphics or both again');
});
it('distinguishes the current CLI workspace from collection registry commands',async()=>{
 const f=await fixture(), identity=activeDocumentIdentity(f.input.project);
 expect(identity).toContain('CLI_WORKSPACE_PROJECT_ID: active-child');
 expect(identity).toContain('Collection registry project ID: parent');
 expect(identity).toContain('& $env:OD_NODE_BIN $env:OD_BIN document-setup show --project $env:OD_PROJECT_ID --json');
 expect(identity).toContain('collection project ID is ONLY for od documents');
 expect(identity).toContain("Never save the active child's settings or brief into the parent collection");
 expect(identity).toContain('authoritative over older frozen reference notes');
});
it('binds shared-folder editing by exclusive conversation and excludes only that document from @ references',async()=>{
 const f=await fixture(), project={id:'parent',name:'Collection',metadata:{baseDir:path.join(f.input.projectsRoot,'project')}};
 const store=new ProjectDocumentsStore({dataRoot:f.input.dataRoot,projectId:'parent',projectRoot:project.metadata.baseDir,
   initialDocuments:[{id:'active-report',name:'Own report',conversationIds:['report-chat']},{id:'sibling-drawings',name:'Other drawings',conversationIds:['drawing-chat']}]});
 await store.list();
 const common={...f.input,project,references:[],conversationId:'drawing-chat'};
 const own=await resolveConversationDocument(common); expect(own?.id).toBe('sibling-drawings');
 expect(await resolveConversationDocument({...common,conversationId:'new-chat'})).toBeNull();
 const identity=await resolveRunDocumentReferenceContext(common);
 expect(identity).toContain('resolved from this conversation: Other drawings');
 expect(identity).toContain('Always pass --document sibling-drawings');
 expect(identity).not.toContain('resolved from this conversation: Own report');
 await expect(resolveRunDocumentReferenceContext({...common,references:['sibling-drawings']})).rejects.toThrow('Choose another');
 const sibling=await resolveRunDocumentReferenceContext({...common,references:['active-report']}); expect(sibling).toContain('Document: Own report');
 const unbound=await resolveRunDocumentReferenceContext({...common,conversationId:'new-chat'});
 expect(unbound).toContain('Same-collection document catalog'); expect(unbound).not.toContain('resolved from this conversation');
});
