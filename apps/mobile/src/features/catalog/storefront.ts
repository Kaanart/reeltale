// Home as a storefront (the website's front page): which series go in which section, and the arithmetic of the
// "Weekly pick" carousel and the "Switch" row. No React and no Supabase, so node can test it
// (src/core/__tests__/storefront.test.ts). Relative imports carry the .ts extension for the same reason.
//
// Everything here works from what the catalog really has: rankings (Trending order, publish date, completed,
// Editor's Picks), tags, and episode lists. Nothing is scored or counted that the database doesn't hold.

import { gridColumns } from '../../components/layout/logic.ts';
import type { TagRow } from '../../lib/types.ts';
import { browsableTags, isAiSeries, tagsOfSeries, type EpisodeItem, type SeriesCard } from './logic.ts';

/** Series in the "Weekly pick" carousel. */
export const HERO_MAX = 4;
/** Most covers "Weekly featured" shows at once (one row on a wide window); "Switch" moves on by one view. */
export const FEATURED_PAGE = 8;
/**
 * Narrowest a storefront poster gets: the small AI label (about 107 px) has to fit on the picture beside its
 * 8 px inset without wrapping. Phones use exactly this width in a row that scrolls sideways.
 */
export const POSTER_MIN_WIDTH = 124;
/** Rows in each ranking column (01 to 05). */
export const RANK_SIZE = 5;
/** Covers in the "New arrivals" strip. */
export const ARRIVALS_MAX = 9;
/** Series in the "Editors' choice" grid. */
export const EDITORS_MAX = 6;
/** Covers in the "Completed series" row. */
export const COMPLETED_MAX = 8;
/** Chips under "Popular tags". */
export const POPULAR_TAGS_MAX = 18;
/** The carousel moves on by itself this often (it stops under the mouse, with the keyboard focus, or when paused). */
export const CAROUSEL_INTERVAL_MS = 6000;

type Identified = { id: string };

/** The list without repeats (the first of each id stays), in order. */
export function uniqueById<T extends Identified>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function publishedMs(s: Pick<SeriesCard, 'published_at'>): number {
  const ms = s.published_at ? Date.parse(s.published_at) : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

/** Newest first by publish date (what Discover's "New" shows); id breaks ties so the order is stable. */
export function newestFirst<T extends Pick<SeriesCard, 'id' | 'published_at'>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => publishedMs(b) - publishedMs(a) || a.id.localeCompare(b.id));
}

// ---- The sections --------------------------------------------------------------------------------------

type HeroCandidate = Identified & Pick<SeriesCard, 'editors_pick' | 'format' | 'origin'>;

/**
 * The "Weekly pick" carousel: Editor's Picks first, then Trending fills it up to `max`. The first slide is a
 * pick that isn't made with AI when there is one (the panel beside it already invites people to make an AI
 * story), as the old featured panel did.
 */
export function heroSeries<T extends HeroCandidate>(picks: readonly T[], trending: readonly T[], max: number = HERO_MAX): T[] {
  const eligible = picks.filter((s) => s.editors_pick);
  const lead = eligible.find((s) => !isAiSeries(s));
  const ordered = lead ? [lead, ...eligible.filter((s) => s !== lead)] : eligible;
  return uniqueById([...ordered, ...trending]).slice(0, Math.max(0, Math.floor(max)));
}

export interface StorefrontInput<T> {
  /** Published series in Trending order (the catalog's own order). */
  pool: readonly T[];
  /** Editor's Picks. */
  picks: readonly T[];
  /** Completed series. */
  completed: readonly T[];
}

export interface Storefront<T> {
  hero: T[];
  /** Everything "Weekly featured" cycles through, in Trending order. */
  featured: T[];
  rankings: { trending: T[]; fresh: T[]; completed: T[] };
  arrivals: T[];
  editors: T[];
  completed: T[];
}

type StoreSeries = HeroCandidate & Pick<SeriesCard, 'published_at' | 'completed'>;

/** What each section of the storefront lists, cut from the catalog's own lists. */
export function buildStorefront<T extends StoreSeries>({ pool, picks, completed }: StorefrontInput<T>): Storefront<T> {
  const trending = uniqueById(pool);
  const fresh = newestFirst(trending);
  const done = uniqueById(completed).filter((s) => s.completed);
  const editors = uniqueById(picks).filter((s) => s.editors_pick);
  return {
    hero: heroSeries(editors, trending),
    featured: trending,
    rankings: {
      trending: trending.slice(0, RANK_SIZE),
      fresh: fresh.slice(0, RANK_SIZE),
      completed: done.slice(0, RANK_SIZE),
    },
    arrivals: fresh.slice(0, ARRIVALS_MAX),
    editors: editors.slice(0, EDITORS_MAX),
    completed: done.slice(0, COMPLETED_MAX),
  };
}

/**
 * "Popular tags": the genres and tropes the most series carry (among those listed), most first, the catalog's
 * own tag order breaking ties (genres before tropes). Tags no series carries are left out, so every chip leads
 * somewhere. Content warnings are never filters.
 */
export function popularTags(
  tags: readonly TagRow[],
  series: readonly Pick<SeriesCard, 'tag_ids'>[],
  max: number = POPULAR_TAGS_MAX,
): TagRow[] {
  const counts = new Map<number, number>();
  for (const s of series) for (const id of new Set(s.tag_ids)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const { genre, trope } = browsableTags(tags);
  return [...genre, ...trope]
    .map((tag, order) => ({ tag, order, n: counts.get(tag.id) ?? 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.order - b.order)
    .slice(0, Math.max(0, Math.floor(max)))
    .map((x) => x.tag);
}

/** The series' first genre in the catalog's order (the word a card shows next to the format), if it has one. */
export function primaryGenre(series: Pick<SeriesCard, 'tag_ids'>, tags: readonly TagRow[]): TagRow | null {
  return tagsOfSeries(series.tag_ids, tags).find((t) => t.kind === 'genre') ?? null;
}

/** How many episodes a series has, and the first one ("Watch now"), from its episode list. */
export function episodeSummary(
  episodes: readonly Pick<EpisodeItem, 'id' | 'number'>[] | null | undefined,
): { count: number; firstId: string | null } {
  if (!episodes || episodes.length === 0) return { count: 0, firstId: null };
  const first = episodes.reduce((a, b) => (b.number < a.number ? b : a));
  return { count: episodes.length, firstId: first.id };
}

// ---- Rankings ------------------------------------------------------------------------------------------

/** "01" to "05". */
export function rankLabel(index: number): string {
  return String(Math.max(0, Math.floor(index)) + 1).padStart(2, '0');
}

/** The top three numbers each get their own colour; the rest are muted. */
export function rankTone(index: number): 'first' | 'second' | 'third' | null {
  if (index === 0) return 'first';
  if (index === 1) return 'second';
  if (index === 2) return 'third';
  return null;
}

// ---- The carousel --------------------------------------------------------------------------------------

/** `index` brought into 0..count-1, going round at both ends. 0 for an empty carousel. */
export function wrapIndex(index: number, count: number): number {
  if (!(count > 0) || !Number.isFinite(index)) return 0;
  const n = Math.floor(count);
  return ((Math.trunc(index) % n) + n) % n;
}

export type CarouselAction = 'prev' | 'next' | 'first' | 'last';

/** The keys the carousel answers while it has the keyboard focus (a key event's `key`). */
export function carouselKeyAction(key: string): CarouselAction | null {
  switch (key) {
    case 'ArrowLeft': return 'prev';
    case 'ArrowRight': return 'next';
    case 'Home': return 'first';
    case 'End': return 'last';
    default: return null;
  }
}

/** The slide an action leads to. */
export function applyCarouselAction(index: number, action: CarouselAction, count: number): number {
  if (!(count > 0)) return 0;
  switch (action) {
    case 'prev': return wrapIndex(index - 1, count);
    case 'next': return wrapIndex(index + 1, count);
    case 'first': return 0;
    case 'last': return wrapIndex(count - 1, count);
  }
}

export interface AutoAdvanceState {
  count: number;
  /** The reader pressed Pause. */
  paused: boolean;
  /** The mouse is over the carousel (web). */
  hovered: boolean;
  /** The keyboard focus is inside the carousel. */
  focused: boolean;
  /** The system asks for reduced motion. */
  reduceMotion: boolean;
  /** Home is the screen on show (a tab screen stays mounted behind others). */
  screenFocused: boolean;
}

/**
 * Whether the carousel moves on by itself right now: only with more than one slide, while Home is on show, and
 * never under the mouse, with the focus inside, after Pause, or when the system asks for reduced motion.
 */
export function shouldAutoAdvance(s: AutoAdvanceState): boolean {
  return s.count > 1 && s.screenFocused && !s.paused && !s.hovered && !s.focused && !s.reduceMotion;
}

// ---- "Weekly featured" and its Switch button ------------------------------------------------------------

/**
 * `size` items starting at `start`, going round to the beginning, so every view is full. A list no longer than
 * `size` is shown whole, in order.
 */
export function rotatingWindow<T>(items: readonly T[], start: number, size: number = FEATURED_PAGE): T[] {
  const n = items.length;
  const k = Math.max(0, Math.floor(size));
  if (n <= k) return [...items];
  const s = wrapIndex(start, n);
  return Array.from({ length: k }, (_, i) => items[(s + i) % n] as T);
}

/**
 * Posters in one row of "Weekly featured" (and "Completed series") on a medium or wide window: as many as fit
 * at POSTER_MIN_WIDTH or wider, FEATURED_PAGE at most, so the row never wraps into a second row of giant
 * posters. `rowWidth` is the page column's width.
 */
export function posterColumns(rowWidth: number, gap: number): number {
  return gridColumns(rowWidth, { minItemWidth: POSTER_MIN_WIDTH, gap, maxColumns: FEATURED_PAGE });
}

/** Switch has something new to show only when there are more items than one view holds. */
export function canSwitch(count: number, size: number = FEATURED_PAGE): boolean {
  return count > Math.max(0, Math.floor(size));
}

/** Where the next view starts after Switch: `size` further on, going round. */
export function nextWindowStart(start: number, count: number, size: number = FEATURED_PAGE): number {
  if (!canSwitch(count, size)) return 0;
  return wrapIndex(start + Math.floor(size), count);
}

// ---- "Coming soon" placeholders --------------------------------------------------------------------------

/**
 * A "Coming soon" poster holding a place in a row the catalog can't fill yet (the sample catalog has a handful
 * of series; a new live catalog has none). It names no series: no title, genre, label or link of its own.
 * Only the first one in a row is `announced` to screen readers; the rest are hidden, so nobody hears
 * "Coming soon" seven times in a row.
 */
export interface Placeholder {
  placeholder: true;
  /** Unique in its row: "placeholder-5" is the sixth place. */
  key: string;
  announced: boolean;
}

/** One place in a storefront row: a real series, or a placeholder after the real ones. */
export type Slot<T> = T | Placeholder;

export function isPlaceholder<T extends object>(slot: Slot<T>): slot is Placeholder {
  return (slot as Partial<Placeholder>).placeholder === true;
}

/**
 * The row's real items first (at most `size`), then placeholders up to `size`. A full row gets none, and the
 * row is never longer than `size`.
 */
export function padWithPlaceholders<T extends object>(items: readonly T[], size: number): Slot<T>[] {
  const k = Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0;
  const real: Slot<T>[] = items.slice(0, k);
  const pads = Array.from({ length: k - real.length }, (_, i): Placeholder => ({
    placeholder: true,
    key: `placeholder-${real.length + i}`,
    announced: i === 0,
  }));
  return [...real, ...pads];
}

/** A slot's React key: the series id, or the placeholder's own key (they can't clash: ids are UUIDs or slugs). */
export function slotKey(slot: Slot<Identified>): string {
  return isPlaceholder(slot) ? slot.key : slot.id;
}

/** The real series in a row of slots, in order. */
export function realItems<T extends object>(slots: readonly Slot<T>[]): T[] {
  return slots.filter((s): s is T => !isPlaceholder(s));
}

export type HeroMode = 'loading' | 'slides' | 'invite' | 'demo';

/**
 * What the "Weekly pick" spot shows: the carousel whenever there is a series to feature (never padded with
 * placeholders); an invitation to creators ("New series are on the way") when the catalog has none; the demo
 * story when the catalog couldn't be reached (an invitation would claim to know it is empty).
 */
export function heroMode({ loading, failed, count }: { loading: boolean; failed: boolean; count: number }): HeroMode {
  if (loading) return 'loading';
  if (count > 0) return 'slides';
  return failed ? 'demo' : 'invite';
}
