// The living-comic player's maths, from a StoryManifest. Pure functions: no timers, no React, no
// randomness, so the same manifest always plays the same way and every rule can be tested.
//
//   timing        how long each panel stays (reading time, or the narration split between panels)
//   Ken Burns     a gentle zoom centred on the SAM focus box that never shows anything outside the image
//   captions      top or bottom, whichever keeps the subject clear
//   reveal plan   the order and moment the parts of a scene appear
//
// Geometry conventions. The stage is a 9:16 box and the panel image is 9:16 too, so image and stage
// have the same shape. All positions are fractions: (0,0) is the top left, (1,1) the bottom right, of
// the image (focus boxes) or of the stage (view transforms). The image is drawn to fill the stage,
// scaled about its centre by `scale`, then moved by `translateX`/`translateY` (fractions of stage width
// and height, positive = right/down). See toPixelTransform for the React Native transform array.

import type { FocusBox, StoryManifest } from '@reeltale/shared';

type Panel = StoryManifest['panels'][number];

// ---- Timing --------------------------------------------------------------------------------------

/** Average silent reading speed for short on-screen text. */
export const READING_WORDS_PER_SECOND = 3.3;
/** A panel with no text still stays long enough to look at. */
export const MIN_PANEL_MS = 2500;
/** A very wordy panel stops waiting after this; the reader can tap ahead. */
export const MAX_PANEL_MS = 12_000;
/** When narration sets the pace, no panel is cut shorter than this (if the narration is long enough for that). */
export const MIN_NARRATED_PANEL_MS = 1500;

export interface ComicTimingOptions {
  wordsPerSecond?: number;
  minPanelMs?: number;
  maxPanelMs?: number;
  minNarratedPanelMs?: number;
}

interface Timing {
  wps: number;
  min: number;
  max: number;
  narratedMin: number;
}

/** Fill in defaults. A value that isn't a positive finite number is ignored; the maximum never goes below the minimum. */
function resolveTiming(o: ComicTimingOptions = {}): Timing {
  const pos = (v: number | undefined, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);
  const min = pos(o.minPanelMs, MIN_PANEL_MS);
  return {
    wps: pos(o.wordsPerSecond, READING_WORDS_PER_SECOND),
    min,
    max: Math.max(min, pos(o.maxPanelMs, MAX_PANEL_MS)),
    narratedMin: pos(o.minNarratedPanelMs, MIN_NARRATED_PANEL_MS),
  };
}

// Tokens made only of whitespace and punctuation ("—", "...") aren't words.
const NOT_A_WORD = /^[\-–—.,;:!?…"'“”‘’()[\]{}*_~`|\\/<>@#$%^&+=]*$/;

/** Words in a text: runs of non-space characters that contain at least one letter, digit or symbol that isn't punctuation. */
export function countWords(text: string): number {
  let n = 0;
  for (const token of text.split(/\s+/)) {
    if (token !== '' && !NOT_A_WORD.test(token)) n++;
  }
  return n;
}

/** Words a reader has to get through in a panel: the caption plus each dialogue line (speaker names are labels, not read). */
export function panelWordCount(panel: Pick<Panel, 'caption' | 'dialogue'>): number {
  return countWords(panel.caption) + panel.dialogue.reduce((sum, d) => sum + countWords(d.line), 0);
}

/** Panels in play order (by `n`). The sort is stable and doesn't touch the manifest. */
export function orderedPanels(manifest: Pick<StoryManifest, 'panels'>): Panel[] {
  return [...manifest.panels].sort((a, b) => a.n - b.n);
}

/** True when the manifest has narration audio with a known length: then the audio sets the pace. */
export function hasNarrationAudio(manifest: Pick<StoryManifest, 'narration'>): boolean {
  const { audio, duration_ms: ms } = manifest.narration;
  return audio !== null && ms !== null && ms > 0;
}

/**
 * Split `total` whole milliseconds between slots in proportion to `weights`, giving every slot at least
 * `floor` when the total allows it. The parts always add up to exactly `total` (largest remainder).
 */
function allocate(total: number, weights: readonly number[], floor: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const base = total >= n * floor ? floor : Math.floor(total / n);
  const spare = total - base * n;
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (spare * w) / weightSum);
  const parts = exact.map(Math.floor);
  let left = spare - parts.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    parts[i] = (parts[i] ?? 0) + 1;
    left--;
  }
  return parts.map((p) => base + p);
}

/**
 * How long each panel stays, in whole milliseconds, in play order.
 *
 * Without narration audio: reading time of the panel's caption and dialogue at about 3.3 words a
 * second, clamped to [MIN_PANEL_MS, MAX_PANEL_MS].
 * With narration audio of known length: that length is split between the panels in proportion to those
 * clamped reading times (a wordier panel gets more of the narration), so the four panels end exactly
 * when the audio does and the durations add up to `narration.duration_ms`.
 */
export function panelDurations(manifest: StoryManifest, options?: ComicTimingOptions): number[] {
  const t = resolveTiming(options);
  const reading = orderedPanels(manifest).map((p) => {
    const ms = (panelWordCount(p) / t.wps) * 1000;
    return Math.min(t.max, Math.max(t.min, ms));
  });
  const audioMs = manifest.narration.duration_ms;
  if (hasNarrationAudio(manifest) && audioMs !== null) return allocate(Math.round(audioMs), reading, t.narratedMin);
  return reading.map(Math.round);
}

export interface PanelSlot {
  n: number;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface ComicTimeline {
  panels: PanelSlot[];
  totalMs: number;
  /** True when the narration audio set the pace. */
  narrated: boolean;
}

/** Panels laid end to end: where each starts and ends on the scene clock. */
export function comicTimeline(manifest: StoryManifest, options?: ComicTimingOptions): ComicTimeline {
  const durations = panelDurations(manifest, options);
  const panels: PanelSlot[] = [];
  let at = 0;
  orderedPanels(manifest).forEach((p, i) => {
    const durationMs = durations[i] ?? 0;
    panels.push({ n: p.n, startMs: at, endMs: at + durationMs, durationMs });
    at += durationMs;
  });
  return { panels, totalMs: at, narrated: hasNarrationAudio(manifest) };
}

/** Index (into timeline.panels) of the panel showing at `positionMs`: before the start is the first, after the end the last. */
export function panelIndexAt(timeline: ComicTimeline, positionMs: number): number {
  const last = timeline.panels.length - 1;
  if (last < 0 || !(positionMs > 0)) return 0;
  const i = timeline.panels.findIndex((p) => positionMs < p.endMs);
  return i === -1 ? last : i;
}

// ---- Ken Burns -----------------------------------------------------------------------------------

/** One framing of the image in the stage. `scale` >= 1; translations are fractions of the stage size. */
export interface ViewTransform {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface KenBurns {
  from: ViewTransform;
  to: ViewTransform;
  /** 'in' moves from the whole image toward the subject, 'out' from the subject back to the whole image. */
  direction: 'in' | 'out';
}

/** Zoom limits: gentle (never past 1.25x), but always enough to notice (at least 1.08x). */
export const KB_MIN_SCALE = 1.08;
export const KB_MAX_SCALE = 1.25;
/** With no focus box the zoom aims at the middle of the image. */
export const KB_FALLBACK_SCALE = 1.1;
/** The zoom is chosen so the focus box fills at most this share of the zoomed view. */
export const KB_BOX_FILL = 0.9;
/** A focus box thinner than this is treated as this size (stops a divide by almost zero). */
const KB_MIN_BOX = 0.05;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finiteOr = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
/** Turns -0 into 0 so results compare cleanly. */
const nz = (v: number) => (v === 0 ? 0 : v);

/**
 * The view that shows the part of the image of size 1/scale centred as close to (cx, cy) as possible
 * without leaving the image. The window centre is pulled inside [1/(2s), 1-1/(2s)] on both axes, and the
 * translation is exactly what puts that window centre in the middle of the stage. So the translation
 * never exceeds (scale-1)/2 per axis, which is the bound for the image to cover the stage.
 */
export function viewCentredOn(cx: number, cy: number, scale: number): ViewTransform {
  const s = Math.max(1, finiteOr(scale, 1));
  const half = 1 / (2 * s);
  const wx = clamp(finiteOr(cx, 0.5), half, 1 - half);
  const wy = clamp(finiteOr(cy, 0.5), half, 1 - half);
  const limit = (s - 1) / 2;
  return {
    scale: s,
    translateX: nz(clamp(-(wx - 0.5) * s, -limit, limit)),
    translateY: nz(clamp(-(wy - 0.5) * s, -limit, limit)),
  };
}

/** True when the image still covers the whole stage under `v` (nothing outside the image shows). */
export function viewCoversStage(v: ViewTransform, tolerance = 1e-9): boolean {
  if (!(v.scale >= 1 - tolerance)) return false;
  const limit = (v.scale - 1) / 2 + tolerance;
  return Math.abs(v.translateX) <= limit && Math.abs(v.translateY) <= limit;
}

/**
 * The gentle zoom for one panel.
 *
 * - Panels alternate: odd numbers zoom in (whole image to subject), even numbers zoom out (subject back
 *   to the whole image), so one panel ends at the framing the next starts from.
 * - The close framing is centred on the focus box's centre. Its scale makes the box fill about 90% of the
 *   view, kept between KB_MIN_SCALE and KB_MAX_SCALE: a small subject gets the full gentle zoom, a
 *   subject that fills the frame barely moves.
 * - A subject near an edge can't be centred without showing outside the image, so it is centred as far
 *   as the image allows (see viewCentredOn). That limit always wins.
 * - No focus box: zoom toward the middle at KB_FALLBACK_SCALE.
 * Both ends are valid views, and valid views stay valid when interpolated (the cover condition is
 * convex), so every frame in between is inside the image too.
 */
export function kenBurns(focus: FocusBox | null, panelNumber: number): KenBurns {
  const whole = viewCentredOn(0.5, 0.5, 1);
  let close: ViewTransform;
  if (focus) {
    const size = Math.max(finiteOr(focus.w, 0), finiteOr(focus.h, 0), KB_MIN_BOX);
    const scale = clamp(KB_BOX_FILL / size, KB_MIN_SCALE, KB_MAX_SCALE);
    close = viewCentredOn(clamp(focus.x + focus.w / 2, 0, 1), clamp(focus.y + focus.h / 2, 0, 1), scale);
  } else {
    close = viewCentredOn(0.5, 0.5, KB_FALLBACK_SCALE);
  }
  return panelNumber % 2 === 1
    ? { from: whole, to: close, direction: 'in' }
    : { from: close, to: whole, direction: 'out' };
}

/** The view at `progress` (0 = from, 1 = to) along a straight blend. The app applies its own easing to `progress`. */
export function interpolateView(from: ViewTransform, to: ViewTransform, progress: number): ViewTransform {
  const t = clamp(finiteOr(progress, 0), 0, 1);
  return {
    scale: from.scale + (to.scale - from.scale) * t,
    translateX: nz(from.translateX + (to.translateX - from.translateX) * t),
    translateY: nz(from.translateY + (to.translateY - from.translateY) * t),
  };
}

/**
 * The same view as a React Native `transform` array for a stage of width x height pixels. Order matters:
 * the translation comes first so it is in screen pixels and is not multiplied by the scale.
 */
export function toPixelTransform(
  v: ViewTransform, width: number, height: number,
): [{ translateX: number }, { translateY: number }, { scale: number }] {
  return [{ translateX: v.translateX * width }, { translateY: v.translateY * height }, { scale: v.scale }];
}

// ---- Caption placement ---------------------------------------------------------------------------

export type CaptionPosition = 'top' | 'bottom';

/** The share of the stage height a caption block may take, at the top or the bottom. */
export const CAPTION_BAND = 0.3;
/** The bottom (the usual place) is kept unless the subject reaches into it by more than this share of the stage height. */
export const CAPTION_TOLERANCE = 0.03;

/** Where the focus box sits on the stage (top and bottom edges, as stage fractions) under view `v`. */
function boxSpanOnStage(box: FocusBox, v: ViewTransform): { top: number; bottom: number } {
  const place = (p: number) => 0.5 + v.scale * (p - 0.5) + v.translateY;
  return { top: place(box.y), bottom: place(box.y + box.h) };
}

/** Length of the overlap between [aTop, aBottom] and [bTop, bBottom]. */
function overlap(aTop: number, aBottom: number, bTop: number, bBottom: number): number {
  return Math.max(0, Math.min(aBottom, bBottom) - Math.max(aTop, bTop));
}

/**
 * Put the caption at the bottom (the lower third, where subtitles usually go) unless the subject reaches
 * into that band; then use the top if the subject is clearer of it. The subject's place is taken over the
 * whole zoom: the box is tracked at both ends of the Ken Burns and the union is used, so the caption
 * doesn't end up on a face halfway through the panel. Ties and panels with no focus box stay at the bottom.
 */
export function captionPlacement(focus: FocusBox | null, kb: KenBurns): CaptionPosition {
  if (!focus) return 'bottom';
  const a = boxSpanOnStage(focus, kb.from);
  const b = boxSpanOnStage(focus, kb.to);
  const top = clamp(Math.min(a.top, b.top), 0, 1);
  const bottom = clamp(Math.max(a.bottom, b.bottom), 0, 1);
  const intoBottom = overlap(top, bottom, 1 - CAPTION_BAND, 1);
  if (intoBottom <= CAPTION_TOLERANCE) return 'bottom';
  const intoTop = overlap(top, bottom, 0, CAPTION_BAND);
  // A tie (within rounding error) stays at the bottom.
  return intoTop < intoBottom - 1e-9 ? 'top' : 'bottom';
}

// ---- One plan for the player ---------------------------------------------------------------------

export interface PanelPlan {
  n: number;
  startMs: number;
  durationMs: number;
  words: number;
  kenBurns: KenBurns;
  caption: CaptionPosition;
}

export interface ComicPlan {
  timeline: ComicTimeline;
  panels: PanelPlan[];
}

/** Timing, Ken Burns and caption placement for every panel in one call. */
export function planComic(manifest: StoryManifest, options?: ComicTimingOptions): ComicPlan {
  const timeline = comicTimeline(manifest, options);
  const panels = orderedPanels(manifest).map((p, i): PanelPlan => {
    const slot = timeline.panels[i];
    const kb = kenBurns(p.focus, p.n);
    return {
      n: p.n,
      startMs: slot?.startMs ?? 0,
      durationMs: slot?.durationMs ?? 0,
      words: panelWordCount(p),
      kenBurns: kb,
      caption: captionPlacement(p.focus, kb),
    };
  });
  return { timeline, panels };
}

// ---- Progressive reveal --------------------------------------------------------------------------

export type RevealStep =
  | { kind: 'narration'; atMs: number }                          // start the audio
  | { kind: 'panel'; atMs: number; n: number }                   // show the image
  | { kind: 'caption'; atMs: number; n: number }
  | { kind: 'dialogue'; atMs: number; n: number; line: number }  // line = index in the panel's dialogue
  | { kind: 'choices'; atMs: number }                            // the choice cards rise
  | { kind: 'ending'; atMs: number };                            // the story is over: no choices

/** The caption fades in just after its panel appears. */
export const REVEAL_TEXT_DELAY_MS = 300;
/** All text of a panel is on screen with at least this share of the panel's time left. */
const REVEAL_TEXT_LATEST = 0.7;
/** A short line still gets this long before the next one appears. */
const REVEAL_MIN_BEAT_MS = 1200;

/**
 * The order and time (on the scene clock) at which parts of the scene appear, earliest first:
 *   - narration starts with panel 1, as soon as the scene is shown;
 *   - each panel appears at its start; its caption just after it; its dialogue lines one after another,
 *     each after the previous one's reading time, squeezed if needed so everything is up before the
 *     last 30% of the panel;
 *   - when the last panel ends, the choice cards rise (or, for an ending scene, the ending).
 * Empty captions are skipped. The steps are sorted by time; equal times keep this order.
 */
export function revealPlan(manifest: StoryManifest, options?: ComicTimingOptions): RevealStep[] {
  const t = resolveTiming(options);
  const timeline = comicTimeline(manifest, options);
  const panels = orderedPanels(manifest);
  const steps: RevealStep[] = [];
  if (timeline.narrated) steps.push({ kind: 'narration', atMs: 0 });

  panels.forEach((p, i) => {
    const slot = timeline.panels[i];
    if (!slot) return;
    steps.push({ kind: 'panel', atMs: slot.startMs, n: p.n });

    // Text beats in reading order, each with its reading time.
    const beats: { words: number; step: (atMs: number) => RevealStep }[] = [];
    if (p.caption.trim() !== '') beats.push({ words: countWords(p.caption), step: (atMs) => ({ kind: 'caption', atMs, n: p.n }) });
    p.dialogue.forEach((d, line) => {
      if (d.line.trim() !== '') beats.push({ words: countWords(d.line), step: (atMs) => ({ kind: 'dialogue', atMs, n: p.n, line }) });
    });

    const offsets: number[] = [];
    let offset = REVEAL_TEXT_DELAY_MS;
    for (const b of beats) {
      offsets.push(offset);
      offset += Math.max(REVEAL_MIN_BEAT_MS, (b.words / t.wps) * 1000);
    }
    const latest = Math.max(0, Math.floor(slot.durationMs * REVEAL_TEXT_LATEST));
    const lastOffset = offsets.at(-1) ?? 0;
    // Squeeze the spread between beats, never the first one's small delay, then cap whatever is left.
    const squeeze = lastOffset > latest && lastOffset > REVEAL_TEXT_DELAY_MS
      ? Math.max(0, latest - REVEAL_TEXT_DELAY_MS) / (lastOffset - REVEAL_TEXT_DELAY_MS)
      : 1;
    beats.forEach((b, k) => {
      const raw = offsets[k] ?? REVEAL_TEXT_DELAY_MS;
      const at = REVEAL_TEXT_DELAY_MS + (raw - REVEAL_TEXT_DELAY_MS) * squeeze;
      steps.push(b.step(slot.startMs + Math.min(Math.round(at), latest)));
    });
  });

  if (manifest.is_ending) steps.push({ kind: 'ending', atMs: timeline.totalMs });
  else if (manifest.choices.length > 0) steps.push({ kind: 'choices', atMs: timeline.totalMs });
  return steps;
}
