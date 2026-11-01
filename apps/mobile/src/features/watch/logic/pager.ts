// Paging maths for the vertical episode player. Pure (tested in src/core/__tests__/watch-logic.test.ts).
//
// One page per episode, one page per screen height. Only the visible page and its two neighbours mount a
// video player (at most three players at once); two pages out keep just their poster, and everything
// further away renders an empty page.

/** Players are mounted this far from the visible page: one each side, so at most three. */
export const PLAYER_RADIUS = 1;
/** Posters are kept this far from the visible page. */
export const POSTER_RADIUS = 2;

/**
 * What a page renders:
 *   active  the visible page: poster, player (playing), controls
 *   warm    a neighbour: poster and a loaded, paused player, so a swipe starts at once
 *   poster  poster only (no player, no playback request)
 *   idle    nothing
 */
export type PageRole = 'active' | 'warm' | 'poster' | 'idle';

export function clampIndex(index: number, count: number): number {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.round(index), 0), count - 1);
}

/** The page a scroll offset settles on. */
export function pageFromOffset(offset: number, pageHeight: number, count: number): number {
  if (!(pageHeight > 0) || !Number.isFinite(offset)) return 0;
  return clampIndex(offset / pageHeight, count);
}

export function pageRole(index: number, active: number): PageRole {
  const distance = Math.abs(index - active);
  if (distance === 0) return 'active';
  if (distance <= PLAYER_RADIUS) return 'warm';
  if (distance <= POSTER_RADIUS) return 'poster';
  return 'idle';
}

/** True for pages that may hold a player (and so may ask for a playback URL). */
export function holdsPlayer(role: PageRole): boolean {
  return role === 'active' || role === 'warm';
}

/** The indices that mount a player when `active` is visible. */
export function playerWindow(active: number, count: number): number[] {
  const out: number[] = [];
  for (let i = active - PLAYER_RADIUS; i <= active + PLAYER_RADIUS; i += 1) {
    if (i >= 0 && i < count) out.push(i);
  }
  return out;
}

/** Where the pager opens: the requested episode, or the first one if it isn't in the list. */
export function startIndex(episodes: readonly { id: string }[], episodeId: string): number {
  const i = episodes.findIndex((e) => e.id === episodeId);
  return i < 0 ? 0 : i;
}

/** Keyboard paging on the web: the page a key moves to, or null when the key isn't ours. */
export function pageForKey(key: string, index: number, count: number): number | null {
  let next: number;
  switch (key) {
    case 'ArrowDown':
    case 'PageDown':
      next = index + 1;
      break;
    case 'ArrowUp':
    case 'PageUp':
      next = index - 1;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = count - 1;
      break;
    default:
      return null;
  }
  const clamped = clampIndex(next, count);
  return clamped === index ? null : clamped;
}
