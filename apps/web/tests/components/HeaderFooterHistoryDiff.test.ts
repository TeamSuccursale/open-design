import { describe, expect, it } from 'vitest';
import type { HeaderFooterVariant } from '@open-design/contracts';
import { compareHeaderFooterFormats } from '../../src/components/header-footer/history-diff';
const variant: HeaderFooterVariant = { id: 'a4', name: 'A4', pageWidthMm: 210, pageHeightMm: 297, headerHeightMm: 28, footerHeightMm: 20, blocks: [{ id: 'name', region: 'header', kind: 'text', text: 'Old', x: .1, y: .1, width: .5, height: .4 }] };
describe('recurring design history differences', () => {
  it('reports real strip heights and added/removed/changed blocks per paper format', () => {
    const selected = structuredClone(variant); selected.blocks.push({ ...selected.blocks[0]!, id: 'removed' });
    const current = structuredClone(variant); current.headerHeightMm = 34; current.blocks[0]!.text = 'New'; current.blocks.push({ ...current.blocks[0]!, id: 'added' });
    expect(compareHeaderFooterFormats([selected], [current])[0]).toMatchObject({ selectedHeaderMm: 28, currentHeaderMm: 34, selectedFooterMm: 20, currentFooterMm: 20, addedBlocks: 1, removedBlocks: 1, changedBlocks: 1 });
    expect(compareHeaderFooterFormats([selected], [current])[0]!.changedBlockDetails).toEqual([{ id: 'name', kind: 'text', region: 'header', changes: [{ property: 'text', selected: 'Old', current: 'New' }] }]);
  });
  it('identifies a separator width edit with meaningful page-relative percentages', () => {
    const selected = structuredClone(variant); selected.blocks = [{ id: 'header-rule', region: 'header', kind: 'rule', x: .08, y: .8, width: .828, height: .01 }];
    const current = structuredClone(selected); current.blocks[0]!.width = .848;
    expect(compareHeaderFooterFormats([selected], [current])[0]!.changedBlockDetails).toEqual([{ id: 'header-rule', kind: 'rule', region: 'header', changes: [{ property: 'width', selected: '82.8%', current: '84.8%' }] }]);
  });
  it('keeps added and removed formats distinct without turning missing heights into zero', () => {
    const a3 = { ...structuredClone(variant), id: 'a3', name: 'A3', pageWidthMm: 420, pageHeightMm: 297 };
    const differences = compareHeaderFooterFormats([variant], [a3]);
    expect(differences).toHaveLength(2); expect(differences[0]).toMatchObject({ widthMm: 210, currentHeaderMm: null, removedBlocks: 1 }); expect(differences[1]).toMatchObject({ widthMm: 420, selectedHeaderMm: null, addedBlocks: 1 });
  });
});
