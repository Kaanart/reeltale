// Watch progress: what goes into public.watch_progress, how often, and where playback resumes.
// Pure (tested in src/core/__tests__/watch-logic.test.ts).
//
// The table keeps one row per user and episode: position_s is a smallint between 0 and 120 (episodes are
// two minutes at most) and `completed` says the episode was watched to the end. Once completed, a row stays
// completed: rewatching from the start only moves the position.

/** The column's check constraint: 0..120 seconds. */
export const MAX_POSITION_S = 120;
/** While playing, save at most this often. */
export const SAVE_INTERVAL_MS = 10_000;
/** ... and only when the position moved at least this much. */
export const MIN_STEP_S = 2;
/** Within this many seconds of the end, or past COMPLETE_RATIO, an episode counts as watched. */
export const COMPLETE_TAIL_S = 3;
export const COMPLETE_RATIO = 0.95;
/** Positions this close to the start (or the end) start from the beginning instead of resuming. */
export const RESUME_MARGIN_S = 3;

export interface SavedProgress {
  position_s: number;
  completed: boolean;
}

/** Whole seconds within the column's range. Anything that isn't a finite number is 0. */
export function toPositionS(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(Math.floor(seconds), MAX_POSITION_S);
}

export function isComplete(positionSeconds: number, durationSeconds: number | null | undefined): boolean {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  if (!Number.isFinite(positionSeconds) || positionSeconds <= 0) return false;
  return positionSeconds >= durationSeconds - COMPLETE_TAIL_S || positionSeconds / durationSeconds >= COMPLETE_RATIO;
}

/** Where to start an episode: the saved position, unless it's finished, near either end, or unknown. */
export function resumePosition(saved: SavedProgress | null | undefined, durationSeconds: number | null | undefined): number {
  if (!saved || saved.completed) return 0;
  const pos = toPositionS(saved.position_s);
  if (pos < RESUME_MARGIN_S) return 0;
  if (durationSeconds && durationSeconds > 0 && pos >= durationSeconds - RESUME_MARGIN_S) return 0;
  return pos;
}

/** Rows of `select episode_id, position_s, completed from watch_progress`, by episode. Bad rows are skipped. */
export function progressByEpisode(rows: unknown): Map<string, SavedProgress> {
  const out = new Map<string, SavedProgress>();
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const { episode_id: id, position_s: pos, completed } = row as Record<string, unknown>;
    if (typeof id !== 'string' || typeof pos !== 'number') continue;
    out.set(id, { position_s: toPositionS(pos), completed: completed === true });
  }
  return out;
}

/**
 * Decides when to write progress. Feed it every time update; it answers with the row to save, or null.
 * `force` is for moments that should be saved right away: pause, leaving the episode, the app going to
 * the background, the end. One throttle per episode on screen.
 */
export class ProgressThrottle {
  private last: { positionS: number; completed: boolean; at: number } | null = null;
  // Plain fields, not constructor parameter properties: node's type stripping (the tests) can't run those.
  private readonly intervalMs: number;
  private readonly minStepS: number;

  constructor(intervalMs: number = SAVE_INTERVAL_MS, minStepS: number = MIN_STEP_S) {
    this.intervalMs = intervalMs;
    this.minStepS = minStepS;
  }

  next(positionSeconds: number, durationSeconds: number | null | undefined, now: number, force = false): SavedProgress | null {
    const positionS = toPositionS(positionSeconds);
    const completed = isComplete(positionSeconds, durationSeconds) || (this.last?.completed ?? false);
    const last = this.last;

    let save: boolean;
    if (!last) {
      // Nothing worth a row until the viewer has actually watched a little.
      save = completed || positionS >= this.minStepS || (force && positionS > 0);
    } else if (completed && !last.completed) {
      save = true;
    } else if (positionS === last.positionS && completed === last.completed) {
      save = false;
    } else if (force) {
      save = true;
    } else {
      save = now - last.at >= this.intervalMs && Math.abs(positionS - last.positionS) >= this.minStepS;
    }

    if (!save) return null;
    this.last = { positionS, completed, at: now };
    return { position_s: positionS, completed };
  }
}
