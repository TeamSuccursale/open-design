// The setup conversation asks every choice in one starting form and spends as
// few agent round trips as the work allows: run 3's Codex setup asked in two
// forms over four turns and made 23 tool calls, Claude Code asked in one form
// over three turns and made 9, with the same brief.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SaveHeaderFooterDraftRequestSchema, type DocumentSetupIntent } from '@open-design/contracts';
import {
  confirmDocumentSetup, loadDocumentSetupContext, prepareDocumentSetupContextFiles, renderFrozenDocumentSetupContext,
  saveDocumentSetupIntent, scanDocumentSetupContext, SETUP_HEADER_FOOTER_DRAFT_EXAMPLE, SETUP_SET_EXAMPLE,
} from '../src/services/document-setup.js';
import { HeaderFooterStore } from '../src/services/header-footer.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function folder(): Promise<string> { const root = await mkdtemp(path.join(tmpdir(), 'setup-starting-form-')); roots.push(root); return root; }
const intent: DocumentSetupIntent = { kind: 'report', subtype: 'Relazione tecnica', documentName: 'Relazione tecnica', purpose: '', contextRoots: [], imageIntakeConsent: false, imageIntakeDecision: 'declined' };
const presentation = { version: 1 as const, status: 'confirmed' as const, name: 'Relazione tecnica', header: false, footer: false, cover: false, pageNumbers: false, numberOnCover: null, coverCountsTowardPageLimit: null, coverCountsInNumbering: null, numberingStart: 1 };

async function frozen(root: string): Promise<string> {
  const [file] = await prepareDocumentSetupContextFiles(root);
  return renderFrozenDocumentSetupContext([{ mediaType: 'text/plain', content: await readFile(path.join(root, file!)) }]);
}

describe('document setup starting form', () => {
  it('asks every setup choice in one starting form, in live and frozen context', async () => {
    const root = await folder();
    await saveDocumentSetupIntent(root, intent);
    await scanDocumentSetupContext(root, undefined, async () => ({ pages: [], warnings: [], pagesRead: 0, pagesTotal: 0 }));
    for (const context of [await loadDocumentSetupContext(root), await frozen(root)]) {
      expect(context).toContain('ONE STARTING FORM');
      expect(context).toContain('showWhen');
      expect(context).not.toContain('3–6 related fields');
      expect(context).not.toContain('small coherent groups');
    }
  });

  it('lets preparation read small complete texts directly and keeps the reader for the rest', async () => {
    const root = await folder();
    await writeFile(path.join(root, 'breve.txt'), 'Formato A4, massimo 8 pagine.\nArial 11, interlinea 1,5.\n');
    await writeFile(path.join(root, 'lungo.txt'), 'Riga lunga di un capitolato molto esteso.\n'.repeat(4000));
    await saveDocumentSetupIntent(root, intent);
    const { scan } = await scanDocumentSetupContext(root);
    const short = scan.textDocuments!.find((entry) => entry.sourcePath === 'breve.txt')!;
    const long = scan.textDocuments!.find((entry) => entry.sourcePath === 'lungo.txt')!;

    const preparation = await loadDocumentSetupContext(root);
    const direct = preparation.split('\n').find((line) => line.startsWith('READ DIRECTLY DURING PREPARATION'));
    expect(direct).toContain(short.textPath);
    expect(direct).not.toContain(long.textPath);
    expect(preparation).toContain('custodian ask');

    await confirmDocumentSetup(root, { purpose: 'Relazione del criterio B', constraints: [], blockoutApproach: 'manual', editorialSettings: [{ documentId: 'document-1', presentation }] });
    expect(await loadDocumentSetupContext(root)).not.toContain('READ DIRECTLY DURING PREPARATION');
  });

  it('gives preparation what it would otherwise look up, re-read or plan in extra round trips', async () => {
    const root = await folder();
    await saveDocumentSetupIntent(root, intent);
    await scanDocumentSetupContext(root, undefined, async () => ({ pages: [], warnings: [], pagesRead: 0, pagesTotal: 0 }));
    const context = await loadDocumentSetupContext(root);
    expect(context).toContain('do not read it back with document-setup show');
    expect(context).toContain('one shell command');
    expect(context).toContain('No task list');
    expect(context).toContain('"editorialSettings":[{"documentId":"document-1"');
    expect(context).toContain(JSON.stringify(SETUP_SET_EXAMPLE));
    expect(context).toContain('header-footer create --project');
    // The example the agent copies is a payload document-setup set accepts.
    const saved = await saveDocumentSetupIntent(root, SETUP_SET_EXAMPLE);
    expect(saved.intent.editorialSettings?.[0]?.pageTarget).toBe(8);
  });

  // The single-form Codex run still read `header-footer help` for the draft
  // payload, validated each document in its own call, and lost a save to a
  // typographic apostrophe that closed a single-quoted PowerShell string.
  // Without the help page, the next run added a fontFamily key the strict
  // block schema rejects, so the rule names every block key.
  it('gives preparation the header/footer draft, the validation chain and the PowerShell quoting rule', async () => {
    const root = await folder();
    await saveDocumentSetupIntent(root, intent);
    await scanDocumentSetupContext(root, undefined, async () => ({ pages: [], warnings: [], pagesRead: 0, pagesTotal: 0 }));
    for (const context of [await loadDocumentSetupContext(root), await frozen(root)]) {
      expect(context).toContain('header-footer draft --project');
      expect(context).toContain(JSON.stringify(SETUP_HEADER_FOOTER_DRAFT_EXAMPLE));
      expect(context).toContain('a block takes only id, region, kind, x, y, width, height, text, field, assetId, fontSize, color, align, guidance and lockedRatio');
      expect(context).toContain('no linked documents yet');
      expect(context).toContain('validate --document once per target document');
      expect(context).toContain('typographic apostrophe (’)');
      expect(context).toContain('single-quoted here-string');
    }
  });

  it('offers a header/footer draft example the store saves and validates', async () => {
    const draft = SaveHeaderFooterDraftRequestSchema.parse(SETUP_HEADER_FOOTER_DRAFT_EXAMPLE).draft;
    expect(draft.stage).toBe('graphic');
    expect(draft.variants.map((variant) => `${variant.pageWidthMm}x${variant.pageHeightMm}`)).toEqual(['210x297', '420x297']);
    for (const variant of draft.variants) {
      expect(variant.blocks.map((block) => [block.region, block.kind, block.text ?? '', block.align ?? ''])).toEqual([
        ['header', 'text', 'Criterio B · {documentName}', 'left'], ['header', 'rule', '', ''], ['footer', 'rule', '', ''],
        ['footer', 'text', '{documentName}', 'left'], ['footer', 'text', 'Pagina {pageNumber} di {totalPages}', 'right'],
      ]);
    }
    const root = await folder(), projectRoot = path.join(root, 'project'), dataRoot = path.join(root, '.private');
    await mkdir(projectRoot); await mkdir(dataRoot);
    const store = new HeaderFooterStore({ dataRoot, projectRoot, projectId: 'parent', documents: async () => [] });
    const { set } = await store.create({ name: 'Criterio B', logoPlan: 'none' });
    await store.saveDraft(set.id, SETUP_HEADER_FOOTER_DRAFT_EXAMPLE);
    expect(await store.validate(set.id)).toMatchObject({ valid: true, draftVersion: 2 });
  });

  it('accepts the logo decision when a header/footer design is created', async () => {
    const root = await folder(), projectRoot = path.join(root, 'project'), dataRoot = path.join(root, '.private');
    await mkdir(projectRoot); await mkdir(dataRoot);
    const store = new HeaderFooterStore({ dataRoot, projectRoot, projectId: 'parent', documents: async () => [] });
    const { set } = await store.create({ name: 'Criterio B', guidance: 'Intestazione e piè di pagina condivisi', logoPlan: 'none' });
    expect(set.draft.logoPlan).toBe('none');
  });
});
