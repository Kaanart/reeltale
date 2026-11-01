// Where the catalog's data comes from: Supabase in the live app (only granted columns, RLS does the rest),
// src/features/catalog/demo.ts in demo mode. Hooks (hooks.ts) call these; screens never do.
//
// RLS lets a creator see their own drafts and a buyer keep a hidden series, so every list asks for
// `status = published` and `moderation_status = approved` itself. Mature series are hidden by RLS until the
// reader opts in (public.my_mature_opt_in), so the live queries don't repeat that.

import { EpisodePriceSchema, type EpisodePrice } from '@reeltale/shared';
import { DataError, db, fromSource, rpc, select } from '../../lib/data';
import {
  SERIES_COLUMNS, TAG_COLUMNS, type ProfileRow, type SeriesRow, type TagRow,
} from '../../lib/types';
import {
  demoCards, demoCreator, demoEpisodeItems, demoEpisodePrice, demoFollows, demoHistory, demoIsFollowing, demoProgress,
  demoSeriesBySlug, demoSetFollow, demoTagRows,
} from './demo';
import {
  chunk, EPISODE_BRIEF_COLUMNS, EPISODE_ITEM_COLUMNS, orderFollowing, PAGE_SIZE, PROGRESS_COLUMNS,
  SERIES_CARD_COLUMNS, searchTerm, buildHistory,
  type CardQuery, type EpisodeBrief, type EpisodeItem, type FollowRow, type HistoryEntry, type ProgressRow, type SeriesCard,
} from './logic';

/** What the demo needs to know about the reader (the live database knows it from the session). */
export interface Reader {
  matureOptIn: boolean;
}

const SLUG = /^[a-z0-9-]{3,90}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `in (…)` lists travel in the URL: keep each one short. */
const IN_CHUNK = 100;
const MAX_EPISODES = 500;
const MAX_FOLLOWS = 200;

// ---- Tags ------------------------------------------------------------------------------------------------

export function fetchTags(): Promise<readonly TagRow[]> {
  return fromSource({
    demo: () => demoTagRows(),
    live: () => select<TagRow[]>(db().from('tags').select(TAG_COLUMNS).order('kind').order('sort')),
  });
}

// ---- Lists of series -------------------------------------------------------------------------------------

// Search uses the series' full-text column (title, tag names and synopsis; granted in 20261027090200_catalog.sql).
function listQuery(q: CardQuery) {
  const limit = q.limit ?? PAGE_SIZE;
  const offset = q.offset ?? 0;
  const term = searchTerm(q.search ?? '');
  let query = db()
    .from('series')
    .select(SERIES_CARD_COLUMNS)
    .eq('status', 'published')
    .eq('moderation_status', 'approved');
  if (q.ranking === 'completed') query = query.eq('completed', true);
  if (q.ranking === 'editorsPicks') query = query.eq('editors_pick', true);
  if (q.ranking === 'aiStories') query = query.eq('format', 'ai_generated');
  if (q.formats?.length) query = query.in('format', [...q.formats]);
  if (q.tagIds?.length) query = query.contains('tag_ids', [...q.tagIds]);
  if (term) query = query.textSearch('fts', term, { type: 'websearch', config: 'simple' });
  // Trending is "most recently published" until there are signals to rank by; id keeps the pages stable.
  return query.order('published_at', { ascending: false }).order('id').range(offset, offset + limit - 1);
}

async function liveCards(q: CardQuery): Promise<SeriesCard[]> {
  return select<SeriesCard[]>(listQuery(q));
}

/** Published series for a shelf, ranking tab or search, a page at a time. */
export function fetchCards(q: CardQuery, reader: Reader): Promise<SeriesCard[]> {
  return fromSource({
    demo: () => demoCards(q, reader.matureOptIn),
    live: () => liveCards(q),
  });
}

async function liveCardsByIds(ids: readonly string[]): Promise<SeriesCard[]> {
  const pages = await Promise.all(
    chunk(ids, IN_CHUNK).map((part) => select<SeriesCard[]>(db().from('series').select(SERIES_CARD_COLUMNS).in('id', part))),
  );
  return pages.flat();
}

// ---- One series ------------------------------------------------------------------------------------------

/** The series page's row. Null when there is no such series for this reader (removed, hidden, or mature without opt-in). */
export function fetchSeries(slug: string, reader: Reader): Promise<SeriesRow | null> {
  if (!SLUG.test(slug)) return Promise.resolve(null);
  return fromSource({
    demo: () => demoSeriesBySlug(slug, reader.matureOptIn),
    live: async () => {
      const row = await select<SeriesRow | null>(db().from('series').select(SERIES_COLUMNS).eq('slug', slug).maybeSingle());
      return row && row.status !== 'removed' ? row : null;
    },
  });
}

export function fetchEpisodes(seriesId: string): Promise<EpisodeItem[]> {
  return fromSource({
    demo: () => demoEpisodeItems(seriesId),
    live: () =>
      select<EpisodeItem[]>(
        db()
          .from('episodes')
          .select(EPISODE_ITEM_COLUMNS)
          .eq('series_id', seriesId)
          .in('status', ['published', 'closed_to_new'])
          .eq('moderation_status', 'approved')
          .order('number')
          .limit(MAX_EPISODES),
      ),
  });
}

export type Creator = Pick<ProfileRow, 'id' | 'handle' | 'display_name'>;

export function fetchCreator(creatorId: string): Promise<Creator | null> {
  return fromSource({
    demo: () => demoCreator(creatorId),
    live: () =>
      select<Creator | null>(db().from('profiles').select('id, handle, display_name').eq('id', creatorId).maybeSingle()),
  });
}

const parseEpisodePrice = (raw: unknown): EpisodePrice | null => {
  const parsed = EpisodePriceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

/** The server's answer for one episode: free, unlocked, or what it costs this reader. */
export function fetchEpisodePrice(episodeId: string): Promise<EpisodePrice> {
  return fromSource({
    demo: () => demoEpisodePrice(episodeId),
    live: () => rpc('get_episode_price', { p_episode: episodeId }, parseEpisodePrice),
  });
}

// ---- Follows ---------------------------------------------------------------------------------------------

export function fetchFollows(): Promise<readonly FollowRow[]> {
  return fromSource({
    demo: () => demoFollows(),
    live: () =>
      select<FollowRow[]>(
        db().from('follows').select('series_id, created_at').order('created_at', { ascending: false }).limit(MAX_FOLLOWS),
      ),
  });
}

/** The followed series, newest follow first. */
export function fetchFollowing(reader: Reader): Promise<SeriesCard[]> {
  return fromSource({
    demo: async () => orderFollowing(demoFollows(), demoCards({ limit: 100 }, reader.matureOptIn)),
    live: async () => {
      const follows = await fetchFollows();
      if (follows.length === 0) return [];
      return orderFollowing(follows, await liveCardsByIds(follows.map((f) => f.series_id)));
    },
  });
}

export function fetchIsFollowing(seriesId: string): Promise<boolean> {
  return fromSource({
    demo: () => demoIsFollowing(seriesId),
    live: async () =>
      (await select<{ series_id: string } | null>(db().from('follows').select('series_id').eq('series_id', seriesId).maybeSingle())) !== null,
  });
}

/** Follow or unfollow as the signed-in user (RLS ties both to the session; the client sends no user id). */
export function setFollowing(seriesId: string, on: boolean): Promise<void> {
  return fromSource({
    demo: () => demoSetFollow(seriesId, on),
    live: async () => {
      if (!UUID.test(seriesId)) throw new DataError(400, 'bad_request', '', null);
      if (!on) {
        await select(db().from('follows').delete().eq('series_id', seriesId));
        return;
      }
      try {
        await select(db().from('follows').insert({ series_id: seriesId }));
      } catch (err) {
        // Already following (another device got there first): that is the state we wanted.
        if (!(err instanceof DataError && err.code === '23505')) throw err;
      }
    },
  });
}

// ---- Watch history ---------------------------------------------------------------------------------------

/** What the reader watched last, newest first, each with its episode and series. */
export function fetchHistory(limit: number, reader: Reader): Promise<HistoryEntry[]> {
  return fromSource({
    demo: () => demoHistory(limit, reader.matureOptIn),
    live: async () => {
      const progress = await select<ProgressRow[]>(
        db().from('watch_progress').select(PROGRESS_COLUMNS).order('updated_at', { ascending: false }).limit(limit),
      );
      if (progress.length === 0) return [];
      const episodes = (
        await Promise.all(
          chunk(progress.map((p) => p.episode_id), IN_CHUNK).map((part) =>
            select<EpisodeBrief[]>(db().from('episodes').select(EPISODE_BRIEF_COLUMNS).in('id', part)),
          ),
        )
      ).flat();
      const series = await liveCardsByIds([...new Set(episodes.map((e) => e.series_id))]);
      return buildHistory(progress, episodes, series);
    },
  });
}

/** The reader's progress on these episodes (one series' worth), for "Continue". */
export function fetchProgressOf(episodeIds: readonly string[]): Promise<ProgressRow[]> {
  return fromSource({
    demo: () => demoProgress().filter((p) => episodeIds.includes(p.episode_id)),
    live: async () => {
      if (episodeIds.length === 0) return [];
      const pages = await Promise.all(
        chunk(episodeIds, IN_CHUNK).map((part) =>
          select<ProgressRow[]>(db().from('watch_progress').select(PROGRESS_COLUMNS).in('episode_id', part)),
        ),
      );
      return pages.flat();
    },
  });
}
