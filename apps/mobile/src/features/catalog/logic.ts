// The catalog's pure logic: what Home, Discover, Library and the series page decide, with no React and no
// Supabase, so node can test it (src/core/__tests__/catalog.test.ts). Relative imports carry the .ts
// extension for the same reason.
//
// The live queries run in SQL (sources.ts); `applyCardQuery` is the same filter, order and paging done in
// memory, for demo mode.

import type { EpisodePrice } from '@reeltale/shared';
import type { EpisodeRow, SeriesFormat, SeriesRow, TagRow } from '../../lib/types.ts';

// ---- What the screens read -----------------------------------------------------------------------------

/** A subset of the granted public.series columns: what a card in a shelf, grid or list needs. */
export const SERIES_CARD_COLUMNS =
  'id, slug, title, cover_key, format, origin, editors_pick, maturity, completed, tag_ids, published_at';
export type SeriesCard = Pick<
  SeriesRow,
  'id' | 'slug' | 'title' | 'cover_key' | 'format' | 'origin' | 'editors_pick' | 'maturity' | 'completed' | 'tag_ids' | 'published_at'
>;

/** What the episode list of a series page needs (a subset of the granted public.episodes columns). */
export const EPISODE_ITEM_COLUMNS = 'id, series_id, number, title, duration_s, kind, price_coins, is_free, status';
export type EpisodeItem = Pick<
  EpisodeRow,
  'id' | 'series_id' | 'number' | 'title' | 'duration_s' | 'kind' | 'price_coins' | 'is_free' | 'status'
>;

/** Enough of an episode to say what was watched. */
export const EPISODE_BRIEF_COLUMNS = 'id, series_id, number, title, duration_s';
export type EpisodeBrief = Pick<EpisodeRow, 'id' | 'series_id' | 'number' | 'title' | 'duration_s'>;

/** public.watch_progress (the columns the owner may read). */
export const PROGRESS_COLUMNS = 'episode_id, position_s, completed, updated_at';
export interface ProgressRow {
  episode_id: string;
  position_s: number;
  completed: boolean;
  updated_at: string;
}

export interface FollowRow {
  series_id: string;
  created_at: string;
}

/** A series made with AI, in either field the catalog keeps it in: it always carries the AI label. */
export function isAiSeries(series: Pick<SeriesCard, 'format' | 'origin'>): boolean {
  return series.format === 'ai_generated' || series.origin === 'ai_story';
}

// ---- Rankings, filters, paging -------------------------------------------------------------------------

export const RANKINGS = ['trending', 'new', 'completed', 'editorsPicks', 'aiStories'] as const;
export type Ranking = (typeof RANKINGS)[number];

export function isRanking(value: unknown): value is Ranking {
  return typeof value === 'string' && (RANKINGS as readonly string[]).includes(value);
}

export const PAGE_SIZE = 20;
/** Cards in a Home shelf. */
export const SHELF_SIZE = 12;
/** Series first published this recently count as new. */
export const NEW_WINDOW_DAYS = 14;
export const MAX_FILTER_TAGS = 6;

export interface CardQuery {
  ranking?: Ranking;
  formats?: readonly SeriesFormat[];
  /** The series must carry all of these tags. */
  tagIds?: readonly number[];
  search?: string;
  limit?: number;
  offset?: number;
}

/** Same query, same key: the part of a query key that says what was asked (paging is not part of it). */
export function cardKey(q: CardQuery): string {
  const parts = [
    q.ranking ?? 'all',
    `f:${[...(q.formats ?? [])].sort().join(',')}`,
    `t:${[...(q.tagIds ?? [])].sort((a, b) => a - b).join(',')}`,
    `s:${searchTerm(q.search ?? '')?.toLowerCase() ?? ''}`,
    `l:${q.limit ?? PAGE_SIZE}`,
  ];
  return parts.join('|');
}

// ---- Search --------------------------------------------------------------------------------------------

export const MIN_SEARCH_LENGTH = 2;
export const MAX_SEARCH_LENGTH = 80;

/** What was typed, made safe to send: control characters and runs of spaces gone, at most 80 characters. */
export function cleanSearch(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH_LENGTH);
}

/** The text to search for, or null while there is too little of it to be worth a request. */
export function searchTerm(raw: string): string | null {
  const term = cleanSearch(raw);
  return term.length >= MIN_SEARCH_LENGTH ? term : null;
}

/** An `ilike` pattern for the title that finds `term` anywhere, with LIKE's own characters taken literally. */
export function titlePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Postgres 42501: the database refused a column or table. Search falls back to the title when `fts` isn't granted. */
export function isPermissionDenied(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === '42501';
}

// ---- Pictures ------------------------------------------------------------------------------------------

const MEDIA_FOLDERS = ['covers', 'posters', 'previews'];
const MEDIA_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The public address of a media key like `public/covers/abc.jpg`, or null for anything else (no key, another
 * folder, dots or odd characters in a path segment). Keys come from reviewed rows; this still refuses to
 * build a URL out of a key that isn't shaped like one.
 */
export function mediaUrl(key: string | null | undefined, origin: string): string | null {
  if (!key) return null;
  const parts = key.split('/');
  if (parts.length < 3 || parts[0] !== 'public' || !MEDIA_FOLDERS.includes(parts[1] ?? '')) return null;
  if (!parts.slice(1).every((p) => MEDIA_SEGMENT.test(p))) return null;
  return `${origin.replace(/\/+$/, '')}/${key}`;
}

// ---- Tags ----------------------------------------------------------------------------------------------

/** The name in the app's language, else English. */
export function tagLabel(tag: TagRow, language: string): string {
  const lang = language.split('-')[0] ?? 'en';
  return tag.name_i18n[language] ?? tag.name_i18n[lang] ?? tag.name_i18n.en;
}

function byTagOrder(a: TagRow, b: TagRow): number {
  return a.sort - b.sort || a.id - b.id;
}

/** The tags people can browse by: genres and tropes, each in the catalog's own order. Content warnings are not filters. */
export function browsableTags(tags: readonly TagRow[]): { genre: TagRow[]; trope: TagRow[] } {
  return {
    genre: tags.filter((t) => t.kind === 'genre').sort(byTagOrder),
    trope: tags.filter((t) => t.kind === 'trope').sort(byTagOrder),
  };
}

/** The tags of a series in display order: genres, then tropes, then content warnings. Unknown ids are skipped. */
export function tagsOfSeries(tagIds: readonly number[], tags: readonly TagRow[]): TagRow[] {
  const byId = new Map(tags.map((t) => [t.id, t]));
  const rank = { genre: 0, trope: 1, warning: 2 } as const;
  return tagIds
    .map((id) => byId.get(id))
    .filter((t): t is TagRow => !!t)
    .sort((a, b) => rank[a.kind] - rank[b.kind] || byTagOrder(a, b));
}

// ---- Grid layout ---------------------------------------------------------------------------------------

/** Columns of the Discover grid for a screen this wide (two on phones, more on tablets and the web). */
export function gridColumns(width: number): number {
  if (width >= 1100) return 5;
  if (width >= 840) return 4;
  if (width >= 600) return 3;
  return 2;
}

/** Width of one card in a grid, in whole points so rows line up. */
export function gridCardWidth(width: number, columns: number, gutter: number, gap: number): number {
  return Math.max(0, Math.floor((width - 2 * gutter - gap * (columns - 1)) / columns));
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---- Home ----------------------------------------------------------------------------------------------

export interface GenreShelf {
  tag: TagRow;
  items: SeriesCard[];
}

export interface HomeShelves {
  trending: SeriesCard[];
  /** Empty when it would only repeat Trending. */
  fresh: SeriesCard[];
  genres: GenreShelf[];
}

const DAY_MS = 86_400_000;
export const MAX_GENRE_SHELVES = 3;

function publishedAtMs(s: Pick<SeriesCard, 'published_at'>): number {
  const ms = s.published_at ? Date.parse(s.published_at) : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * The rows of Home, all cut from one list of series that is already in Trending order (for now: most
 * recently published first). New is the same series by publish date, within two weeks, and is left out when
 * it would be the very same row. Genre shelves are the genres most of the list belongs to.
 */
export function buildHomeShelves(pool: readonly SeriesCard[], tags: readonly TagRow[], now: Date): HomeShelves {
  const trending = pool.slice(0, SHELF_SIZE);
  const since = now.getTime() - NEW_WINDOW_DAYS * DAY_MS;
  const fresh = [...pool]
    .filter((s) => publishedAtMs(s) >= since)
    .sort((a, b) => publishedAtMs(b) - publishedAtMs(a) || a.id.localeCompare(b.id))
    .slice(0, SHELF_SIZE);
  const same = fresh.length === trending.length && fresh.every((s, i) => s.id === trending[i]?.id);

  const genres = browsableTags(tags).genre
    .map((tag) => ({ tag, items: pool.filter((s) => s.tag_ids.includes(tag.id)).slice(0, SHELF_SIZE) }))
    .filter((shelf) => shelf.items.length > 0)
    // Biggest shelves first; the catalog's tag order breaks ties (sort is stable).
    .sort((a, b) => b.items.length - a.items.length)
    .slice(0, MAX_GENRE_SHELVES);

  return { trending, fresh: same ? [] : fresh, genres };
}

// ---- Watch history -------------------------------------------------------------------------------------

export interface HistoryEntry {
  episode: EpisodeBrief;
  series: SeriesCard;
  positionS: number;
  completed: boolean;
  updatedAt: string;
  /** 0 to 100. */
  percent: number;
}

export function progressPercent(positionS: number, durationS: number | null, completed: boolean): number {
  if (completed) return 100;
  if (!durationS || durationS <= 0 || !Number.isFinite(positionS)) return 0;
  return Math.max(0, Math.min(100, Math.round((positionS / durationS) * 100)));
}

/**
 * Join progress rows (newest first, as the server returns them) with their episodes and series. A row whose
 * episode or series can't be seen any more (removed, hidden) is dropped; the order stays.
 */
export function buildHistory(
  progress: readonly ProgressRow[],
  episodes: readonly EpisodeBrief[],
  series: readonly SeriesCard[],
): HistoryEntry[] {
  const episodeById = new Map(episodes.map((e) => [e.id, e]));
  const seriesById = new Map(series.map((s) => [s.id, s]));
  const out: HistoryEntry[] = [];
  for (const p of progress) {
    const episode = episodeById.get(p.episode_id);
    const s = episode ? seriesById.get(episode.series_id) : undefined;
    if (!episode || !s) continue;
    out.push({
      episode,
      series: s,
      positionS: p.position_s,
      completed: p.completed,
      updatedAt: p.updated_at,
      percent: progressPercent(p.position_s, episode.duration_s, p.completed),
    });
  }
  return out;
}

/**
 * "Continue watching": per series, the episode watched last, if it isn't finished. A series whose last
 * episode was finished has nothing to continue.
 */
export function continueWatching(history: readonly HistoryEntry[], limit: number): HistoryEntry[] {
  const seen = new Set<string>();
  const out: HistoryEntry[] = [];
  for (const entry of history) {
    if (seen.has(entry.series.id)) continue;
    seen.add(entry.series.id);
    if (!entry.completed) out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}

/** Followed series in the order they were followed (newest first), minus any the reader can't see now. */
export function orderFollowing(follows: readonly FollowRow[], series: readonly SeriesCard[]): SeriesCard[] {
  const byId = new Map(series.map((s) => [s.id, s]));
  return follows.map((f) => byId.get(f.series_id)).filter((s): s is SeriesCard => !!s);
}

// ---- The series page -----------------------------------------------------------------------------------

export interface Resume {
  episodeId: string;
  number: number;
  /** True when this continues something watched; false when it starts from the first episode. */
  resumed: boolean;
}

/**
 * Where "Play" / "Continue" goes: the episode watched last if it isn't finished, the one after it if it is,
 * and the first episode when nothing was watched (or the last episode was finished: start over).
 */
export function pickResume(
  episodes: readonly Pick<EpisodeItem, 'id' | 'number'>[],
  progress: readonly ProgressRow[],
): Resume | null {
  const ordered = [...episodes].sort((a, b) => a.number - b.number);
  const first = ordered[0];
  if (!first) return null;
  const byId = new Map(ordered.map((e) => [e.id, e]));

  let latest: { row: ProgressRow; number: number } | null = null;
  for (const row of progress) {
    const ep = byId.get(row.episode_id);
    if (!ep) continue;
    if (!latest || Date.parse(row.updated_at) > Date.parse(latest.row.updated_at)) latest = { row, number: ep.number };
  }
  if (!latest) return { episodeId: first.id, number: first.number, resumed: false };
  if (!latest.row.completed) return { episodeId: latest.row.episode_id, number: latest.number, resumed: true };
  const latestNumber = latest.number;
  const next = ordered.find((e) => e.number > latestNumber);
  return next
    ? { episodeId: next.id, number: next.number, resumed: true }
    : { episodeId: first.id, number: first.number, resumed: false };
}

export type EpisodeState = 'free' | 'unlocked' | 'priced' | 'locked';

/**
 * public.resolve_episode_price makes the episodes of a community AI story free; an Editor's Pick keeps normal
 * pricing. The series page says so ("Free to watch") and the rows skip the price request. Only while the
 * series is published: a hidden one (kept by its buyers through RLS) is "not available" to everyone else.
 */
export function isFreeAiSeries(series: Pick<SeriesRow, 'status' | 'format' | 'editors_pick'>): boolean {
  return series.status === 'published' && series.format === 'ai_generated' && !series.editors_pick;
}

/**
 * Free without asking the server: public.resolve_episode_price makes a published episode of a published
 * series free when it is marked free, is within the series' free episodes, or belongs to a community AI story.
 * Anything else (closed, hidden, priced, creator status) is the server's call, through get_episode_price.
 */
export function freeByRule(
  series: Pick<SeriesRow, 'status' | 'free_episode_count' | 'format' | 'editors_pick'>,
  episode: Pick<EpisodeItem, 'number' | 'is_free' | 'status'>,
): boolean {
  return (
    series.status === 'published' &&
    episode.status === 'published' &&
    (episode.is_free || episode.number <= series.free_episode_count || isFreeAiSeries(series))
  );
}

/** What the episode row shows, from public.get_episode_price. */
export function episodeState(price: EpisodePrice): EpisodeState {
  if (price.free || price.own) return 'free';
  if (price.unlocked) return 'unlocked';
  if (price.purchasable && price.price > 0) return 'priced';
  return 'locked';
}

/** A series description is long enough to fold behind "Show more". */
export const SYNOPSIS_FOLD_LENGTH = 180;

// ---- The same queries in memory (demo mode) ------------------------------------------------------------

export interface QueryContext {
  tags: readonly TagRow[];
  /** Mature series are only listed to readers who opted in (RLS does this in the database). */
  matureOptIn: boolean;
  /** Series slugs in Trending order, best first. */
  trendingOrder?: readonly string[];
}

type Searchable = SeriesCard & { synopsis?: string };

function matchesSearch(series: Searchable, term: string, tags: readonly TagRow[]): boolean {
  const tagNames = tags.filter((t) => series.tag_ids.includes(t.id)).map((t) => t.name_i18n.en);
  const haystack = [series.title, series.synopsis ?? '', ...tagNames].join(' ').toLowerCase();
  return term.toLowerCase().split(' ').every((word) => haystack.includes(word));
}

/** Filter, order and page a list of series the way the database query does. */
export function applyCardQuery<T extends Searchable>(all: readonly T[], q: CardQuery, ctx: QueryContext): T[] {
  const term = searchTerm(q.search ?? '');
  const order = ctx.trendingOrder ?? [];
  const rank = (s: T) => {
    const i = order.indexOf(s.slug);
    return i === -1 ? order.length : i;
  };

  let list = all.filter((s) => s.maturity === 'general' || ctx.matureOptIn);
  if (q.ranking === 'completed') list = list.filter((s) => s.completed);
  if (q.ranking === 'editorsPicks') list = list.filter((s) => s.editors_pick);
  if (q.ranking === 'aiStories') list = list.filter((s) => s.format === 'ai_generated');
  if (q.formats?.length) list = list.filter((s) => q.formats?.includes(s.format));
  if (q.tagIds?.length) list = list.filter((s) => q.tagIds?.every((id) => s.tag_ids.includes(id)));
  if (term) list = list.filter((s) => matchesSearch(s, term, ctx.tags));

  const newestFirst = (a: T, b: T) => publishedAtMs(b) - publishedAtMs(a) || a.id.localeCompare(b.id);
  list = [...list].sort(q.ranking === 'trending' ? (a, b) => rank(a) - rank(b) || newestFirst(a, b) : newestFirst);

  const offset = q.offset ?? 0;
  return list.slice(offset, offset + (q.limit ?? PAGE_SIZE));
}
