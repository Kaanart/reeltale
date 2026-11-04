import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { colors } from '../../theme/tokens.ts';

// WCAG 2.2 contrast of the colour tokens that carry text (1.4.3: 4.5:1 for normal text, 3:1 for large text and
// for the parts of controls, 1.4.11). The brand accent (#E8553D) is decoration only; text on or in the accent
// uses accentStrong.

/** Relative luminance of a #RRGGBB colour (WCAG 2.x definition). */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(m[1]!.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, 1 to 21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Hue in degrees of a #RRGGBB colour. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const AA = 4.5;

test('the contrast function matches known values', () => {
  assert.equal(contrast('#000000', '#FFFFFF'), 21);
  assert.equal(contrast('#FFFFFF', '#FFFFFF'), 1);
  assert.equal(contrast('#777777', '#FFFFFF').toFixed(2), '4.48', 'the classic just-below-AA grey');
  assert.equal(contrast('#FFFFFF', '#E8553D'), contrast('#E8553D', '#FFFFFF'), 'symmetric');
  assert.throws(() => contrast('red', '#FFFFFF'));
});

test('white on the brand accent is below AA, which is why accentStrong exists', () => {
  const ratio = contrast(colors.surface, colors.accent);
  assert.ok(ratio < AA, `${ratio.toFixed(2)}:1`);
  assert.equal(ratio.toFixed(1), '3.6');
});

test('text on accentStrong passes AA, pressed too, and it stays in the accent’s hue family', () => {
  assert.equal(colors.onAccent, '#FFFFFF');
  for (const bg of [colors.accentStrong, colors.accentStrongPressed]) {
    const ratio = contrast(colors.onAccent, bg);
    assert.ok(ratio >= AA, `white on ${bg}: ${ratio.toFixed(2)}:1`);
  }
  assert.ok(contrast(colors.onAccent, colors.accentStrongPressed) > contrast(colors.onAccent, colors.accentStrong), 'pressed is darker');
  assert.ok(Math.abs(hue(colors.accentStrong) - hue(colors.accent)) <= 4, `hue ${hue(colors.accentStrong).toFixed(1)} vs ${hue(colors.accent).toFixed(1)}`);
});

test('accentStrong works as text on every page surface (ghost buttons)', () => {
  for (const bg of [colors.bg, colors.surface, colors.surfaceAlt]) {
    const ratio = contrast(colors.accentStrong, bg);
    assert.ok(ratio >= AA, `accentStrong on ${bg}: ${ratio.toFixed(2)}:1`);
  }
});

test('body text colours pass AA on every surface, and the brand accent still reads as a control edge (3:1)', () => {
  for (const fg of [colors.ink, colors.inkMuted]) {
    for (const bg of [colors.bg, colors.surface, colors.surfaceAlt]) {
      const ratio = contrast(fg, bg);
      assert.ok(ratio >= AA, `${fg} on ${bg}: ${ratio.toFixed(2)}:1`);
    }
  }
  // The top bar marks the active link with an accent underline next to ink text.
  assert.ok(contrast(colors.accent, colors.surface) >= 3);
  // White on the AI badge.
  assert.ok(contrast(colors.surface, colors.ai) >= AA);
});

const src = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, src), 'utf8');

test('the primary button and the selected tag chip sit on accentStrong with onAccent text', () => {
  const button = read('components/ui/Button.tsx');
  assert.match(button, /primary: \{ backgroundColor: colors\.accentStrong \}/);
  assert.match(button, /primaryPressed: \{ backgroundColor: colors\.accentStrongPressed \}/);
  assert.match(button, /primary: 'onAccent'/);
  assert.match(button, /ghost: 'accentStrong'/);
  assert.doesNotMatch(button, /colors\.accent\b(?!Strong)/, 'no text-bearing surface uses the brand accent');
  const chip = read('components/ui/TagChip.tsx');
  assert.match(chip, /selected: \{ backgroundColor: colors\.accentStrong \}/);
  assert.match(chip, /selected \? 'onAccent'/);
  assert.doesNotMatch(chip, /colors\.accent\b(?!Strong)/);
});
