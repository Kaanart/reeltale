import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FocusBox } from '@reeltale/shared';
import {
  captionPlacement, CAPTION_BAND, comicTimeline, countWords, hasNarrationAudio, interpolateView, kenBurns,
  KB_FALLBACK_SCALE, KB_MAX_SCALE, KB_MIN_SCALE, MAX_PANEL_MS, MIN_NARRATED_PANEL_MS, MIN_PANEL_MS, orderedPanels,
  panelDurations, panelIndexAt, panelWordCount, planComic, READING_WORDS_PER_SECOND, revealPlan, toPixelTransform,
  viewCentredOn, viewCoversStage, type KenBurns, type ViewTransform,
} from '../comic.ts';
import { makeManifest, words } from './comic-fixture.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not close to ${b}`);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const NARRATED = (ms: number | null, audio: string | null = 'ai/x/narration.mp3') => ({ narration: { audio, duration_ms: ms } });

// ---- Words and timing ----------------------------------------------------------------------------

test('countWords counts words, not punctuation', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   '), 0);
  assert.equal(countWords('Hello'), 1);
  assert.equal(countWords('Hello world'), 2);
  assert.equal(countWords('  Hello \n  world\t again '), 3);
  assert.equal(countWords('Wait... what?!'), 2);
  assert.equal(countWords('a — b'), 2);                 // the dash alone is not a word
  assert.equal(countWords('... — ?!'), 0);
  assert.equal(countWords('a well-known fact'), 3);
  assert.equal(countWords('It’s “fine”.'), 2);
  assert.equal(countWords('Café déjà vu'), 3);
  assert.equal(countWords('3 AM'), 2);
});

test('panelWordCount is the caption plus the dialogue lines, not the speaker names', () => {
  const m = makeManifest([{ caption: words(5), dialogue: [words(3), words(4)] }]);
  assert.equal(panelWordCount(m.panels[0]!), 12);
  assert.equal(panelWordCount(makeManifest([{}]).panels[0]!), 0);
});

test('reading speed is about 3.3 words a second', () => {
  assert.equal(READING_WORDS_PER_SECOND, 3.3);
  // 33 words at 3.3 words/s is exactly 10 s.
  assert.deepEqual(panelDurations(makeManifest([{ caption: words(33) }])).slice(0, 1), [10_000]);
});

test('panelDurations without narration: reading time, clamped, whole milliseconds', () => {
  const m = makeManifest([
    {},                                   // no text: minimum
    { caption: words(10) },               // 10 / 3.3 s = 3030.3 ms
    { caption: words(30), dialogue: [words(25), words(25)] },  // 80 words = 24 s: maximum
    { caption: words(2) },                // 606 ms: minimum
  ]);
  assert.deepEqual(panelDurations(m), [MIN_PANEL_MS, 3030, MAX_PANEL_MS, MIN_PANEL_MS]);
  assert.ok(panelDurations(m).every(Number.isInteger));
});

test('panelDurations honours options and ignores nonsense ones', () => {
  const m = makeManifest([{ caption: words(10) }]);
  assert.equal(panelDurations(m, { wordsPerSecond: 2 })[0], 5000);
  assert.equal(panelDurations(m, { minPanelMs: 4000 })[0], 4000);
  assert.equal(panelDurations(m, { maxPanelMs: 3000 })[0], 3000);
  // A maximum below the minimum can't squeeze a panel under the minimum.
  assert.equal(panelDurations(m, { minPanelMs: 4000, maxPanelMs: 1000 })[0], 4000);
  for (const bad of [0, -1, Number.NaN, Infinity]) {
    assert.equal(panelDurations(m, { wordsPerSecond: bad })[0], 3030, `wordsPerSecond ${bad}`);
    assert.equal(panelDurations(makeManifest([{}]), { minPanelMs: bad })[0], MIN_PANEL_MS, `minPanelMs ${bad}`);
  }
});

test('narration audio is only used when it has both a file and a length', () => {
  assert.equal(hasNarrationAudio(makeManifest([], NARRATED(20_000))), true);
  assert.equal(hasNarrationAudio(makeManifest([], NARRATED(20_000, null))), false);
  assert.equal(hasNarrationAudio(makeManifest([], NARRATED(null))), false);
  assert.equal(hasNarrationAudio(makeManifest([], NARRATED(0))), false);
  // Without a usable audio length the panels fall back to reading time.
  const text = [{ caption: words(10) }];
  assert.deepEqual(panelDurations(makeManifest(text, NARRATED(20_000, null))), [3030, 2500, 2500, 2500]);
  assert.deepEqual(panelDurations(makeManifest(text, NARRATED(0))), [3030, 2500, 2500, 2500]);
});

test('narration length is split between the panels and adds up exactly', () => {
  const m = makeManifest([{ caption: words(10) }, {}, {}, { caption: words(33) }], NARRATED(20_000));
  const d = panelDurations(m);
  assert.equal(d.length, 4);
  assert.equal(sum(d), 20_000);
  assert.ok(d.every((x) => x >= MIN_NARRATED_PANEL_MS && Number.isInteger(x)));
  assert.ok(d[3]! > d[0]! && d[0]! > d[1]!, 'wordier panels get more of the narration');
  assert.ok(Math.abs(d[1]! - d[2]!) <= 1, 'equal panels get equal shares (within a millisecond)');
});

test('narration split is exact, and the leftover milliseconds go to the earliest panels', () => {
  const quiet = makeManifest([], NARRATED(10_000));
  assert.deepEqual(panelDurations(quiet), [2500, 2500, 2500, 2500]);
  assert.deepEqual(panelDurations(makeManifest([], NARRATED(10_001))), [2501, 2500, 2500, 2500]);
  assert.deepEqual(panelDurations(makeManifest([], NARRATED(10_003))), [2501, 2501, 2501, 2500]);
});

test('a very short narration is shared out without cutting below zero or losing milliseconds', () => {
  assert.deepEqual(panelDurations(makeManifest([], NARRATED(3))), [1, 1, 1, 0]);
  const d = panelDurations(makeManifest([{ caption: words(20) }], NARRATED(5_000)));
  assert.equal(sum(d), 5000);
  assert.ok(d.every((x) => x >= 1250), 'too short for the per-panel floor, so it is split evenly first');
});

test('a long narration is not capped per panel: it sets the pace', () => {
  const d = panelDurations(makeManifest([], NARRATED(120_000)));
  assert.equal(sum(d), 120_000);
  assert.ok(d.every((x) => x === 30_000));
});

test('orderedPanels sorts by n without touching the manifest', () => {
  const m = makeManifest([{ caption: 'one' }, { caption: 'two' }, { caption: 'three' }, { caption: 'four' }]);
  const scrambled = { ...m, panels: [m.panels[2]!, m.panels[0]!, m.panels[3]!, m.panels[1]!] };
  assert.deepEqual(orderedPanels(scrambled).map((p) => p.n), [1, 2, 3, 4]);
  assert.deepEqual(scrambled.panels.map((p) => p.n), [3, 1, 4, 2]);
});

test('comicTimeline lays panels end to end', () => {
  const m = makeManifest([{ caption: words(10) }, {}, { caption: words(33) }, {}]);
  const t = comicTimeline(m);
  assert.deepEqual(t.panels, [
    { n: 1, startMs: 0, endMs: 3030, durationMs: 3030 },
    { n: 2, startMs: 3030, endMs: 5530, durationMs: 2500 },
    { n: 3, startMs: 5530, endMs: 15_530, durationMs: 10_000 },
    { n: 4, startMs: 15_530, endMs: 18_030, durationMs: 2500 },
  ]);
  assert.equal(t.totalMs, 18_030);
  assert.equal(t.narrated, false);
  const n = comicTimeline(makeManifest([], NARRATED(24_000)));
  assert.equal(n.totalMs, 24_000);
  assert.equal(n.narrated, true);
  assert.equal(n.panels.at(-1)?.endMs, 24_000);
});

test('panelIndexAt finds the panel on screen at a position', () => {
  const t = comicTimeline(makeManifest([]));   // four panels of 2500 ms
  assert.equal(panelIndexAt(t, 0), 0);
  assert.equal(panelIndexAt(t, 2499), 0);
  assert.equal(panelIndexAt(t, 2500), 1);
  assert.equal(panelIndexAt(t, 7499), 2);
  assert.equal(panelIndexAt(t, 7500), 3);
  assert.equal(panelIndexAt(t, 9999), 3);
  assert.equal(panelIndexAt(t, 10_000), 3);
  assert.equal(panelIndexAt(t, 1e9), 3);
  assert.equal(panelIndexAt(t, -5), 0);
  assert.equal(panelIndexAt(t, Number.NaN), 0);
  assert.equal(panelIndexAt({ panels: [], totalMs: 0, narrated: false }, 100), 0);
});

// ---- Ken Burns -----------------------------------------------------------------------------------

test('viewCentredOn centres the point when the image allows it', () => {
  const v = viewCentredOn(0.5, 0.5, 1.25);
  assert.deepEqual(v, { scale: 1.25, translateX: 0, translateY: 0 });
  const w = viewCentredOn(0.55, 0.45, 1.25);
  // The chosen point lands in the middle of the stage: 0.5 + s * (p - 0.5) + t = 0.5.
  close(0.5 + 1.25 * (0.55 - 0.5) + w.translateX, 0.5);
  close(0.5 + 1.25 * (0.45 - 0.5) + w.translateY, 0.5);
});

test('viewCentredOn stops at the image edge instead of showing outside it', () => {
  // At 1.25x the window is 80% of the image, so its centre can only reach 0.4..0.6.
  const left = viewCentredOn(0, 0.5, 1.25);
  close(left.translateX, 0.125);
  const right = viewCentredOn(1, 0.5, 1.25);
  close(right.translateX, -0.125);
  const top = viewCentredOn(0.5, 0, 1.25);
  close(top.translateY, 0.125);
  assert.ok(viewCoversStage(left) && viewCoversStage(right) && viewCoversStage(top));
});

test('viewCentredOn is safe with odd input', () => {
  assert.deepEqual(viewCentredOn(Number.NaN, Number.NaN, 1.2), viewCentredOn(0.5, 0.5, 1.2));
  assert.deepEqual(viewCentredOn(0.3, 0.3, Number.NaN), { scale: 1, translateX: 0, translateY: 0 });
  assert.deepEqual(viewCentredOn(0.3, 0.3, 0.5), { scale: 1, translateX: 0, translateY: 0 });   // never zooms out past the image
  assert.ok(viewCoversStage(viewCentredOn(-3, 7, 1.25)));
  assert.ok(Object.is(viewCentredOn(0.5, 0.5, 1).translateX, 0), 'no negative zero');
});

test('viewCoversStage says when the image no longer covers the stage', () => {
  assert.equal(viewCoversStage({ scale: 1, translateX: 0, translateY: 0 }), true);
  assert.equal(viewCoversStage({ scale: 1.25, translateX: 0.125, translateY: -0.125 }), true);
  assert.equal(viewCoversStage({ scale: 1.25, translateX: 0.13, translateY: 0 }), false);
  assert.equal(viewCoversStage({ scale: 1.25, translateX: 0, translateY: -0.2 }), false);
  assert.equal(viewCoversStage({ scale: 0.9, translateX: 0, translateY: 0 }), false);
  assert.equal(viewCoversStage({ scale: 1, translateX: 0.01, translateY: 0 }), false);
  assert.equal(viewCoversStage({ scale: Number.NaN, translateX: 0, translateY: 0 }), false);
});

/** A grid of boxes, including edge, oversized, off-image and degenerate ones. */
function boxes(): FocusBox[] {
  const out: FocusBox[] = [];
  const steps = [0, 0.05, 0.2, 0.45, 0.5, 0.8, 0.95, 1];
  for (const x of steps) for (const y of steps) for (const w of [0, 0.01, 0.1, 0.4, 0.9, 1]) for (const h of [0, 0.1, 0.5, 1]) out.push({ x, y, w, h });
  return out;
}

test('Ken Burns never shows anything outside the image, at either end or anywhere between', () => {
  const grid = boxes();
  assert.ok(grid.length > 1000);
  for (const box of grid) {
    for (const n of [1, 2, 3, 4]) {
      const kb = kenBurns(box, n);
      assert.ok(viewCoversStage(kb.from), `from ${JSON.stringify(box)} n=${n}`);
      assert.ok(viewCoversStage(kb.to), `to ${JSON.stringify(box)} n=${n}`);
      for (let i = 0; i <= 20; i++) {
        const mid = interpolateView(kb.from, kb.to, i / 20);
        assert.ok(viewCoversStage(mid), `mid ${i} ${JSON.stringify(box)} n=${n}`);
        assert.ok(Number.isFinite(mid.scale) && Number.isFinite(mid.translateX) && Number.isFinite(mid.translateY));
      }
    }
  }
  for (const n of [1, 2]) {
    const kb = kenBurns(null, n);
    assert.ok(viewCoversStage(kb.from) && viewCoversStage(kb.to));
  }
});

test('Ken Burns zoom is gentle: within the limits, and only the whole image or the close framing', () => {
  for (const box of boxes()) {
    const kb = kenBurns(box, 1);
    assert.deepEqual(kb.from, { scale: 1, translateX: 0, translateY: 0 });
    assert.ok(kb.to.scale >= KB_MIN_SCALE - 1e-12 && kb.to.scale <= KB_MAX_SCALE + 1e-12, `scale ${kb.to.scale}`);
  }
});

test('Ken Burns zoom depends on how much of the image the subject fills', () => {
  close(kenBurns({ x: 0.45, y: 0.45, w: 0.1, h: 0.1 }, 1).to.scale, KB_MAX_SCALE);    // small subject: full gentle zoom
  close(kenBurns({ x: 0.1, y: 0.1, w: 0.8, h: 0.5 }, 1).to.scale, 0.9 / 0.8);          // 1.125
  close(kenBurns({ x: 0, y: 0, w: 1, h: 1 }, 1).to.scale, KB_MIN_SCALE);               // fills the frame: barely moves
  close(kenBurns({ x: 0.2, y: 0.2, w: 0.1, h: 0.6 }, 1).to.scale, KB_MAX_SCALE);       // the longer side counts: 0.9/0.6 = 1.5 -> capped
  close(kenBurns({ x: 0.2, y: 0.2, w: 0.72, h: 0.1 }, 1).to.scale, 1.25);              // 0.9/0.72 = 1.25 exactly
});

test('Ken Burns is centred on the focus box centre', () => {
  const box = { x: 0.4, y: 0.35, w: 0.2, h: 0.2 };   // centre (0.5, 0.45)
  const kb = kenBurns(box, 1);
  assert.equal(kb.direction, 'in');
  // Under the close framing the box centre sits in the middle of the stage.
  close(0.5 + kb.to.scale * (0.5 - 0.5) + kb.to.translateX, 0.5);
  close(0.5 + kb.to.scale * (0.45 - 0.5) + kb.to.translateY, 0.5);
  // A box off-centre but reachable is centred too.
  const off = { x: 0.5, y: 0.45, w: 0.1, h: 0.1 };    // centre (0.55, 0.5)
  const kb2 = kenBurns(off, 1);
  close(0.5 + kb2.to.scale * (0.55 - 0.5) + kb2.to.translateX, 0.5);
});

test('a subject near an edge is centred as far as the image allows, and no further', () => {
  const kb = kenBurns({ x: 0, y: 0.4, w: 0.1, h: 0.2 }, 1);    // hugging the left edge
  close(kb.to.scale, KB_MAX_SCALE);
  close(kb.to.translateX, (KB_MAX_SCALE - 1) / 2);              // image left edge meets the stage left edge
  assert.ok(viewCoversStage(kb.to));
});

test('odd panels zoom in and even panels zoom out, so each ends where the next begins', () => {
  const box = { x: 0.3, y: 0.3, w: 0.2, h: 0.2 };
  const a = kenBurns(box, 1);
  const b = kenBurns(box, 2);
  const c = kenBurns(box, 3);
  assert.deepEqual([a.direction, b.direction, c.direction], ['in', 'out', 'in']);
  assert.deepEqual(b.from, a.to);
  assert.deepEqual(b.to, c.from);
  assert.deepEqual(kenBurns(box, 4).direction, 'out');
});

test('with no focus box the zoom aims at the middle', () => {
  const kb = kenBurns(null, 1);
  assert.deepEqual(kb.from, { scale: 1, translateX: 0, translateY: 0 });
  assert.deepEqual(kb.to, { scale: KB_FALLBACK_SCALE, translateX: 0, translateY: 0 });
});

test('Ken Burns is deterministic', () => {
  const box = { x: 0.31, y: 0.62, w: 0.17, h: 0.23 };
  assert.deepEqual(kenBurns(box, 3), kenBurns({ ...box }, 3));
  assert.deepEqual(kenBurns(null, 2), kenBurns(null, 2));
});

test('a degenerate or out-of-range box gives finite numbers', () => {
  for (const box of [{ x: 0.5, y: 0.5, w: 0, h: 0 }, { x: 2, y: -1, w: 5, h: 5 }, { x: Number.NaN, y: 0.5, w: 0.2, h: 0.2 }]) {
    const kb = kenBurns(box as FocusBox, 1);
    for (const v of [kb.from, kb.to]) {
      assert.ok(Number.isFinite(v.scale) && Number.isFinite(v.translateX) && Number.isFinite(v.translateY), JSON.stringify(box));
      assert.ok(viewCoversStage(v));
    }
  }
  // A zero-size box zooms the most the limits allow (it is treated as a small box, not a divide by zero).
  close(kenBurns({ x: 0.5, y: 0.5, w: 0, h: 0 }, 1).to.scale, KB_MAX_SCALE);
});

test('interpolateView blends and clamps the progress', () => {
  const a: ViewTransform = { scale: 1, translateX: 0, translateY: 0 };
  const b: ViewTransform = { scale: 1.25, translateX: 0.1, translateY: -0.1 };
  assert.deepEqual(interpolateView(a, b, 0), a);
  assert.deepEqual(interpolateView(a, b, 1), b);
  const mid = interpolateView(a, b, 0.5);
  close(mid.scale, 1.125);
  close(mid.translateX, 0.05);
  close(mid.translateY, -0.05);
  assert.deepEqual(interpolateView(a, b, -3), a);
  assert.deepEqual(interpolateView(a, b, 9), b);
  assert.deepEqual(interpolateView(a, b, Number.NaN), a);
});

test('toPixelTransform scales the fractions to the stage and puts translation before scale', () => {
  const t = toPixelTransform({ scale: 1.2, translateX: 0.1, translateY: -0.05 }, 400, 700);
  assert.deepEqual(t.map((x) => Object.keys(x)[0]), ['translateX', 'translateY', 'scale']);
  close((t[0] as { translateX: number }).translateX, 40);
  close((t[1] as { translateY: number }).translateY, -35);
  assert.deepEqual(t[2], { scale: 1.2 });
});

// ---- Captions ------------------------------------------------------------------------------------

const whole: ViewTransform = { scale: 1, translateX: 0, translateY: 0 };
const still: KenBurns = { from: whole, to: whole, direction: 'in' };

test('captions go to the bottom by default and with no focus box', () => {
  assert.equal(captionPlacement(null, kenBurns(null, 1)), 'bottom');
  assert.equal(captionPlacement({ x: 0.3, y: 0.2, w: 0.4, h: 0.3 }, still), 'bottom');     // subject in the upper middle
  assert.equal(captionPlacement({ x: 0.3, y: 0.35, w: 0.4, h: 0.3 }, still), 'bottom');    // up to 0.65: clear of the band (starts at 0.7)
});

test('captions move to the top when the subject sits in the bottom band', () => {
  assert.equal(captionPlacement({ x: 0.3, y: 0.7, w: 0.4, h: 0.25 }, still), 'top');
  assert.equal(captionPlacement({ x: 0.3, y: 0.55, w: 0.3, h: 0.4 }, still), 'top');
});

test('a graze into the bottom band within the tolerance keeps the caption at the bottom', () => {
  // The band starts at 0.7; the box reaches 0.72: 0.02 deep, under the 0.03 tolerance.
  assert.equal(captionPlacement({ x: 0.3, y: 0.4, w: 0.4, h: 0.32 }, still), 'bottom');
  // 0.04 deep is over it.
  assert.equal(captionPlacement({ x: 0.3, y: 0.4, w: 0.4, h: 0.34 }, still), 'top');
});

test('when the subject fills the frame the caption stays at the bottom (a tie is not worth moving)', () => {
  assert.equal(captionPlacement({ x: 0, y: 0, w: 1, h: 1 }, still), 'bottom');
  // Reaches into both bands, but more into the top one: stay at the bottom.
  assert.equal(captionPlacement({ x: 0.2, y: 0, w: 0.6, h: 0.8 }, still), 'bottom');
});

test('captions account for the whole zoom, not only the first frame', () => {
  const box = { x: 0.4, y: 0.5, w: 0.2, h: 0.1 };                   // 0.5..0.6 on the image
  const zoomDown: KenBurns = { from: whole, to: { scale: 1.25, translateX: 0, translateY: 0.125 }, direction: 'in' };
  // At the start it is clear of the bottom band; by the end it has moved to 0.625..0.75 and reaches into it.
  assert.equal(captionPlacement(box, { ...zoomDown, to: whole }), 'bottom');
  assert.equal(captionPlacement(box, zoomDown), 'top');
  // The order of from and to doesn't matter.
  assert.equal(captionPlacement(box, { from: zoomDown.to, to: zoomDown.from, direction: 'out' }), 'top');
});

test('the caption band is the lower 30% of the stage', () => {
  assert.equal(CAPTION_BAND, 0.3);
});

// ---- Plan ----------------------------------------------------------------------------------------

test('planComic gives every panel its timing, motion and caption position', () => {
  const m = makeManifest([
    { caption: words(10), focus: { x: 0.4, y: 0.3, w: 0.2, h: 0.3 } },
    { caption: 'Low tide.', focus: { x: 0.3, y: 0.7, w: 0.4, h: 0.25 } },
    { focus: null },
    { caption: words(33), focus: { x: 0.4, y: 0.3, w: 0.2, h: 0.3 } },
  ]);
  const plan = planComic(m);
  assert.deepEqual(plan.timeline, comicTimeline(m));
  assert.deepEqual(plan.panels.map((p) => p.n), [1, 2, 3, 4]);
  assert.deepEqual(plan.panels.map((p) => p.startMs), plan.timeline.panels.map((p) => p.startMs));
  assert.deepEqual(plan.panels.map((p) => p.durationMs), plan.timeline.panels.map((p) => p.durationMs));
  assert.deepEqual(plan.panels.map((p) => p.words), [10, 2, 0, 33]);
  assert.deepEqual(plan.panels.map((p) => p.kenBurns.direction), ['in', 'out', 'in', 'out']);
  assert.deepEqual(plan.panels.map((p) => p.caption), ['bottom', 'top', 'bottom', 'bottom']);
  for (const p of plan.panels) assert.deepEqual(p.kenBurns, kenBurns(m.panels[p.n - 1]!.focus, p.n));
});

// ---- Reveal --------------------------------------------------------------------------------------

test('revealPlan: panels in order, text just after its panel, choices when the last panel ends', () => {
  const m = makeManifest([
    { caption: 'The tide went out.', dialogue: ['Is that a letter?'] },
    { caption: '' },
    { dialogue: ['Open it.', 'Not here.'] },
    { caption: 'Thunder.' },
  ]);
  const t = comicTimeline(m);
  const steps = revealPlan(m);
  assert.deepEqual(steps.map((s) => s.kind), [
    'panel', 'caption', 'dialogue',      // panel 1
    'panel',                             // panel 2 (empty caption skipped)
    'panel', 'dialogue', 'dialogue',     // panel 3
    'panel', 'caption',                  // panel 4
    'choices',
  ]);
  assert.deepEqual(steps[0], { kind: 'panel', atMs: 0, n: 1 });
  assert.deepEqual(steps[1], { kind: 'caption', atMs: 300, n: 1 });
  const panelSteps = steps.filter((s) => s.kind === 'panel');
  assert.deepEqual(panelSteps.map((s) => s.atMs), t.panels.map((p) => p.startMs));
  assert.deepEqual(steps.at(-1), { kind: 'choices', atMs: t.totalMs });
  const lines = steps.filter((s) => s.kind === 'dialogue').map((s) => s.kind === 'dialogue' ? [s.n, s.line] : []);
  assert.deepEqual(lines, [[1, 0], [3, 0], [3, 1]]);
});

test('revealPlan times never go backwards', () => {
  const m = makeManifest([
    { caption: words(20), dialogue: [words(20), words(20)] }, { caption: words(5), dialogue: [words(3)] },
    { dialogue: [words(30), words(30)] }, { caption: words(33) },
  ], NARRATED(30_000));
  const times = revealPlan(m).map((s) => s.atMs);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test('revealPlan: all of a panel’s text is up before the last 30% of its time, even for a wordy panel', () => {
  const m = makeManifest([{ caption: words(25), dialogue: [words(25), words(25)] }, {}, {}, {}], NARRATED(8_000));
  const t = comicTimeline(m);
  const slot = t.panels[0]!;
  const text = revealPlan(m).filter((s) => (s.kind === 'caption' || s.kind === 'dialogue') && s.n === 1);
  assert.equal(text.length, 3);
  for (const s of text) {
    assert.ok(s.atMs >= slot.startMs + 300, `${s.kind} at ${s.atMs}`);
    assert.ok(s.atMs <= slot.startMs + Math.floor(slot.durationMs * 0.7), `${s.kind} at ${s.atMs} of ${slot.durationMs}`);
  }
  const at = text.map((s) => s.atMs);
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
});

test('revealPlan: a roomy panel spaces lines by their reading time', () => {
  // 5 words is under the 2.5 s minimum, so the panel is roomy: the caption's 4 words take 1212 ms to read.
  const steps = revealPlan(makeManifest([{ caption: words(4), dialogue: [words(1)] }]));
  assert.deepEqual(steps[1], { kind: 'caption', atMs: 300, n: 1 });
  assert.deepEqual(steps[2], { kind: 'dialogue', atMs: 1512, n: 1, line: 0 });
});

test('revealPlan: a crowded panel pulls its later lines forward so they are up in time', () => {
  // 9 words = 2727 ms. The dialogue would wait until 300 + 1818 = 2118, past 70% of the panel (1908), so it is held to 1908.
  const steps = revealPlan(makeManifest([{ caption: words(6), dialogue: [words(3)] }]));
  assert.deepEqual(steps[1], { kind: 'caption', atMs: 300, n: 1 });
  assert.deepEqual(steps[2], { kind: 'dialogue', atMs: 1908, n: 1, line: 0 });
});

test('revealPlan starts the narration with panel 1 when there is audio', () => {
  const narrated = revealPlan(makeManifest([{ caption: 'Hi there.' }], NARRATED(12_000)));
  assert.deepEqual(narrated.slice(0, 2), [{ kind: 'narration', atMs: 0 }, { kind: 'panel', atMs: 0, n: 1 }]);
  assert.equal(revealPlan(makeManifest([{ caption: 'Hi there.' }])).some((s) => s.kind === 'narration'), false);
});

test('revealPlan: an ending scene shows the ending, not choices; no choices means no choices step', () => {
  const ending = revealPlan(makeManifest([], { is_ending: true }));
  assert.equal(ending.at(-1)?.kind, 'ending');
  assert.equal(ending.some((s) => s.kind === 'choices'), false);
  const none = revealPlan(makeManifest([], { choices: [] }));
  assert.equal(none.some((s) => s.kind === 'choices' || s.kind === 'ending'), false);
  const total = comicTimeline(makeManifest([], { is_ending: true })).totalMs;
  assert.equal(ending.at(-1)?.atMs, total);
});

test('revealPlan ignores whitespace-only text', () => {
  const m = makeManifest([{ caption: '   ', dialogue: ['  ', 'Hello there.'] }]);
  const text = revealPlan(m).filter((s) => s.kind === 'caption' || s.kind === 'dialogue');
  assert.deepEqual(text, [{ kind: 'dialogue', atMs: 300, n: 1, line: 1 }]);
});
