// React Query hooks of the catalog. Every key starts with the user (lib/keys.ts) and, where RLS depends on it, the
// mature opt-in, so turning mature content on or off in Settings loads a fresh list. Other features that change
// what these show (an unlock, new watch progress) invalidate `userKey(userId, 'catalog', 'price')`,
// `…'progress'` or `…'history'`, or all of `userKey(userId, 'catalog')`.

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { userKey } from '../../lib/keys';
import { useAuth } from '../auth';
import {
  fetchCards, fetchCreator, fetchEpisodePrice, fetchEpisodes, fetchFollowing, fetchHistory, fetchIsFollowing,
  fetchProgressOf, fetchSeries, fetchTags, setFollowing,
} from './sources';
import { cardKey, PAGE_SIZE, type CardQuery } from './logic';
import { episodeSummary } from './storefront';

/** Rows of watch history the app loads at once (Home's "Continue watching" and the Library share them). */
export const HISTORY_LIMIT = 50;
const TAGS_STALE_MS = 60 * 60_000;

function useScope() {
  const { userId, matureOptIn } = useAuth();
  return { userId, matureOptIn, reader: { matureOptIn } };
}

export function useTags() {
  const { userId } = useScope();
  return useQuery({
    queryKey: userKey(userId, 'catalog', 'tags'),
    enabled: !!userId,
    staleTime: TAGS_STALE_MS,
    queryFn: fetchTags,
  });
}

/** One shelf or one page of series. */
export function useSeriesCards(q: CardQuery) {
  const { userId, matureOptIn, reader } = useScope();
  return useQuery({
    queryKey: userKey(userId, 'catalog', 'cards', cardKey(q), matureOptIn),
    enabled: !!userId,
    queryFn: () => fetchCards(q, reader),
  });
}

/** Discover: pages of 20 that load as the list scrolls. */
export function useDiscoverResults(q: Omit<CardQuery, 'limit' | 'offset'>) {
  const { userId, matureOptIn, reader } = useScope();
  return useInfiniteQuery({
    queryKey: userKey(userId, 'catalog', 'discover', cardKey(q), matureOptIn),
    enabled: !!userId,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchCards({ ...q, limit: PAGE_SIZE, offset: pageParam }, reader),
    getNextPageParam: (last, all) => (last.length < PAGE_SIZE ? undefined : all.length * PAGE_SIZE),
  });
}

export function useHistory() {
  const { userId, matureOptIn, reader } = useScope();
  return useQuery({
    queryKey: userKey(userId, 'catalog', 'history', matureOptIn),
    enabled: !!userId,
    queryFn: () => fetchHistory(HISTORY_LIMIT, reader),
  });
}

export function useFollowing() {
  const { userId, matureOptIn, reader } = useScope();
  return useQuery({
    queryKey: userKey(userId, 'catalog', 'follows', 'list', matureOptIn),
    enabled: !!userId,
    queryFn: () => fetchFollowing(reader),
  });
}

// ---- One series ------------------------------------------------------------------------------------------

export function useSeries(slug: string) {
  const { userId, matureOptIn, reader } = useScope();
  return useQuery({
    queryKey: userKey(userId, 'catalog', 'series', slug, matureOptIn),
    enabled: !!userId,
    queryFn: () => fetchSeries(slug, reader),
  });
}

export function useCreator(creatorId: string | null | undefined) {
  const { userId } = useScope();
  return useQuery({
    queryKey: userKey(userId, 'catalog', 'creator', creatorId ?? ''),
    enabled: !!userId && !!creatorId,
    staleTime: TAGS_STALE_MS,
    queryFn: () => fetchCreator(creatorId ?? ''),
  });
}

export function useEpisodes(seriesId: string | undefined) {
  const { userId } = useScope();
  return useQuery({
    queryKey: userKey(userId, 'catalog', 'episodes', seriesId ?? ''),
    enabled: !!userId && !!seriesId,
    queryFn: () => fetchEpisodes(seriesId ?? ''),
  });
}

/**
 * How many episodes a series has and which one comes first ("Watch now"), from the same query as the series
 * page, so opening the series afterwards needs no new request.
 */
export function useEpisodeSummary(seriesId: string | undefined) {
  const episodes = useEpisodes(seriesId);
  const summary = useMemo(() => episodeSummary(episodes.data), [episodes.data]);
  return { ...summary, loaded: episodes.isSuccess, isPending: episodes.isPending };
}

/** The server's price for one episode. Rows already known to be free pass `enabled: false` and cost no request. */
export function useEpisodePrice(episodeId: string, enabled: boolean) {
  const { userId } = useScope();
  return useQuery({
    queryKey: userKey(userId, 'catalog', 'price', episodeId),
    enabled: !!userId && enabled,
    queryFn: () => fetchEpisodePrice(episodeId),
  });
}

export function useSeriesProgress(seriesId: string | undefined, episodeIds: readonly string[]) {
  const { userId } = useScope();
  return useQuery({
    queryKey: userKey(userId, 'catalog', 'progress', seriesId ?? ''),
    enabled: !!userId && !!seriesId && episodeIds.length > 0,
    queryFn: () => fetchProgressOf(episodeIds),
  });
}

// ---- Follow ----------------------------------------------------------------------------------------------

export function useIsFollowing(seriesId: string | undefined) {
  const { userId } = useScope();
  return useQuery({
    queryKey: userKey(userId, 'catalog', 'follows', 'one', seriesId ?? ''),
    enabled: !!userId && !!seriesId,
    queryFn: () => fetchIsFollowing(seriesId ?? ''),
  });
}

/** Follow or unfollow. The button flips at once; a failure puts it back (and the screen says so). */
export function useToggleFollow(seriesId: string) {
  const queryClient = useQueryClient();
  const { userId } = useScope();
  const oneKey = userKey(userId, 'catalog', 'follows', 'one', seriesId);
  return useMutation({
    mutationFn: (on: boolean) => setFollowing(seriesId, on),
    onMutate: async (on) => {
      await queryClient.cancelQueries({ queryKey: oneKey });
      const previous = queryClient.getQueryData<boolean>(oneKey);
      queryClient.setQueryData(oneKey, on);
      return { previous };
    },
    onError: (_error, _on, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(oneKey, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: userKey(userId, 'catalog', 'follows') });
    },
  });
}

// ---- Small helpers ---------------------------------------------------------------------------------------

/** Run `refresh` each time the screen comes back into focus (not on the first focus: the queries load then). */
export function useRefreshOnFocus(refresh: () => unknown) {
  const latest = useRef(refresh);
  latest.current = refresh;
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void latest.current();
    }, []),
  );
}

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
