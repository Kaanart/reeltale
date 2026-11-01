// Data for the player and the unlock sheet. Every hook goes through fromSource (src/lib/data.ts): the
// real backend (Supabase RPCs and tables, the Worker's /api/playback) or the demo fixtures in ./demo.ts.
//
// Query keys: userKey(userId, 'watch', ...). The sheet's wallet lives under userKey(userId, 'wallet', 'watch')
// so the Me track's `wallet` prefix refreshes it too, without sharing a cache entry of a different shape.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EpisodePriceSchema, type EpisodePrice } from '@reeltale/shared';
import { useCallback } from 'react';

import { ApiError } from '../../core/api';
import { DEFAULT_PRICING, parsePricingConfig, type PricingConfig } from '../../core/pricing';
import { parseWallet } from '../../core/wallet';
import { api, DataError, db, fromSource, rpc, select, userKey } from '../../lib/data';
import { EPISODE_COLUMNS, SERIES_COLUMNS, type EpisodeRow, type SeriesRow } from '../../lib/types';
import { useAuth, useUserId } from '../auth';
import {
  demoEpisodePrice, demoProgressFor, demoSaveProgress, demoUnlock, demoUseFreePass, demoWalletCell, demoWatchSeries,
  DemoRpcError,
} from './demo';
import { DEMO_VIDEO } from './demoMedia';
import { playbackFreshForMs } from './logic/access';
import { progressByEpisode, type SavedProgress } from './logic/progress';
import { parseUnlockResult, type UnlockOutcome, type WalletFacts } from './logic/unlock';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isEpisodeId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export const watchKeys = {
  series: (userId: string | null, episodeId: string) => userKey(userId, 'watch', 'series', episodeId),
  price: (userId: string | null, episodeId: string) => userKey(userId, 'watch', 'price', episodeId),
  playback: (userId: string | null, episodeId: string) => userKey(userId, 'watch', 'playback', episodeId),
  progress: (userId: string | null, seriesId: string) => userKey(userId, 'watch', 'progress', seriesId),
  wallet: (userId: string | null) => userKey(userId, 'wallet', 'watch'),
  pricing: (userId: string | null) => userKey(userId, 'watch', 'pricing'),
};

// ---- The series around an episode -------------------------------------------------------------------

export interface WatchSeries {
  series: SeriesRow;
  episodes: EpisodeRow[];
}

/** Episodes the pager lists: published ones, and closed ones (still playable for those who unlocked them). */
const LISTED_STATUSES = ['published', 'closed_to_new'];

function isRowOf<T>(raw: unknown, idKey: string): raw is T {
  return !!raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>)[idKey] === 'string';
}

async function loadSeriesLive(episodeId: string): Promise<WatchSeries> {
  const episode = await select<unknown>(db().from('episodes').select(EPISODE_COLUMNS).eq('id', episodeId).maybeSingle());
  if (!isRowOf<EpisodeRow>(episode, 'id')) {
    // RLS hides a mature series (and its episodes) from someone who hasn't opted in. The price check still
    // says why, so the screen can point to Settings instead of "not found".
    const price = await rpc('get_episode_price', { p_episode: episodeId }, parseEpisodePrice).catch(() => null);
    const reason = price?.reason === 'mature_opt_in_required' ? 'mature_opt_in_required' : 'not_found';
    throw new DataError(reason === 'not_found' ? 404 : 403, reason, '', null);
  }
  const series = await select<unknown>(db().from('series').select(SERIES_COLUMNS).eq('id', episode.series_id).maybeSingle());
  if (!isRowOf<SeriesRow>(series, 'id')) throw new DataError(404, 'not_found', '', null);
  const rows = await select<unknown>(
    db().from('episodes').select(EPISODE_COLUMNS).eq('series_id', series.id).in('status', LISTED_STATUSES).order('number'),
  );
  const listed = Array.isArray(rows) ? rows.filter((r): r is EpisodeRow => isRowOf<EpisodeRow>(r, 'id')) : [];
  // The requested episode is always there, even if its status keeps it off the list (the creator's preview).
  const episodes = listed.some((e) => e.id === episode.id)
    ? listed
    : [...listed, episode].sort((a, b) => a.number - b.number);
  return { series, episodes };
}

export function useWatchSeries(episodeId: string) {
  const userId = useUserId();
  const { matureOptIn } = useAuth();
  return useQuery({
    // The mature opt-in decides whether a mature series can be seen at all, so it's part of the key.
    queryKey: [...watchKeys.series(userId, episodeId), { mature: matureOptIn }],
    enabled: !!userId && isEpisodeId(episodeId),
    queryFn: () => fromSource<WatchSeries>({
      demo: () => {
        const found = demoWatchSeries(episodeId);
        if (!found) throw new DemoRpcError('not_found');
        // Like RLS on public.series.
        if (found.series.maturity === 'mature' && !matureOptIn) throw new DemoRpcError('mature_opt_in_required');
        return found;
      },
      live: () => loadSeriesLive(episodeId),
    }),
  });
}

// ---- Price and access ---------------------------------------------------------------------------------

function parseEpisodePrice(raw: unknown): EpisodePrice | null {
  const r = EpisodePriceSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** public.get_episode_price: what the user may do with this episode, and what it costs them. */
export function useEpisodePrice(episodeId: string, enabled: boolean) {
  const userId = useUserId();
  const { matureOptIn } = useAuth();
  return useQuery({
    // The mature opt-in changes the answer, so it's part of the key.
    queryKey: [...watchKeys.price(userId, episodeId), { mature: matureOptIn }],
    enabled: enabled && !!userId,
    queryFn: () => fromSource({
      demo: () => demoEpisodePrice(episodeId, { matureOptIn }),
      live: () => rpc('get_episode_price', { p_episode: episodeId }, parseEpisodePrice),
    }),
  });
}

// ---- Playback --------------------------------------------------------------------------------------------

export type PlaybackSource =
  | { kind: 'stream'; uri: string; expiresAt: number }
  | { kind: 'demo'; asset: number };

/**
 * The signed HLS URL for one episode. `allowed` must come from the price check (logic/access.ts
 * mayRequestPlayback): a locked episode never asks. The URL is reused until shortly before it expires.
 */
export function usePlayback(episodeId: string, allowed: boolean) {
  const userId = useUserId();
  return useQuery<PlaybackSource>({
    queryKey: watchKeys.playback(userId, episodeId),
    enabled: allowed && !!userId,
    staleTime: (query) => {
      const data = query.state.data;
      return data?.kind === 'stream' ? playbackFreshForMs(data.expiresAt, Date.now()) : Infinity;
    },
    // A stale URL must not be shown to a new player when the screen comes back.
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => {
      if (!allowed) return Promise.reject(new ApiError(402, 'locked'));
      return fromSource<PlaybackSource>({
        demo: () => ({ kind: 'demo', asset: DEMO_VIDEO }),
        live: async () => {
          const r = await api.getPlayback(episodeId, { signal });
          return { kind: 'stream', uri: r.hls, expiresAt: r.expires_at };
        },
      });
    },
  });
}

// ---- Watch progress -----------------------------------------------------------------------------------

/** watch_progress rows for a series' episodes (owner-only by RLS). */
export function useSeriesProgress(seriesId: string, episodeIds: readonly string[]) {
  const userId = useUserId();
  return useQuery({
    queryKey: watchKeys.progress(userId, seriesId),
    enabled: !!userId && episodeIds.length > 0,
    // Read once when the player opens; saves update the cache directly.
    staleTime: Infinity,
    queryFn: () => fromSource<Map<string, SavedProgress>>({
      demo: () => demoProgressFor(episodeIds),
      live: async () => progressByEpisode(await select<unknown>(
        db().from('watch_progress').select('episode_id, position_s, completed').in('episode_id', [...episodeIds]),
      )),
    }),
  });
}

/**
 * Write one row of watch_progress. Not supabase-js upsert(): PostgREST's merge-duplicates updates every
 * column it was sent, episode_id included, and `authenticated` may only update position_s and completed
 * (the upsert fails with permission denied). So: update the owner's row; insert if there was none; on a
 * race with another insert (23505), update again. RLS keeps both to the user's own row.
 */
async function saveProgressLive(episodeId: string, progress: SavedProgress): Promise<void> {
  // A row that is completed stays completed: only send `completed` when it's true.
  const changes = progress.completed ? { position_s: progress.position_s, completed: true } : { position_s: progress.position_s };
  const update = async () => {
    const rows = await select<unknown>(db().from('watch_progress').update(changes).eq('episode_id', episodeId).select('episode_id'));
    return Array.isArray(rows) && rows.length > 0;
  };
  if (await update()) return;
  try {
    await select(db().from('watch_progress').insert({ episode_id: episodeId, ...progress }));
  } catch (err) {
    if (err instanceof DataError && err.code === '23505') {
      await update();
      return;
    }
    throw err;
  }
}

/** Returns save(episodeId, seriesId, progress). Best effort: callers ignore failures (the next save retries). */
export function useSaveProgress() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useCallback(async (episodeId: string, seriesId: string, progress: SavedProgress) => {
    if (!userId) return;
    await fromSource({
      demo: () => demoSaveProgress(episodeId, progress),
      live: () => saveProgressLive(episodeId, progress),
    });
    queryClient.setQueryData<Map<string, SavedProgress>>(watchKeys.progress(userId, seriesId), (prev) => {
      const next = new Map(prev ?? []);
      const completed = progress.completed || (prev?.get(episodeId)?.completed ?? false);
      next.set(episodeId, { position_s: progress.position_s, completed });
      return next;
    });
  }, [userId, queryClient]);
}

// ---- Wallet and pricing for the sheet -------------------------------------------------------------------

export function useUnlockWallet(enabled: boolean) {
  const userId = useUserId();
  return useQuery({
    queryKey: watchKeys.wallet(userId),
    enabled: enabled && !!userId,
    queryFn: () => fromSource<WalletFacts>({
      demo: () => {
        const w = demoWalletCell.get();
        return { balance: w.balance, refundDebt: w.refund_debt, freePassesLeft: w.free_passes_left };
      },
      live: async () => {
        const w = await rpc('get_my_wallet', undefined, parseWallet);
        return { balance: w.balance, refundDebt: w.refund_debt, freePassesLeft: w.free_passes_left };
      },
    }),
  });
}

/** pricing_config, for the "with VIP" teaser only (the real price always comes from get_episode_price). */
export function usePricingConfig(enabled: boolean) {
  const userId = useUserId();
  return useQuery({
    queryKey: watchKeys.pricing(userId),
    enabled: enabled && !!userId,
    staleTime: 60 * 60_000,
    queryFn: () => fromSource<PricingConfig>({
      demo: () => DEFAULT_PRICING,
      live: async () => parsePricingConfig(await select<unknown>(db().from('pricing_config').select('key, value'))),
    }),
  });
}

// ---- Unlocking -------------------------------------------------------------------------------------------

/** After an unlock (or a failed one): the price, the wallet, and the catalog's lock badges are out of date. */
function useAfterUnlock() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useCallback((episodeId: string) => {
    void queryClient.invalidateQueries({ queryKey: watchKeys.price(userId, episodeId) });
    void queryClient.invalidateQueries({ queryKey: userKey(userId, 'wallet') });
    // The catalog's contract (features/catalog/hooks.ts): its prices live under 'catalog', 'price'.
    void queryClient.invalidateQueries({ queryKey: userKey(userId, 'catalog', 'price') });
  }, [userId, queryClient]);
}

/**
 * Called when the player closes: the catalog's "continue watching" and progress marks are out of date. Once
 * on leaving rather than on every save, so the screens underneath don't refetch every few seconds.
 */
export function useRefreshCatalogProgress() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: userKey(userId, 'catalog', 'progress') });
    void queryClient.invalidateQueries({ queryKey: userKey(userId, 'catalog', 'history') });
  }, [userId, queryClient]);
}

function parseOutcome(raw: unknown): UnlockOutcome | null {
  return parseUnlockResult(raw);
}

/** public.unlock_episode(p_episode, p_expected_price): the price the sheet showed, or price_changed. */
export function useUnlockEpisode() {
  const { matureOptIn } = useAuth();
  const after = useAfterUnlock();
  return useMutation({
    mutationFn: (input: { episodeId: string; expectedPrice: number }) => fromSource<UnlockOutcome>({
      demo: () => demoUnlock(input.episodeId, input.expectedPrice, { matureOptIn }),
      live: () => rpc('unlock_episode', { p_episode: input.episodeId, p_expected_price: input.expectedPrice }, parseOutcome),
    }),
    onSettled: (_data, _err, input) => after(input.episodeId),
  });
}

/** public.use_free_pass(p_episode). */
export function useFreePass() {
  const { matureOptIn } = useAuth();
  const after = useAfterUnlock();
  return useMutation({
    mutationFn: (input: { episodeId: string }) => fromSource<UnlockOutcome>({
      demo: () => demoUseFreePass(input.episodeId, { matureOptIn }),
      live: () => rpc('use_free_pass', { p_episode: input.episodeId }, parseOutcome),
    }),
    onSettled: (_data, _err, input) => after(input.episodeId),
  });
}
