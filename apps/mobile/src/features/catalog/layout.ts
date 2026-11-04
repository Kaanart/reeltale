// The catalog's layout decisions for wider windows (the website on a laptop), with no React, so node can test
// them (src/core/__tests__/catalog-layout.test.ts). Relative imports carry the .ts extension for the same
// reason. Size classes and grids come from the web shell (components/layout/logic.ts).

import { gridColumns, gridItemWidth, type LayoutSize } from '../../components/layout/logic.ts';
import { layout, space } from '../../theme/tokens.ts';
import { isAiSeries, type SeriesCard } from './logic.ts';

// ---- Shelves with arrows --------------------------------------------------------------------------------

/** Space between the cards of a shelf on wide windows. */
export const SHELF_GAP = space.lg;
/** A cover in a wide shelf is never narrower than this (the meta line under it must fit on one line). */
export const SHELF_MIN_CARD_WIDTH = 168;
/** ...and a wide shelf never shows more than this many at once (covers would get small on a 4K screen). */
export const SHELF_MAX_CARDS = 7;
/** "Continue watching" cards (cover, title, progress) on wide windows. */
export const CONTINUE_MIN_CARD_WIDTH = 280;
export const CONTINUE_MAX_CARDS = 4;

export interface ShelfOptions {
  minCardWidth?: number;
  maxCards?: number;
  gap?: number;
}

export interface ShelfLayout {
  /** Cards that fit side by side in the shelf's width. */
  perView: number;
  /** Width of one card (whole px), so `perView` cards and their gaps fill the width. */
  cardWidth: number;
  /** From the start of one card to the start of the next. */
  step: number;
  gap: number;
}

/** How a shelf this wide lays out its cards: as many as fit at `minCardWidth`, stretched to fill the row. */
export function shelfLayout(width: number, options: ShelfOptions = {}): ShelfLayout {
  const { minCardWidth = SHELF_MIN_CARD_WIDTH, maxCards = SHELF_MAX_CARDS, gap = SHELF_GAP } = options;
  const perView = gridColumns(width, { minItemWidth: minCardWidth, gap, maxColumns: maxCards });
  const cardWidth = gridItemWidth(width, perView, gap);
  return { perView, cardWidth, step: cardWidth + gap, gap };
}

/** Total width of `count` cards in a row. */
export function rowWidth(count: number, cardWidth: number, gap: number): number {
  const n = Math.max(0, Math.floor(count));
  return n === 0 ? 0 : n * cardWidth + (n - 1) * gap;
}

export interface ScrollMetrics {
  /** How far the row is scrolled (px). */
  offset: number;
  /** Visible width of the row. */
  viewport: number;
  /** Width of everything in the row. */
  content: number;
}

const EDGE_TOLERANCE = 1;

/** Which arrows a shelf can use: back when it isn't at the start, forward when there is more to the right. */
export function shelfArrows({ offset, viewport, content }: ScrollMetrics): { prev: boolean; next: boolean } {
  const max = Math.max(0, content - viewport);
  return {
    prev: offset > EDGE_TOLERANCE,
    next: offset < max - EDGE_TOLERANCE,
  };
}

/** True when a shelf's cards don't all fit, so it needs its arrows at all. */
export function shelfOverflows(count: number, perView: number): boolean {
  return count > perView;
}

/**
 * Where an arrow scrolls the shelf to: one view of whole cards further, starting at a card's edge, never past
 * either end. From a half-scrolled position (a trackpad swipe) it lines up with the nearest card first.
 */
export function shelfScrollTarget(
  metrics: ScrollMetrics,
  direction: 'prev' | 'next',
  shelf: Pick<ShelfLayout, 'perView' | 'step'>,
): number {
  const { offset, viewport, content } = metrics;
  const max = Math.max(0, content - viewport);
  const step = Math.max(1, shelf.step);
  const perView = Math.max(1, Math.floor(shelf.perView));
  const current = Math.round(Math.max(0, offset) / step);
  const target = (direction === 'next' ? current + perView : current - perView) * step;
  return Math.min(max, Math.max(0, target));
}

/**
 * Home on wide windows: short shelves share a row, two side by side, so a small catalog doesn't leave a page of
 * near-empty rows. Two neighbours pair up when each has no more cards than half a row holds. That only happens
 * when a full row holds an even number of cards (4 or more): two halves with the shelf gap between them then
 * hold exactly half the cards each, at the same card width, so the paired covers line up with the full rows
 * above and below. Order is kept; anything that can't pair stays on its own row.
 */
export type ShelfGroup<T> = readonly [T] | readonly [T, T];

export function pairShelves<T>(shelves: readonly T[], count: (shelf: T) => number, perView: number): ShelfGroup<T>[] {
  const per = Math.floor(perView);
  const half = per >= 4 && per % 2 === 0 ? per / 2 : 0;
  const fits = (shelf: T) => count(shelf) > 0 && count(shelf) <= half;
  const groups: ShelfGroup<T>[] = [];
  let i = 0;
  while (i < shelves.length) {
    const shelf = shelves[i] as T;
    if (half > 0 && i + 1 < shelves.length && fits(shelf) && fits(shelves[i + 1] as T)) {
      groups.push([shelf, shelves[i + 1] as T]);
      i += 2;
    } else {
      groups.push([shelf]);
      i += 1;
    }
  }
  return groups;
}

// ---- Long lists on a page --------------------------------------------------------------------------------

/** Discover loads its next page when the reader is this close to the bottom (px). */
export const LOAD_MORE_THRESHOLD = 800;

/** True when a vertical scroll is within `threshold` of its end (or everything fits on screen). */
export function nearEnd({ offset, viewport, content }: ScrollMetrics, threshold: number = LOAD_MORE_THRESHOLD): boolean {
  return content - (offset + viewport) <= threshold;
}

/** Episodes the wide series page shows at first, and how many more each "Show more" adds. */
export const EPISODE_BATCH = 30;

/** How many episodes are on screen after one more "Show more" (never more than there are). */
export function nextEpisodeCount(shown: number, total: number, batch: number = EPISODE_BATCH): number {
  return Math.min(Math.max(0, total), Math.max(0, shown) + Math.max(1, batch));
}

/** Episodes still hidden behind "Show more". */
export function hiddenEpisodeCount(shown: number, total: number): number {
  return Math.max(0, total - Math.max(0, shown));
}

// ---- Side panels -----------------------------------------------------------------------------------------

export const FILTER_PANEL_WIDE = 264;
export const FILTER_PANEL_MEDIUM = 232;

/** Discover's filter panel beside the results. */
export function filterPanelWidth(size: LayoutSize): number {
  return size === 'wide' ? FILTER_PANEL_WIDE : FILTER_PANEL_MEDIUM;
}

/** The series page's side panel (cover, title, actions) on wide windows: at most this wide... */
export const SERIES_SIDE_WIDTH = 320;
/** ...and never narrower than this (Follow and Report still sit side by side). */
export const SERIES_SIDE_MIN_WIDTH = 280;
/** The side panel's cover takes at most this share of the window's height. */
const SERIES_COVER_HEIGHT_SHARE = 0.45;
/** Covers are 3:4 (components/Cover.tsx). */
const COVER_WIDTH_PER_HEIGHT = 3 / 4;

/**
 * Width of the series page's side panel (and its cover) in a window this tall. A laptop window of 800 px or so
 * leaves room under the top bar for a cover, the title and the buttons only when the cover is a little
 * smaller, so Play stays on screen without scrolling; taller windows get the full width.
 */
export function seriesSideWidth(windowHeight: number): number {
  if (!(windowHeight > 0)) return SERIES_SIDE_WIDTH;
  const fit = Math.floor(windowHeight * SERIES_COVER_HEIGHT_SHARE * COVER_WIDTH_PER_HEIGHT);
  return Math.min(SERIES_SIDE_WIDTH, Math.max(SERIES_SIDE_MIN_WIDTH, fit));
}

/**
 * A side panel may stick (stay in view while the page scrolls) only when all of it fits in the visible part
 * of the page with room above and below; a taller one would hide its lower buttons until the page ends.
 */
export function canStickSide(sideHeight: number, viewportHeight: number, margin: number = space.lg): boolean {
  if (!(sideHeight > 0) || !(viewportHeight > 0)) return false;
  return sideHeight + 2 * margin <= viewportHeight;
}

// ---- Home's hero -----------------------------------------------------------------------------------------

export const HERO_COVER_WIDE = 240;
export const HERO_COVER_MEDIUM = 200;

/** The cover in Home's featured panel. */
export function heroCoverWidth(size: LayoutSize): number {
  return size === 'wide' ? HERO_COVER_WIDE : HERO_COVER_MEDIUM;
}

/** The demo story panel beside the featured story on wide windows. */
export const HERO_SIDE_WIDTH = layout.sidePanelWidth;

/**
 * The Editor's Pick Home features. The panel beside it already invites people into an AI story, so the first
 * pick that isn't made with AI goes here when there is one (it shows the range of the catalog); otherwise the
 * first pick. Picks arrive in the catalog's own order (newest first).
 */
export function featuredSeries<T extends Pick<SeriesCard, 'editors_pick' | 'format' | 'origin'>>(picks: readonly T[]): T | null {
  const eligible = picks.filter((s) => s.editors_pick);
  return eligible.find((s) => !isAiSeries(s)) ?? eligible[0] ?? null;
}

// ---- Links that compute their target when clicked ----------------------------------------------------------

export interface ClickLike {
  button?: number;
  metaKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  defaultPrevented?: boolean;
}

/**
 * A plain left click (or Enter on a link), which the app handles itself. With Cmd, Ctrl, Shift or Alt held,
 * or another button, the browser does what it always does with a link (a new tab or window).
 */
export function isPlainClick(event: ClickLike | null | undefined): boolean {
  if (!event || event.defaultPrevented) return false;
  if (event.button !== undefined && event.button !== null && event.button !== 0) return false;
  return !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
}
