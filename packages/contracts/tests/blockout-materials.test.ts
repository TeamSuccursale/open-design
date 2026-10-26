import { describe, expect, it } from 'vitest';
import { BlockoutMaterialInventorySchema, BlockoutMaterialItemSchema, blockoutMaterialText } from '../src/api/blockout-materials.js';
import { BlockoutDocumentSchema, createBlockoutDocument, renderBlockoutBrief } from '../src/api/blockout.js';

describe('source material bindings', () => {
  it('preserves optional revision, document selection and block typography in the editable source and brief', () => {
    const old = createBlockoutDocument(); expect(BlockoutDocumentSchema.parse(old).materialRevision).toBeUndefined();
    old.materialRevision = 'a'.repeat(64); old.materialIds = ['material-one'];
    old.variants[0]!.pages[0]!.role = 'body';
    old.variants[0]!.pages[0]!.blocks.push({ id: 'block-one', label: 'Body', kind: 'text', box: { x: 10, y: 10, width: 80, height: 30, rotation: 0 }, lockRatio: false, images: [],
      expectation: 'Exact source body', references: [], feedback: '', flexibility: 'guided', contentIds: ['material-one'], materialRole: 'content',
      typography: { fontFamily: 'Arial', fontSizePt: 11, lineHeight: 1.5, paddingMm: 2 } });
    const parsed = BlockoutDocumentSchema.parse(old), brief = renderBlockoutBrief(parsed);
    expect(parsed.materialIds).toEqual(['material-one']);
    expect(brief).toContain('"materialRevision"'); expect(brief).toContain('"materialIds"');
    expect(brief).toContain('"contentIds"'); expect(brief).toContain('"fontSizePt": 11'); expect(brief).toContain('"materialRole": "content"');
  });
  it('requires exact text offsets, source hashes and actual visual dimensions without accepting external image paths', () => {
    const common = { id: 'one', label: 'Original', sourcePath: 'source.pdf', sourcePage: 1, sourceHash: 'a'.repeat(64), sourceRole: 'content' };
    expect(BlockoutMaterialItemSchema.parse({ ...common, kind: 'text', text: 'Exact text', offsetStart: 0, offsetEnd: 10 }).kind).toBe('text');
    expect(BlockoutMaterialItemSchema.safeParse({ ...common, kind: 'text', text: 'Summary' }).success).toBe(false);
    expect(BlockoutMaterialItemSchema.safeParse({ ...common, kind: 'text', text: 'Exact', offsetStart: 0, offsetEnd: 50 }).success).toBe(false);
    for (const imagePath of ['C:/outside.png', '../outside.png', '/outside.png']) expect(BlockoutMaterialItemSchema.safeParse({ ...common, kind: 'image', imagePath, width: 10, height: 10 }).success).toBe(false);
    expect(BlockoutMaterialItemSchema.safeParse({ ...common, kind: 'image', imagePath: 'source.png', width: 0, height: 10 }).success).toBe(false);
    expect(BlockoutMaterialInventorySchema.safeParse({ version: 1, items: [] }).success).toBe(false);
  });
  it('composes contiguous source spans verbatim and separates noncontiguous spans consistently', () => {
    const base = { id: 'a', label: '', sourcePath: 'source.pdf', sourcePage: 1, sourceHash: 'a'.repeat(64), sourceRole: 'content' as const, kind: 'text' as const };
    const first = { ...base, text: 'Paragrafo 😀\r\n\r\n', offsetStart: 0, offsetEnd: 16 };
    const second = { ...base, id: 'b', text: 'Secondo', offsetStart: 16, offsetEnd: 23 };
    expect(blockoutMaterialText([first, second])).toBe('Paragrafo 😀\r\n\r\nSecondo');
    expect(blockoutMaterialText([first, { ...second, sourcePage: 2 }])).toBe(`${first.text}\n\nSecondo`);
    expect(blockoutMaterialText([first, { ...second, offsetStart: 99 }])).toBe(`${first.text}\n\nSecondo`);
  });
});
