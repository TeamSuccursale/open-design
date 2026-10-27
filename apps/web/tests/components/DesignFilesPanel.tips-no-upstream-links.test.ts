import { describe, expect, it } from 'vitest';
import { USEFUL_TIPS } from '../../src/components/DesignFilesPanel';
import { it as italian } from '../../src/i18n/locales/it';

// The rotating tips ended with invitations to the upstream project's Discord, GitHub, X, Threads,
// Instagram, YouTube, LinkedIn and Xiaohongshu. They do not serve the team's own install.
describe('design files panel tips', () => {
  it('link nowhere outside the app and send nobody to the upstream community', () => {
    expect(USEFUL_TIPS.filter((tip) => tip.url)).toEqual([]);
    expect(USEFUL_TIPS.map((tip) => italian[tip.key]).filter((text) => /Discord|GitHub|@OpenDesign/i.test(text))).toEqual([]);
    expect(USEFUL_TIPS.length).toBeGreaterThan(5);
  });
});
