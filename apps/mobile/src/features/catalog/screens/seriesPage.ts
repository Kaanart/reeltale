import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';

import { userKey } from '../../../lib/keys';
import type { SeriesRow } from '../../../lib/types';
import { useUserId } from '../../auth';
import {
  useCreator, useEpisodes, useIsFollowing, useRefreshOnFocus, useSeriesProgress, useTags, useToggleFollow,
} from '../hooks';
import { pickResume, tagsOfSeries, type EpisodeItem } from '../logic';
import { routes } from '../routes';

// What the series page shows, whichever layout draws it (phones: SeriesScreen; wider windows: SeriesWide).

export function useGoBack() {
  const router = useRouter();
  // A link opened straight into this page has nothing to go back to: Home is the way out.
  return useCallback(() => (router.canGoBack() ? router.back() : router.replace(routes.home)), [router]);
}

export function useSeriesPage(series: SeriesRow) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = useUserId();

  const episodes = useEpisodes(series.id);
  const creator = useCreator(series.creator_id);
  const tags = useTags();
  const following = useIsFollowing(series.id);
  const toggleFollow = useToggleFollow(series.id);

  const episodeList = useMemo<EpisodeItem[]>(() => episodes.data ?? [], [episodes.data]);
  const episodeIds = useMemo(() => episodeList.map((e) => e.id), [episodeList]);
  const progress = useSeriesProgress(series.id, episodeIds);
  const resume = useMemo(() => pickResume(episodeList, progress.data ?? []), [episodeList, progress.data]);

  // Back from watching: prices (a new unlock) and "Continue" have changed.
  useRefreshOnFocus(() =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: userKey(userId, 'catalog', 'price') }),
      queryClient.invalidateQueries({ queryKey: userKey(userId, 'catalog', 'progress', series.id) }),
    ]),
  );

  const openEpisode = useCallback((episode: EpisodeItem) => router.push(routes.watch(episode.id)), [router]);
  const play = useCallback(() => {
    if (resume) router.push(routes.watch(resume.episodeId));
  }, [router, resume]);
  const report = useCallback(
    () => router.push(routes.reportSeries(series.id, series.creator_id)),
    [router, series.id, series.creator_id],
  );

  const isFollowing = following.data === true;
  const onFollow = () => {
    toggleFollow.reset();
    toggleFollow.mutate(!isFollowing);
  };

  const creatorName = creator.data?.display_name || (creator.data?.handle ? `@${creator.data.handle}` : null);
  const seriesTags = tagsOfSeries(series.tag_ids, tags.data ?? []);

  return {
    episodes, episodeList, resume, following, toggleFollow, isFollowing, onFollow, openEpisode, play, report,
    creatorName, seriesTags,
  };
}

export type SeriesPage = ReturnType<typeof useSeriesPage>;
