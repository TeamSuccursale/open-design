import { describe, expect, it as test } from 'vitest';
import { it } from '../../src/i18n/locales/it';

// The queued message's leading button stops the run in progress and sends the message at once
// (w117-queue-steer-interrupt). In flow run 2 (27 October) the queued A3 design request sat under the
// report's design run, which takes about 11 minutes, behind a button labelled «Guida questo turno».
describe('Italian label of the queued message send-now button', () => {
  test('says that it interrupts the run in progress', () => {
    expect(it['chat.queuedSteer']).toMatch(/^Interrompi/);
    expect(it['chat.queuedSteer']).not.toMatch(/Guida/);
  });
});
