import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { measureBlockoutMaterials } from '../src/services/blockout-fit-measurement.js';

const availableArial = existsSync('C:/Windows/Fonts/arial.ttf') || existsSync('/Library/Fonts/arial.ttf') || existsSync('/usr/share/fonts/truetype/msttcorefonts/arial.ttf');
const bundled = path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const python = process.env.MELILLO_PYTHON || (existsSync(bundled) ? bundled : 'python');
const pillowAvailable = (() => { try { execFileSync(python, ['-c', 'from PIL import ImageFont'], { windowsHide: true, stdio: 'ignore' }); return true; } catch { return false; } })();
describe('physical preserved-font text measurement', () => {
  it.skipIf(!availableArial || !pillowAvailable)('wraps real Arial glyph advances rather than a character/word density heuristic', async () => {
    const common = { fontFamily: 'Arial', fontSizePt: 11, lineHeight: 1.5, widthMm: 30 };
    const { texts: [narrow, wide] } = await measureBlockoutMaterials([{ ...common, text: 'iiiiiiiiiiiiiiiiiiii' }, { ...common, text: 'WWWWWWWWWWWWWWWWWWWW' }]);
    expect(narrow?.status).toBe('measured'); expect(wide?.status).toBe('measured');
    expect(narrow!.lines).toHaveLength(1); expect(wide!.lines.length).toBeGreaterThan(narrow!.lines.length);
    expect(wide!.lines.map((line) => line.text).join('')).toBe('WWWWWWWWWWWWWWWWWWWW');
    expect(wide!.heightMm).toBeCloseTo(wide!.lines.length * 11 * 1.5 * 25.4 / 72, 8);
    expect(wide!.fontSizePt).toBe(11); expect(wide!.fontHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it.skipIf(!availableArial || !pillowAvailable)('preserves explicit paragraph breaks and requested line height without shrinking type', async () => {
    const { texts: [value] } = await measureBlockoutMaterials([{ text: 'First paragraph\n\nSecond paragraph', fontFamily: 'Arial', fontSizePt: 12, lineHeight: 1.5, widthMm: 150 }]);
    expect(value!.status).toBe('measured'); expect(value!.lines.map((line) => line.text)).toEqual(['First paragraph', '', 'Second paragraph']);
    expect(value!.heightMm).toBeCloseTo(3 * 12 * 1.5 * 25.4 / 72, 8);
  });
  it.skipIf(!availableArial || !pillowAvailable)('normalizes CRLF only for layout, without measuring a carriage return glyph', async () => {
    const request = { fontFamily: 'Arial', fontSizePt: 11, lineHeight: 1.5, widthMm: 150 };
    const { texts: [crlf, lf] } = await measureBlockoutMaterials([{ ...request, text: 'First\r\nSecond\rThird' }, { ...request, text: 'First\nSecond\nThird' }]);
    expect(crlf!.status).toBe('measured'); expect(crlf!.lines).toEqual(lf!.lines); expect(crlf!.heightMm).toBe(lf!.heightMm);
  });
  it('never passes an unavailable font by substituting a generic font', async () => {
    const { texts: [value] } = await measureBlockoutMaterials([{ text: 'Source text', fontFamily: 'Uninstalled Personal Font', fontSizePt: 11, lineHeight: 1.5, widthMm: 100 }]);
    expect(value!.status).toBe('unavailable'); expect(value!.lines).toEqual([]); expect(value!.limitations.length).toBeGreaterThan(0);
  });
  it.skipIf(!pillowAvailable)('does not invent a tab-stop width for source-aligned text', async () => {
    const { texts: [value] } = await measureBlockoutMaterials([{ text: 'Label\tValue', fontFamily: 'Arial', fontSizePt: 11, lineHeight: 1.5, widthMm: 100 }]);
    expect(value!.status).toBe('unavailable'); expect(value!.lines).toEqual([]); expect(value!.limitations.join(' ')).toMatch(/Tab-stop/);
  });
  it.skipIf(!availableArial || !pillowAvailable)('reports missing source glyphs or unavailable complex-script shaping instead of a fit pass', async () => {
    const { texts: [value] } = await measureBlockoutMaterials([{ text: 'مرحبا', fontFamily: 'Arial', fontSizePt: 11, lineHeight: 1.5, widthMm: 100 }]);
    expect(value!.status).toBe('unavailable'); expect(value!.limitations.join(' ')).toMatch(/shaping|glyph/);
  });
});
