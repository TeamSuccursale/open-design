import { describe, expect, it } from 'vitest';
import { createBlockoutDocument, createBlockoutPage } from '../src/api/blockout.js';
import { assessBlockoutStructure } from '../src/api/blockout-structure.js';

const body = (id = 'argument') => ({ id, label: 'Continuous argument', kind: 'text' as const, designRole: 'body' as const,
  box: { x: 10, y: 15, width: 75, height: 70, rotation: 0 }, lockRatio: false,
  images: [], references: [], expectation: 'Main reasoning, about 400 words later', feedback: '', flexibility: 'guided' as const });
describe('empty functional Blockout structure', () => {
  it('validates eight A4 pages without any image inventory or source text and makes no content-fit claim', () => {
    const document = createBlockoutDocument(); document.title = 'Descriptive report'; document.pageBudget = { mode: 'maximum', limit: 8, target: 8 };
    document.variants[0]!.pages = Array.from({ length: 8 }, (_, index) => ({ ...createBlockoutPage(`page-${index + 1}`, 'Argument'), blocks: [body()] }));
    const result = assessBlockoutStructure(document, { documentRevision: 'source-revision' });
    expect(result).toMatchObject({ basis: 'structure', status: 'ready', inventoryRevision: null, materialRevision: null, selectedContentIds: [] });
    expect(result.variants[0]!.pages).toHaveLength(8);
    expect(result.variants[0]!.pages[0]!.blocks[0]!.text).toBeUndefined();
    expect(result.limitations.join(' ')).toContain('have not been measured');
  });
  it('allows a described watermark behind text, while warning for a normal block outside the safe margin', () => {
    const document = createBlockoutDocument(), page = document.variants[0]!.pages[0]!;
    page.blocks = [body(), { ...body('watermark'), designRole: 'background', expectation: 'Faint project watermark behind text' }];
    expect(assessBlockoutStructure(document, { documentRevision: 'r' }).status).toBe('ready');
    page.blocks[0]!.box.x = 0;
    const result = assessBlockoutStructure(document, { documentRevision: 'r2' });
    expect(result.status).toBe('warning');
    expect(result.variants[0]!.pages[0]!.blocks[0]!.issues[0]!.code).toBe('structure-outside-safe-area');
  });
  it('keeps a source maximum separate from an exact planning target and catches pages beyond the ceiling', () => {
    const document = createBlockoutDocument(); document.pageBudget = { mode: 'maximum', limit: 8 };
    document.variants[0]!.pages[0]!.blocks = [body()];
    expect(assessBlockoutStructure(document, { documentRevision: 'r' }).status).toBe('ready');
    document.pageBudget = { mode: 'maximum', limit: 1 };
    document.variants[0]!.pages.push({ ...createBlockoutPage('second', 'Detail'), blocks: [body()] });
    expect(assessBlockoutStructure(document, { documentRevision: 'r' }).status).toBe('blocked');
  });
});
