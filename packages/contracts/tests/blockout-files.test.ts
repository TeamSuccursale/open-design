import { describe, expect, it } from 'vitest';
import { BLOCKOUT_PROPOSAL_SELECT, blockoutComparisonDocumentFromHtml, blockoutProposalSelectMessage, blockoutFileTarget, blockoutPageFiles, blockoutPageForFile, blockoutWorkspacePath, createBlockoutDocument, createBlockoutPage, isBlockoutFile, isInternalBlockoutFile } from '../src/index.js';

describe('page-scoped blockout files', () => {
  it('recognizes only explicit comparison markers in arbitrary HTML entrypoints', () => {
    expect(blockoutComparisonDocumentFromHtml('<head><meta name="melillodesign-blockout-document" content="document-1"></head>')).toBe('document-1');
    expect(blockoutComparisonDocumentFromHtml('<h1>A discussion about blockouts</h1>')).toBeNull();
    expect(blockoutComparisonDocumentFromHtml('<meta name="melillodesign-blockout-document" content="../private">')).toBeNull();
  });
  it('validates a deliberate choose-and-edit page target', () => {
    const message = { type: BLOCKOUT_PROPOSAL_SELECT, documentId: 'report', variantId: 'text-led', editPageId: 'page-3' };
    expect(blockoutProposalSelectMessage(message)).toEqual(message);
    expect(blockoutProposalSelectMessage({ ...message, editPageId: '../../secrets' })).toBeNull();
    expect(blockoutProposalSelectMessage({ ...message, editPageId: '..' })).toBeNull();
    expect(blockoutProposalSelectMessage({ ...message, editPageId: 3 })).toBeNull();
  });
  it('recognizes only blockout identities and keeps ordinary JSON ordinary', () => {
    expect(isBlockoutFile('data/results.json')).toBe(false);
    expect(isBlockoutFile('proposal-a.json')).toBe(false);
    expect(isBlockoutFile('blockouts/report/cover.blockout.json')).toBe(true);
    expect(blockoutFileTarget('blockouts/report/cover.blockout.json')).toEqual({ documentId: 'report', pageId: 'cover' });
    expect(isBlockoutFile('blockout/proposal-a.json')).toBe(true);
    expect(isInternalBlockoutFile('blockout/starting-point.json')).toBe(true);
    expect(isInternalBlockoutFile('blockouts/report/cover.blockout.json')).toBe(false);
    expect(() => blockoutWorkspacePath('..')).toThrow();
  });
  it('groups editable alternatives by document and page', () => {
    const doc = createBlockoutDocument(); doc.documentId = 'report';
    doc.variants[0]!.pages.push(createBlockoutPage('cover', 'Cover'));
    doc.variants.push({ ...structuredClone(doc.variants[0]!), id: 'alternative', label: 'Alternative' });
    const files = blockoutPageFiles(doc);
    expect(files.map((file) => file.path)).toEqual(['blockouts/report/page-1.blockout.json', 'blockouts/report/cover.blockout.json']);
    const cover = JSON.parse(files[1]!.content);
    expect(cover.type).toBe('blockout-page');
    expect(cover.variants).toHaveLength(2);
    expect(cover.variants.every((variant: { page: { id: string } }) => variant.page.id === 'cover')).toBe(true);
  });
  it('groups corresponding pages when native agents use proposal-scoped IDs', () => {
    const doc = createBlockoutDocument(); doc.variants[0]!.pages.push(createBlockoutPage('method', 'Method'));
    doc.variants.push({ id: 'b', label: 'B', pages: [createBlockoutPage('b-cover', 'B cover'), createBlockoutPage('b-method', 'B method')] });
    expect(blockoutPageFiles(doc)).toHaveLength(2);
    expect(JSON.parse(blockoutPageFiles(doc)[1]!.content).variants).toHaveLength(2);
    expect(blockoutPageForFile(doc, 'b', 'method')?.id).toBe('b-method');
  });
  it('keeps filenames unique when proposals have different page counts and reorder shared identities', () => {
    const doc = createBlockoutDocument();
    doc.variants.push({ id: 'b', label: 'B', pages: [createBlockoutPage('page-2', 'Second content'), createBlockoutPage('page-1', 'First content')] });
    const files = blockoutPageFiles(doc);
    expect(files.map((file) => file.path)).toEqual(['blockouts/document-1/page-1.blockout.json', 'blockouts/document-1/_page-position-2.blockout.json']);
    expect(JSON.parse(files[1]!.content)).toMatchObject({ pageNumber: 2, pageId: '_page-position-2' });
    expect(blockoutPageForFile(doc, 'b', 'page-1')?.id).toBe('page-2');
    expect(blockoutPageForFile(doc, 'b', '_page-position-2')?.id).toBe('page-1');
    expect(blockoutPageForFile(doc, 'brief', '_page-position-2')).toBeUndefined();
  });
  it('avoids collisions with real page IDs that happen to resemble positional fallbacks', () => {
    const doc = createBlockoutDocument(); doc.variants[0]!.pages[0]!.id = '_page-position-2';
    doc.variants.push({ id: 'b', label: 'B', pages: [createBlockoutPage('other', ''), createBlockoutPage('_page-position-2', '')] });
    const files = blockoutPageFiles(doc);
    expect(files[1]!.path).toBe('blockouts/document-1/_page-position-2-2.blockout.json');
    expect(blockoutPageForFile(doc, 'b', '_page-position-2')?.id).toBe('other');
    expect(blockoutPageForFile(doc, 'b', '_page-position-2-2')?.id).toBe('_page-position-2');
  });
});
