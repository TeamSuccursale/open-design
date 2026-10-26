import { open, readFile, realpath, lstat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Agent, fetch } from 'undici';
import { HeaderFooterIdSchema, type HeaderFooterAsset, type HeaderFooterWorkspaceResponse } from '@open-design/contracts';
import { resolveDaemonUrl } from './daemon-url.js';
import { HEADER_FOOTER_UPLOAD_LIMITS, inspectHeaderFooterLogo } from './services/header-footer-assets.js';

export interface HeaderFooterCliIo { readInput?: (path: string) => Promise<string>; write?: (value: string) => void }
export const HEADER_FOOTER_CLI_COMMANDS = ['list', 'create', 'draft', 'validate', 'publish', 'apply', 'detach', 'disable', 'history', 'restore', 'restore-draft', 'archive', 'unarchive', 'retry', 'assets', 'source-files', 'import', 'upload', 'remove-logo', 'export-logo', 'search', 'retry-search', 'cancel-search', 'choose-logo'] as const;
export const HEADER_FOOTER_CLI_HELP = `od header-footer <${HEADER_FOOTER_CLI_COMMANDS.join('|')}> --project <id> [--set <id>] [--document <id>] [--search <id>] [--asset <id>] [--file <path>] [--name <name>] [--json] [--prompt-file <path|->]
All commands use the same project-owned HTTP API as the editor. --prompt-file reads a UTF-8 JSON object or stdin (-). list/assets return designs, bindings, relevant logos/searches, registered documents, history and pending updates. A child project resolves to its parent collection library.
create: {name,guidance?,variants?}. The returned set has id, draftVersion and revision; empty default paper variants are unconfigured adaptations, not design alternatives.
draft --set: {expectedDraftVersion,draft:{version:1,name,guidance,stage:"structural"|"graphic",variants:[{id,name,pageWidthMm,pageHeightMm,headerHeightMm,footerHeightMm,blocks:[]}]}}.
Each block is {id,region:"header"|"footer",kind:"logo"|"text"|"field"|"rule",x,y,width,height,assetId?,text?,field?,fontSize?,color?,align?,guidance?,lockedRatio?}. Coordinates are 0..1 inside that header/footer strip, not page millimetres. field is projectName|documentName|pageNumber|totalPages|date|revision; align is left|center|right, color is #RRGGBB. Use actual collected asset IDs for logo blocks. Distinct structural proposals are separate named sets; A4/A3 variants adapt one design.
validate --set [--document]: {documentId?,expectedDraftVersion?}. Checks the saved draft's fit for the explicit document and all documents following this design, without saving, publishing or applying. Returns {valid:true,setId,draftVersion,documentIds}. Run this before requesting graphic-preview approval; fix any errors first. Publication repeats these checks.
publish --set: {expectedDraftVersion,expectedRevision,stage:"graphic-approved",originDocumentId?,binding?:{documentId,followUpdates,header,footer,showOnCover,expectedBindingVersion?}}. Requires the engineer's explicit approval of the real graphic preview; a structural choice or draft save does not approve publication. Published changes update every linked document. Name that scope first.
apply --document: {setId,revision?,followUpdates,header,footer,showOnCover,expectedBindingVersion?}. Reapply an unchanged revision to render newly added HTML pages without publishing another design revision. followUpdates:false freezes an independent copy. To EDIT only one independent document, create a separate set from its snapshot, save that draft and publish with binding.followUpdates:false; do not publish edits to the original shared set.
detach --document: {expectedBindingVersion}; disable --document: {expectedBindingVersion}. detach freezes the current applied copy; disable removes the owned recurring regions. Draft saves never apply automatically.
history --set returns {revisions,drafts}. restore --set: {revision,expectedRevision,expectedDraftVersion,originDocumentId?,documentId?}; omit documentId to republish to current linked documents, supply it to restore an independent copy in one document. restore-draft --set: {entryId,expectedDraftVersion} restores a recoverable draft without applying it. archive/unarchive --set: {expectedRevision}; archived published revisions remain recoverable.
source-files lists image/ZIP candidates from already selected project and context folders. These candidates are not yet received logos. import --prompt-file with {sourceIds:[id]} imports selected candidates into this library without uploading them again. Import validates each actual image and returns per-file errors; it does not start gallery intake.
upload --file <individual-logo-or-ZIP> or --prompt-file with {files:[{name,base64}]}; mixed packages return per-file errors, and originals remain recoverable. remove-logo --asset removes an unused logo from the active collection, preserving recovery data.
export-logo --asset <id> --file <new-path> --project <id> --json reads that logo through the authorised content endpoint, verifies image identity/MIME/hash and writes a new local file of at most 12 MB; an existing file is never overwritten. Returns {filePath,asset}. Inspect this actual local logo with an image viewer (render vector files when necessary) before designing; never infer its appearance from its name. Export only the relevant logos, not the whole gallery.
search: {target,website?,guidance?}; one actual gpt-6.1-sol/low session per target. retry-search/cancel-search --search control that target. choose-logo --search: {assetId} chooses an actual downloaded candidate. Do not send all project images. retry resumes pending document propagation; inspect binding/transaction status before reporting success.`;
async function exportHeaderFooterLogo(input: { base: string; projectId: string; assetId: string; file: string; headers: Record<string, string>; dispatcher: Agent }): Promise<{ filePath: string; asset: HeaderFooterAsset }> {
  const assetId = HeaderFooterIdSchema.parse(input.assetId), requested = path.resolve(input.file), parent = await realpath(path.dirname(requested)), filePath = path.join(parent, path.basename(requested));
  try { await lstat(filePath); throw new Error('The export destination already exists. Choose a new file; existing files are never overwritten.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const base = `${input.base.replace(/\/$/, '')}/api/projects/${encodeURIComponent(input.projectId)}/header-footer`;
  const metadata = await fetch(base, { dispatcher: input.dispatcher, headers: input.headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!metadata.ok) { const result = await metadata.json() as { error?: { message?: string } }; throw new Error(result.error?.message ?? `Header/footer returned HTTP ${metadata.status}`); }
  const state = await metadata.json() as HeaderFooterWorkspaceResponse;
  if (state.projectId !== input.projectId && (!Array.isArray(state.documents) || !state.documents.some((document) => document.projectId === state.projectId && document.workspaceProjectId === input.projectId))) throw new Error('The returned logo library does not belong to the requested project.');
  const asset = Array.isArray(state.assets) ? state.assets.find((item) => item.id === assetId) : undefined;
  if (!asset) throw new Error('Logo not found in the requested project collection.');
  if (!['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'].includes(asset.mimeType) || !Number.isInteger(asset.size) || asset.size <= 0 || asset.size > HEADER_FOOTER_UPLOAD_LIMITS.fileBytes || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('The saved logo metadata is not a supported bounded image.');
  // Resolve the owned route from IDs, never an arbitrary metadata URL or remote hotlink.
  const response = await fetch(`${base}/assets/${encodeURIComponent(assetId)}/content`, { dispatcher: input.dispatcher, headers: input.headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) { const result = await response.json() as { error?: { message?: string } }; throw new Error(result.error?.message ?? `Logo content returned HTTP ${response.status}`); }
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (mimeType !== asset.mimeType) { await response.body?.cancel(); throw new Error('The downloaded logo MIME does not match its saved image metadata.'); }
  const declaredSize = response.headers.get('content-length');
  if (declaredSize !== null && Number(declaredSize) !== asset.size) { await response.body?.cancel(); throw new Error('The downloaded logo size does not match its saved metadata.'); }
  const chunks: Buffer[] = []; let size = 0;
  if (!response.body) throw new Error('The logo content endpoint returned no image.');
  for await (const chunk of response.body) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > HEADER_FOOTER_UPLOAD_LIMITS.fileBytes || size > asset.size) throw new Error('The downloaded logo exceeds its saved size or the 12 MB export limit.'); chunks.push(buffer); }
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== asset.size || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('The downloaded logo bytes do not match the saved image identity.');
  if (inspectHeaderFooterLogo(asset.filename, bytes).mimeType !== asset.mimeType) throw new Error('The actual logo format does not match its saved MIME.');
  const output = await open(filePath, 'wx', 0o600);
  try { await output.writeFile(bytes); await output.sync(); }
  catch (error) { await output.close(); await unlink(filePath).catch(() => undefined); throw error; }
  await output.close(); return { filePath, asset };
}

/** All agent and shell mutations use the same authorised HTTP implementation as the editor. */
export async function runHeaderFooterCli(args: string[], io: HeaderFooterCliIo = {}): Promise<void> {
  const [action, ...rest] = args, write = io.write ?? console.log;
  if (!action || ['help', '--help', '-h'].includes(action) || rest.includes('--help')) { write(HEADER_FOOTER_CLI_HELP); return; }
  const known: readonly string[] = HEADER_FOOTER_CLI_COMMANDS;
  if (!known.includes(action)) throw new Error('Unknown header-footer command');
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index]!; if (flag === '--json') { flags.set(flag, 'true'); continue; }
    if (!['--project', '--set', '--document', '--search', '--asset', '--file', '--name', '--prompt-file', '--daemon-url'].includes(flag) || !rest[index + 1] || rest[index + 1]!.startsWith('--')) throw new Error(`Invalid header-footer option: ${flag}`);
    flags.set(flag, rest[++index]!);
  }
  const projectId = flags.get('--project'); if (!projectId) throw new Error('--project is required');
  let input: Record<string, unknown> = {};
  const promptFile = flags.get('--prompt-file');
  if (promptFile) {
    let content = '';
    if (io.readInput) content = await io.readInput(promptFile); else if (promptFile === '-') { for await (const chunk of process.stdin) content += String(chunk); } else content = await readFile(promptFile, 'utf8');
    const parsed: unknown = JSON.parse(content); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a header/footer JSON object'); input = parsed as Record<string, unknown>;
  }
  const setId = flags.get('--set') ?? (typeof input.setId === 'string' ? input.setId : undefined), documentId = flags.get('--document') ?? (typeof input.documentId === 'string' ? input.documentId : undefined), searchId = flags.get('--search');
  const requireId = (value: string | undefined, name: string) => { if (!value) throw new Error(`${name} is required`); return encodeURIComponent(value); };
  let suffix = '', method = 'GET', body: unknown;
  if (action === 'source-files') suffix = '/source-files';
  else if (action === 'import') { suffix = '/assets/import'; method = 'POST'; body = input; }
  else if (action === 'create') { suffix = '/sets'; method = 'POST'; body = { ...input, ...(flags.has('--name') ? { name: flags.get('--name') } : {}) }; }
  else if (action === 'archive' || action === 'unarchive') { suffix = `/sets/${requireId(setId, '--set')}`; method = 'PATCH'; body = { archived: action === 'archive', expectedRevision: input.expectedRevision }; }
  else if (action === 'validate') { suffix = `/sets/${requireId(setId, '--set')}/validate`; method = 'POST'; const { setId: _set, documentId: _document, ...payload } = input; body = { ...payload, ...(documentId ? { documentId } : {}) }; }
  else if (['draft', 'publish', 'history', 'restore', 'restore-draft'].includes(action)) { suffix = `/sets/${requireId(setId, '--set')}/${action}`; method = action === 'history' ? 'GET' : action === 'draft' ? 'PATCH' : 'POST'; if (method !== 'GET') { const { setId: _set, ...payload } = input; body = payload; } }
  else if (['apply', 'detach', 'disable'].includes(action)) { suffix = `/documents/${requireId(documentId, '--document')}/${action === 'detach' ? 'detach' : 'binding'}`; method = action === 'disable' ? 'DELETE' : 'POST'; const { documentId: _document, ...payload } = input; if (action === 'disable') suffix += `?expectedBindingVersion=${encodeURIComponent(String(input.expectedBindingVersion ?? ''))}`; else body = action === 'apply' ? { ...payload, ...(setId ? { setId } : {}) } : payload; }
  else if (action === 'retry') { suffix = '/retry'; method = 'POST'; body = {}; }
  else if (action === 'remove-logo') { suffix = `/assets/${requireId(flags.get('--asset') ?? (typeof input.assetId === 'string' ? input.assetId : undefined), '--asset')}`; method = 'DELETE'; }
  else if (action === 'upload') {
    suffix = '/assets'; method = 'POST';
    const file = flags.get('--file');
    if (file) { const data = await readFile(file); const name = file.replace(/\\/g, '/').split('/').pop()!; body = { files: [{ name, base64: data.toString('base64') }] }; }
    else body = input;
  } else if (action === 'search') { suffix = '/searches'; method = 'POST'; body = input; }
  else if (['retry-search', 'cancel-search', 'choose-logo'].includes(action)) { suffix = `/searches/${requireId(searchId, '--search')}/${action === 'retry-search' ? 'retry' : action === 'cancel-search' ? 'cancel' : 'choose'}`; method = 'POST'; body = input; }
  const workspaceId = process.env.OD_WORKSPACE_ID?.trim(), memberId = process.env.OD_WORKSPACE_MEMBER_ID?.trim(); if (Boolean(workspaceId) !== Boolean(memberId)) throw new Error('The run workspace identity is incomplete');
  const url = await resolveDaemonUrl({ flagUrl: flags.get('--daemon-url') ?? null }), dispatcher = new Agent();
  try {
    if (action === 'export-logo') {
      const assetId = flags.get('--asset') ?? (typeof input.assetId === 'string' ? input.assetId : undefined), file = flags.get('--file') ?? (typeof input.filePath === 'string' ? input.filePath : undefined);
      if (!assetId || !file) throw new Error('export-logo requires --asset <id> and --file <new-path>');
      const result = await exportHeaderFooterLogo({ base: url, projectId, assetId, file, dispatcher, headers: workspaceId && memberId ? { 'x-od-workspace-id': workspaceId, 'x-od-workspace-member-id': memberId } : {} });
      write(JSON.stringify(result, null, flags.has('--json') ? undefined : 2)); return;
    }
    const response = await fetch(`${url.replace(/\/$/, '')}/api/projects/${encodeURIComponent(projectId)}/header-footer${suffix}`, { method, dispatcher, headers: { ...(workspaceId && memberId ? { 'x-od-workspace-id': workspaceId, 'x-od-workspace-member-id': memberId } : {}), ...(process.env.OD_STOCK_RUN_ID?.trim() ? { 'x-od-run-id': process.env.OD_STOCK_RUN_ID.trim() } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as { error?: { message?: string } }; if (!response.ok) throw new Error(result.error?.message ?? `Header/footer returned HTTP ${response.status}`); write(JSON.stringify(result, null, flags.has('--json') ? undefined : 2));
  } finally { await dispatcher.close(); }
}
