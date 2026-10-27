import { describe, expect, it as test } from 'vitest';
import { documentConversationEn, documentConversationIt } from '../../src/i18n/document-conversation';

// The notice shows while the texts are read, before the image option appears, and the option then
// appears already ticked. In flow run 3 (27 October) the notice said images were processed only on
// request, and the gallery started from the ticked default.
describe('notice shown while the texts are read', () => {
  test('does not say that images wait for an opt-in', () => {
    expect(documentConversationEn['documentChat.reading']).not.toMatch(/only if/i);
    expect(documentConversationIt['documentChat.reading']).not.toMatch(/solo se/i);
  });
});
