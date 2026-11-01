// Demo-mode data of the catalog track: the shared series fixtures (src/demo) with the catalog's own state on
// top (what is followed, what was watched, what is unlocked). Nothing here touches the network, and nothing
// is purchasable: unlocking in the demo only changes a cell in memory.
//
// Imports carry the .ts extension so node can run the tests that read this file.

import type { EpisodePrice } from '@reeltale/shared';
import {
  demoCreators, demoEpisodes, demoEpisodesOf, demoSeries, demoTags,
} from '../../demo/fixtures.ts';
import { demoState } from '../../demo/state.ts';
import type { ProfileRow, SeriesRow, TagRow } from '../../lib/types.ts';
import {
  applyCardQuery, buildHistory, freeByRule,
  type CardQuery, type EpisodeBrief, type EpisodeItem, type FollowRow, type HistoryEntry, type ProgressRow,
  type QueryContext, type SeriesCard,
} from './logic.ts';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Trending order of the demo series, best first. The fixtures all share one date, so this is set by hand. */
export const DEMO_TRENDING_ORDER: readonly string[] = [
  'the-clockmakers-mice', 'low-tide', 'salt-and-static', 'neon-ronin', 'paper-moons', 'night-shift-at-the-wax-museum',
];

/** When each demo series came out, in days before today, so "New" has something in it and something not. */
const DAYS_SINCE_PUBLISHED: Record<string, number> = {
  'salt-and-static': 2,
  'low-tide': 3,
  'neon-ronin': 6,
  'night-shift-at-the-wax-museum': 9,
  'the-clockmakers-mice': 20,
  'paper-moons': 40,
};

export function demoCatalog(now: Date = new Date()): SeriesRow[] {
  return demoSeries.map((s) => {
    const days = DAYS_SINCE_PUBLISHED[s.slug] ?? 30;
    const at = new Date(now.getTime() - days * DAY_MS).toISOString();
    return { ...s, published_at: at, created_at: at, updated_at: at };
  });
}

const catalogCell = demoState('catalog.series', () => demoCatalog());
const followsCell = demoState<readonly FollowRow[]>('catalog.follows', () => {
  const clockmakers = demoSeries.find((s) => s.slug === 'the-clockmakers-mice');
  return clockmakers ? [{ series_id: clockmakers.id, created_at: new Date(Date.now() - 2 * DAY_MS).toISOString() }] : [];
});
const unlockedCell = demoState<readonly string[]>('catalog.unlocked', () => []);
const progressCell = demoState<readonly ProgressRow[]>('catalog.progress', () => {
  const now = Date.now();
  const ep = (slug: string, number: number) => {
    const series = demoSeries.find((s) => s.slug === slug);
    return series ? demoEpisodesOf(series.id)[number - 1] : undefined;
  };
  const rows: [string, number, number, boolean, number][] = [
    // slug, episode number, seconds in, finished, hours ago
    ['salt-and-static', 2, 38, false, 3],
    ['low-tide', 3, 20, false, 30],
    ['the-clockmakers-mice', 1, 70, true, 26],
    ['salt-and-static', 1, 95, true, 72],
  ];
  return rows.flatMap(([slug, number, position, completed, hoursAgo]) => {
    const episode = ep(slug, number);
    return episode
      ? [{ episode_id: episode.id, position_s: position, completed, updated_at: new Date(now - hoursAgo * HOUR_MS).toISOString() }]
      : [];
  });
});

/** The watch track can call this when the demo player moves (it only changes memory). */
export function recordDemoProgress(episodeId: string, positionS: number, completed: boolean): void {
  const row: ProgressRow = {
    episode_id: episodeId,
    position_s: Math.max(0, Math.min(120, Math.round(positionS))),
    completed,
    updated_at: new Date().toISOString(),
  };
  progressCell.set((rows) => [row, ...rows.filter((r) => r.episode_id !== episodeId)]);
}

/** The watch track can call this when the demo unlocks an episode. */
export function markDemoUnlocked(episodeId: string): void {
  unlockedCell.set((ids) => (ids.includes(episodeId) ? ids : [...ids, episodeId]));
}

// ---- What the sources return -----------------------------------------------------------------------------

export function demoTagRows(): readonly TagRow[] {
  return demoTags;
}

function context(matureOptIn: boolean): QueryContext {
  return { tags: demoTags, matureOptIn, trendingOrder: DEMO_TRENDING_ORDER };
}

export function demoCards(q: CardQuery, matureOptIn: boolean): SeriesCard[] {
  return applyCardQuery(catalogCell.get(), q, context(matureOptIn));
}

/** The series page's row, or null the way RLS hides a mature series from a reader who hasn't opted in. */
export function demoSeriesBySlug(slug: string, matureOptIn: boolean): SeriesRow | null {
  const row = catalogCell.get().find((s) => s.slug === slug);
  return row && (row.maturity === 'general' || matureOptIn) ? row : null;
}

export function demoEpisodeItems(seriesId: string): EpisodeItem[] {
  return demoEpisodesOf(seriesId);
}

export function demoCreator(creatorId: string): Pick<ProfileRow, 'id' | 'handle' | 'display_name'> | null {
  const c = demoCreators.find((p) => p.id === creatorId);
  return c ? { id: c.id, handle: c.handle, display_name: c.display_name } : null;
}

/** get_episode_price for the demo: the same rules in miniature, with the price from the fixtures. */
export function demoEpisodePrice(episodeId: string): EpisodePrice {
  const episode = demoEpisodes.find((e) => e.id === episodeId);
  const series = episode ? demoSeries.find((s) => s.id === episode.series_id) : undefined;
  if (!episode || !series) {
    return { purchasable: false, free: false, own: false, base_price: 0, discount_pct: 0, price: 0, reason: 'not_available', unlocked: false };
  }
  const unlocked = unlockedCell.get().includes(episodeId);
  if (freeByRule(series, episode) || series.default_price_coins === null) {
    return { purchasable: true, free: true, own: false, base_price: 0, discount_pct: 0, price: 0, reason: 'free', unlocked };
  }
  const base = episode.price_coins ?? series.default_price_coins;
  return { purchasable: true, free: false, own: false, base_price: base, discount_pct: 0, price: base, reason: 'priced', unlocked };
}

export function demoFollows(): readonly FollowRow[] {
  return followsCell.get();
}

export function demoIsFollowing(seriesId: string): boolean {
  return followsCell.get().some((f) => f.series_id === seriesId);
}

export function demoSetFollow(seriesId: string, on: boolean): void {
  followsCell.set((rows) => {
    const rest = rows.filter((f) => f.series_id !== seriesId);
    return on ? [{ series_id: seriesId, created_at: new Date().toISOString() }, ...rest] : rest;
  });
}

export function demoProgress(): readonly ProgressRow[] {
  return progressCell.get();
}

export function demoHistory(limit: number, matureOptIn: boolean): HistoryEntry[] {
  const catalog = catalogCell.get().filter((s) => s.maturity === 'general' || matureOptIn);
  const briefs: readonly EpisodeBrief[] = demoEpisodes;
  const rows = [...progressCell.get()].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, limit);
  return buildHistory(rows, briefs, catalog);
}
