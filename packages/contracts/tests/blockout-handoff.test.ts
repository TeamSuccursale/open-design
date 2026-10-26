import { describe, expect, it } from 'vitest';
import { createBlockoutDocument, createBlockoutPage, mergeBlockoutBriefDraft } from '../src/api/blockout.js';
import { blockoutHandoffSnapshot, diffBlockoutSnapshots } from '../src/api/blockout-handoff.js';

describe('Blockout update payload', () => {
  it('replaces a tracked readable request without exposing its machine file path in chat', () => {
    const draft = mergeBlockoutBriefDraft('Keep my title.\n\nAsk for alternatives.\n\nKeep my note.', 'Develop this design.', 'Ask for alternatives.');
    expect(draft).toBe('Keep my title.\n\nDevelop this design.\n\nKeep my note.');
  });
  it('replaces an unsent generated request instead of keeping contradictory actions, while retaining surrounding user notes', () => {
    const first = 'Request new proposals.\n\n[Blockout](blockouts/doc/handoffs/first.blockout-update.json)';
    const next = 'Develop the approved design.\n\n[Blockout](blockouts/doc/handoffs/second.blockout-update.json)';
    const draft = mergeBlockoutBriefDraft(`Keep my title.\n\n${first}\n\nKeep the caption.`, next);
    expect(draft).not.toContain('Request new proposals');
    expect(draft).toContain('Develop the approved design');
    expect(draft).toContain('Keep my title'); expect(draft).toContain('Keep the caption');
  });
  it('scopes the saved snapshot to the selected proposal and preserves feedback and asset references without image bytes', () => {
    const doc = createBlockoutDocument();
    doc.variants[0]!.pages[0]!.feedback = 'Keep room for a short introduction';
    doc.variants.push({ id: 'other', label: 'Other', pages: [createBlockoutPage('other-page', 'Other')] });
    const snapshot = blockoutHandoffSnapshot(doc);
    expect(snapshot.variant.id).toBe('brief');
    expect(snapshot.variant.pages[0]!.feedback).toContain('short introduction');
    expect(JSON.stringify(snapshot)).not.toContain('other-page');
    expect(doc.variants).toHaveLength(2);
  });

  it('uses stable page/block IDs to distinguish geometry, feedback, additions, removals and order changes', () => {
    const doc = createBlockoutDocument();
    doc.variants[0]!.pages.push(createBlockoutPage('detail', 'Detail'));
    const before = blockoutHandoffSnapshot(doc);
    doc.variants[0]!.pages.reverse();
    doc.variants[0]!.pages[1]!.feedback = 'Reduce the header';
    const changes = diffBlockoutSnapshots(before, blockoutHandoffSnapshot(doc));
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'proposal', fields: expect.arrayContaining(['pageOrder']) }),
      expect.objectContaining({ target: 'page', pageId: 'page-1', fields: ['feedback'], before: { feedback: '' }, after: { feedback: 'Reduce the header' } }),
    ]));
    expect(changes.filter((change) => change.operation === 'add' || change.operation === 'remove')).toHaveLength(0);
  });
});
