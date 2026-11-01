import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AIBadge, Button, Sheet, Skeleton, TagChip, Text } from '../../../components/ui';
import { userKey } from '../../../lib/keys';
import type { SeriesRow } from '../../../lib/types';
import { colors, fonts, space } from '../../../theme/tokens';
import { useAuth, useUserId } from '../../auth';
import { Cover } from '../components/Cover';
import { DecorativeIcon } from '../components/DecorativeIcon';
import { EpisodeRow } from '../components/EpisodeRow';
import { MaturityMarker } from '../components/MaturityMarker';
import { EmptyState, ErrorState } from '../components/States';
import { useSeriesText } from '../components/useSeriesText';
import {
  useCreator, useEpisodes, useIsFollowing, useRefreshOnFocus, useSeries, useSeriesProgress, useTags, useToggleFollow,
} from '../hooks';
import { isAiSeries, isFreeAiSeries, pickResume, SYNOPSIS_FOLD_LENGTH, tagLabel, tagsOfSeries, type EpisodeItem } from '../logic';
import { routes } from '../routes';

const GUTTER = space.lg;
const MAX_WIDTH = 760;
const HERO_COVER_WIDTH = 128;
const SYNOPSIS_LINES = 4;

export function SeriesScreen() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = (Array.isArray(params.slug) ? params.slug[0] : params.slug) ?? '';
  const series = useSeries(slug);

  if (series.isPending) {
    return (
      <Frame>
        <SeriesSkeleton />
      </Frame>
    );
  }
  if (series.isError) {
    return (
      <Frame>
        <ErrorState error={series.error} onRetry={() => void series.refetch()} />
      </Frame>
    );
  }
  if (!series.data) {
    return (
      <Frame>
        <Unavailable />
      </Frame>
    );
  }
  return <SeriesLoaded series={series.data} />;
}

// ---- Frame and the states without a series ------------------------------------------------------------------

function useGoBack() {
  const router = useRouter();
  // A link opened straight into this page has nothing to go back to: Home is the way out.
  return useCallback(() => (router.canGoBack() ? router.back() : router.replace(routes.home)), [router]);
}

function TopBar({ onMore }: { onMore?: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const goBack = useGoBack();
  return (
    <View style={[styles.topBar, { paddingTop: insets.top }]}>
      <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel={t('common:actions.back')} style={styles.iconButton}>
        <DecorativeIcon name="chevron-back" size={26} />
      </Pressable>
      <View style={styles.flex} />
      {onMore ? (
        <Pressable onPress={onMore} accessibilityRole="button" accessibilityLabel={t('series:more')} style={styles.iconButton}>
          <DecorativeIcon name="ellipsis-horizontal" size={24} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Frame({ children, onMore }: { children: ReactNode; onMore?: () => void }) {
  return (
    <View style={styles.root}>
      <View style={styles.page}>
        <TopBar onMore={onMore} />
        {children}
      </View>
    </View>
  );
}

function SeriesSkeleton() {
  const { t } = useTranslation();
  return (
    <View style={styles.skeleton} accessible accessibilityLabel={t('common:state.loading')} aria-busy>
      <View style={styles.hero}>
        <Skeleton width={HERO_COVER_WIDTH} height={(HERO_COVER_WIDTH * 4) / 3} />
        <View style={styles.heroText}>
          <Skeleton width="80%" height={28} />
          <Skeleton width="50%" height={16} />
        </View>
      </View>
      <Skeleton height={48} />
      <Skeleton height={64} />
    </View>
  );
}

/** No such series for this reader: gone, hidden, or (RLS can't tell us which) mature while the opt-in is off. */
function Unavailable() {
  const { t } = useTranslation();
  const router = useRouter();
  const { matureOptIn } = useAuth();
  const goBack = useGoBack();
  return (
    <View style={styles.unavailable}>
      <EmptyState title={t('series:unavailable.title')} body={t('series:unavailable.body')} />
      <View style={styles.unavailableActions}>
        {!matureOptIn ? (
          <>
            <Text variant="bodySmall" color="inkMuted" align="center">
              {t('series:unavailable.matureHint')}
            </Text>
            <Button label={t('series:unavailable.openSettings')} variant="secondary" onPress={() => router.push(routes.settings)} />
          </>
        ) : null}
        <Button label={t('series:mature.goBack')} onPress={goBack} />
      </View>
    </View>
  );
}

// ---- The series ---------------------------------------------------------------------------------------------

function SeriesLoaded({ series }: { series: SeriesRow }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = useUserId();
  const describe = useSeriesText();

  const episodes = useEpisodes(series.id);
  const creator = useCreator(series.creator_id);
  const tags = useTags();
  const following = useIsFollowing(series.id);
  const toggleFollow = useToggleFollow(series.id);
  const [moreOpen, setMoreOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

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

  const isFollowing = following.data === true;
  const onFollow = () => {
    toggleFollow.reset();
    toggleFollow.mutate(!isFollowing);
  };

  const ai = isAiSeries(series);
  const creatorName = creator.data?.display_name || (creator.data?.handle ? `@${creator.data.handle}` : null);
  const seriesTags = tagsOfSeries(series.tag_ids, tags.data ?? []);
  const foldable = series.synopsis.length > SYNOPSIS_FOLD_LENGTH;

  const header = (
    <View>
      <View style={styles.hero}>
        <Cover series={series} width={HERO_COVER_WIDTH} />
        <View style={styles.heroText}>
          <Text variant="heading" accessibilityRole="header">
            {series.title}
          </Text>
          {creatorName ? (
            <Text variant="bodySmall" color="inkMuted">
              {t('series:byCreator', { name: creatorName })}
            </Text>
          ) : null}
          <Text variant="bodySmall" color="inkMuted">
            {describe(series).meta}
          </Text>
          <View style={styles.labels}>
            {ai ? <AIBadge size="md" /> : null}
            {series.maturity === 'mature' ? <MaturityMarker /> : null}
            {series.editors_pick ? <TagChip label={t('series:editorsPick')} /> : null}
            {isFreeAiSeries(series) ? <TagChip label={t('series:freeToWatch')} /> : null}
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <View style={styles.flex}>
          <Button
            label={resume?.resumed ? t('series:continue') : t('series:play')}
            accessibilityLabel={
              resume
                ? resume.resumed
                  ? t('series:continueFrom', { number: resume.number })
                  : t('series:playFrom', { number: resume.number })
                : undefined
            }
            disabled={!resume}
            onPress={() => resume && router.push(routes.watch(resume.episodeId))}
            fullWidth
          />
        </View>
        <Button
          label={isFollowing ? t('series:following') : t('series:follow')}
          variant="secondary"
          disabled={following.isPending}
          onPress={onFollow}
          icon={<DecorativeIcon name={isFollowing ? 'bookmark' : 'bookmark-outline'} size={18} />}
        />
      </View>
      {toggleFollow.isError ? (
        // Ink, not `danger`: danger on the page background is 4.2:1, under AA for text this small.
        <Text variant="bodySmall" color="ink" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.followError}>
          {t('series:followFailed')}
        </Text>
      ) : null}

      {ai ? (
        <Text variant="bodySmall" color="inkMuted" style={styles.block}>
          {t('series:aiNotice')}
        </Text>
      ) : null}

      {series.synopsis ? (
        <View style={styles.block}>
          <Text variant="subheading" accessibilityRole="header">
            {t('series:synopsis')}
          </Text>
          <Text numberOfLines={expanded || !foldable ? undefined : SYNOPSIS_LINES} style={styles.synopsis}>
            {series.synopsis}
          </Text>
          {foldable ? (
            <Pressable
              onPress={() => setExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              style={styles.fold}
            >
              <Text variant="bodySmall" style={styles.foldLabel}>
                {expanded ? t('series:showLess') : t('series:showMore')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {seriesTags.length > 0 ? (
        <View style={styles.block}>
          <Text variant="subheading" accessibilityRole="header">
            {t('series:tags')}
          </Text>
          <View style={styles.tags}>
            {seriesTags.map((tag) => (
              <TagChip key={tag.id} label={tagLabel(tag, i18n.language)} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={[styles.block, styles.episodesHeader]}>
        <Text variant="heading" accessibilityRole="header" style={styles.flex}>
          {t('series:episodes')}
        </Text>
        {episodeList.length > 0 ? (
          <Text variant="bodySmall" color="inkMuted">
            {t('common:episode.count', { count: episodeList.length })}
          </Text>
        ) : null}
      </View>
    </View>
  );

  const episodesStatus = episodes.isPending ? (
    <View style={styles.skeleton} accessible accessibilityLabel={t('common:state.loading')} aria-busy>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={56} />
      ))}
    </View>
  ) : episodes.isError ? (
    <ErrorState error={episodes.error} onRetry={() => void episodes.refetch()} />
  ) : (
    <EmptyState title={t('series:noEpisodes')} />
  );

  return (
    <Frame onMore={() => setMoreOpen(true)}>
      <FlashList
        data={episodeList}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => <EpisodeRow series={series} episode={item} onPress={openEpisode} />}
        ListHeaderComponent={header}
        ListEmptyComponent={episodesStatus}
        contentContainerStyle={styles.list}
      />
      <Sheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={t('series:more')}>
        <Button
          label={t('series:report')}
          variant="secondary"
          onPress={() => {
            setMoreOpen(false);
            router.push(routes.reportSeries(series.id, series.creator_id));
          }}
        />
      </Sheet>
    </Frame>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  page: { flex: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: GUTTER, paddingBottom: space.xxl },
  hero: { flexDirection: 'row', gap: space.lg, paddingTop: space.sm },
  heroText: { flex: 1, gap: space.xs },
  labels: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg },
  followError: { marginTop: space.sm },
  block: { marginTop: space.xl, gap: space.sm },
  synopsis: { marginTop: space.xs },
  fold: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  foldLabel: { fontFamily: fonts.sansMedium, textDecorationLine: 'underline' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  episodesHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm },
  skeleton: { gap: space.md, paddingHorizontal: GUTTER, paddingTop: space.md },
  unavailable: { flex: 1, justifyContent: 'center' },
  unavailableActions: { alignItems: 'center', gap: space.md, paddingHorizontal: GUTTER },
});
