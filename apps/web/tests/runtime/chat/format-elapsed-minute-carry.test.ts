import { describe, expect, it } from 'vitest';
import { formatElapsed, formatShellElapsed } from '../../../src/runtime/chat/format';

describe.each([
  ['tool/step', formatElapsed],
  ['execution shell', formatShellElapsed],
] as const)('%s elapsed minute carry', (_name, format) => {
  it.each([
    [119_499, '1m 59s'],
    [119_500, '2m 0s'],
    [120_000, '2m 0s'],
    [239_499, '3m 59s'],
    [239_500, '4m 0s'],
    [239_999, '4m 0s'],
    [240_000, '4m 0s'],
  ])('formats %i ms as %s without a 60-second remainder', (elapsed, expected) => {
    expect(format(elapsed)).toBe(expected);
  });
});

it('preserves the existing sub-minute precision and unknown thresholds', () => {
  expect(formatElapsed(12_345)).toBe('12.3s');
  expect(formatShellElapsed(9_250)).toBe('9.3s');
  expect(formatShellElapsed(31_000)).toBe('31s');
  expect(formatElapsed(null)).toBeNull();
  expect(formatElapsed(-1)).toBeNull();
  expect(formatShellElapsed(undefined)).toBeNull();
  expect(formatShellElapsed(999)).toBeNull();
});
