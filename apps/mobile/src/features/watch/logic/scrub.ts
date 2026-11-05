// The player's scrubber (components/ProgressBar.tsx): where a drag or tap on the bar lands, and how the time
// reads. Pure, so node tests it in src/core/__tests__/watch-logic.test.ts.

/** Seconds a screen reader's "adjust" gesture moves the video. */
export const SCRUB_STEP_S = 5;

/** The second under `x` pixels along a bar `width` pixels wide, for a video `duration` seconds long (clamped). */
export function secondsAt(x: number, width: number, duration: number): number {
  if (!(width > 0) || !(duration > 0) || !Number.isFinite(x)) return 0;
  const fraction = Math.min(1, Math.max(0, x / width));
  return fraction * duration;
}

/** `position` moved one step forward (1) or back (-1), inside the video. */
export function stepSeconds(position: number, duration: number, direction: 1 | -1): number {
  const total = Math.max(0, duration);
  return Math.min(total, Math.max(0, position + direction * SCRUB_STEP_S));
}

/** A time as the bar shows it: `0:07`, `1:05`, `12:30`, `1:02:03`. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
