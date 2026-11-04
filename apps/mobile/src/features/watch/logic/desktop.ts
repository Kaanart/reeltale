// The player on a laptop or desktop browser. Pure (tested in src/core/__tests__/watch-desktop.test.ts).
//
// On a phone the player fills the screen. On a web window of medium width or more (the site's top bar is
// there) a vertical video would leave most of a landscape screen black, so the screen becomes a "theatre":
// the 9:16 player as tall as the window allows, the previous/next buttons beside it, and a side panel with
// the series, the episode list and the controls, all centred together on the page. Too little room for
// that (a short or narrow window) falls back to the phone layout. The unlock sheet becomes a centred dialog
// at the same sizes, and a few keys work besides the pager's arrows.

import type { EpisodePrice } from '@reeltale/shared';
import type { EpisodeAccessView } from '../../../core/pricing.ts';
import type { EpisodeRow, SeriesRow } from '../../../lib/types.ts';
import { breakpoints, layout, space } from '../../../theme/tokens.ts';
import { freeByRule } from '../../catalog/logic.ts';
import { watchAccessView } from './access.ts';

/** Episodes are vertical video. */
export const PLAYER_ASPECT = 9 / 16;
/** The narrowest player worth showing beside a panel; below this the phone layout is better. */
export const THEATER_MIN_COLUMN = 240;

export interface TheaterInput {
  /** The screen's own area (below the site's top bar), not the whole window. */
  width: number;
  height: number;
  web: boolean;
  /** Side gutter of the page (useLayout().gutter). */
  gutter: number;
}

export interface TheaterLayout {
  /** The player column. */
  columnWidth: number;
  columnHeight: number;
  /** The side panel (as tall as the player). */
  panelWidth: number;
  /** The previous/next buttons between the player and the panel. */
  railWidth: number;
  /** Space between the player, the buttons and the panel. */
  gap: number;
  /** Space above and below the player. */
  padding: number;
  /** Player + buttons + panel + gaps: centred on the page. */
  groupWidth: number;
}

/** The theatre layout for an area this size, or null for the phone layout. */
export function theaterLayout({ width, height, web, gutter }: TheaterInput): TheaterLayout | null {
  if (!web || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width < breakpoints.medium || height <= 0) return null;
  const padding = space.xl;
  const gap = space.xl;
  const railWidth = layout.minTarget;
  const panelWidth = layout.sidePanelWidth;
  const room = Math.min(width - 2 * Math.max(0, gutter), layout.contentMaxWidth);
  const maxColumnWidth = Math.floor(room - panelWidth - railWidth - 2 * gap);
  const maxColumnHeight = Math.floor(height - 2 * padding);

  // As tall as the area allows; on a narrow, tall window the width decides and the height follows.
  let columnHeight = maxColumnHeight;
  let columnWidth = Math.round(columnHeight * PLAYER_ASPECT);
  if (columnWidth > maxColumnWidth) {
    columnWidth = maxColumnWidth;
    columnHeight = Math.round(columnWidth / PLAYER_ASPECT);
  }
  if (columnWidth < THEATER_MIN_COLUMN) return null;
  return {
    columnWidth,
    columnHeight,
    panelWidth,
    railWidth,
    gap,
    padding,
    groupWidth: columnWidth + gap + railWidth + gap + panelWidth,
  };
}

/** The unlock sheet slides up on a phone and in the apps; on a wider web window it is a centred dialog. */
export function unlockPresentation(web: boolean, size: 'compact' | 'medium' | 'wide'): 'sheet' | 'dialog' {
  return web && size !== 'compact' ? 'dialog' : 'sheet';
}

// ---- Keyboard ------------------------------------------------------------------------------------------

/** What a key does besides paging (logic/pager.ts pageForKey has the arrows, Page Up/Down, Home and End). */
export type PlayerShortcut = 'togglePlay' | 'mute' | 'captions';

/** The letter keys, lower case. Shown upper case in the hint. */
export const SHORTCUT_KEYS = { togglePlay: 'k', mute: 'm', captions: 'c' } as const;

/**
 * The shortcut a key press means, or null. Space only counts when the focus isn't on a control: there it
 * presses the button (or link) instead, and the player must not toggle a second time.
 */
export function shortcutFor(key: string, focus: { onControl: boolean }): PlayerShortcut | null {
  if (key === ' ' || key === 'Spacebar') return focus.onControl ? null : 'togglePlay';
  switch (key.length === 1 ? key.toLowerCase() : '') {
    case SHORTCUT_KEYS.togglePlay:
      return 'togglePlay';
    case SHORTCUT_KEYS.mute:
      return 'mute';
    case SHORTCUT_KEYS.captions:
      return 'captions';
    default:
      return null;
  }
}

/** The hint under the episode list: which keys, and the watch:shortcuts.<id> text for what they do. */
export const SHORTCUT_HINTS: readonly { id: 'switch' | 'playPause' | 'mute' | 'captions'; keys: readonly string[] }[] = [
  { id: 'switch', keys: ['↑', '↓'] },
  // 'space' is the one key name that is a word: the hint translates it (watch:shortcuts.space).
  { id: 'playPause', keys: ['space', SHORTCUT_KEYS.togglePlay.toUpperCase()] },
  { id: 'mute', keys: [SHORTCUT_KEYS.mute.toUpperCase()] },
  { id: 'captions', keys: [SHORTCUT_KEYS.captions.toUpperCase()] },
];

// ---- The episode list in the side panel ------------------------------------------------------------------

export type ListState =
  | { kind: 'loading' }
  | { kind: 'free' }
  | { kind: 'unlocked' }
  | { kind: 'own' }
  | { kind: 'locked'; price: number; basePrice: number; discounted: boolean }
  /** Can't be watched: removed, closed to new buyers, behind the mature opt-in. */
  | { kind: 'unavailable' };

type ListSeries = Pick<SeriesRow, 'status' | 'free_episode_count' | 'format' | 'editors_pick'>;
type ListEpisode = Pick<EpisodeRow, 'number' | 'is_free' | 'status' | 'moderation_status'>;

/**
 * Whether a row asks get_episode_price at all. Episodes free by the series' own rule (the first few, the
 * free AI stories) don't: same rule as the catalog's episode rows and app_private.resolve_episode_price.
 */
export function listNeedsPrice(series: ListSeries, episode: ListEpisode): boolean {
  return !freeByRule(series, episode);
}

/** What one row of the list shows. The server's answer wins; it reads like the page's (logic/access.ts). */
export function listState(series: ListSeries, episode: ListEpisode, price: EpisodePrice | null | undefined): ListState {
  if (!listNeedsPrice(series, episode)) return { kind: 'free' };
  const view: EpisodeAccessView | null = watchAccessView(price, episode);
  if (!view) return { kind: 'loading' };
  switch (view.state) {
    case 'free':
      return { kind: 'free' };
    case 'unlocked':
      return { kind: 'unlocked' };
    case 'own':
      return { kind: 'own' };
    case 'locked':
      return { kind: 'locked', price: view.price, basePrice: view.basePrice, discounted: view.discounted };
    default:
      return { kind: 'unavailable' };
  }
}
