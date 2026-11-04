import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { focusRing, PageContainer, TwoColumn, useInteraction, useLayout } from '../../../components/layout';
import { AIBadge, Button, Skeleton, TagChip, Text } from '../../../components/ui';
import type { SeriesRow } from '../../../lib/types';
import { colors, fonts, layout, radius, space } from '../../../theme/tokens';
import { headingLevel } from '../components/a11y';
import { Cover, COVER_RATIO } from '../components/Cover';
import { DecorativeIcon } from '../components/DecorativeIcon';
import { EpisodeRow } from '../components/EpisodeRow';
import { MaturityMarker } from '../components/MaturityMarker';
import { DiscoverLink } from '../components/SeeAllLink';
import { EmptyState, ErrorState } from '../components/States';
import { useSeriesText } from '../components/useSeriesText';
import { canStickSide, EPISODE_BATCH, hiddenEpisodeCount, nextEpisodeCount, seriesSideWidth } from '../layout';
import { isAiSeries, isFreeAiSeries, tagLabel } from '../logic';
import { useGoBack, useSeriesPage, type SeriesPage } from './seriesPage';

// The series page on wider windows (the website on a laptop). Wide: the cover, title, Play / Continue,
// Follow and Report in a panel on the left that stays in view while the page scrolls (when it fits), and the
// summary, tags and episodes in the main column. The panel (and its cover) narrows a little in a shorter
// window, so Play stays on screen (seriesSideWidth). Medium (a tablet-sized window): the same, stacked, with the
// cover beside the title. Phones and the apps keep SeriesScreen's own layout.

const MEDIUM_COVER_WIDTH = 200;
const ICON = 18;
const SYNOPSIS_MAX_WIDTH = 680;

export function SeriesWide({ series }: { series: SeriesRow }) {
  const { t } = useTranslation();
  const { isWide, height } = useLayout();
  const page = useSeriesPage(series);
  const sideWidth = seriesSideWidth(height);

  const [viewportHeight, setViewportHeight] = useState(0);
  const [sideHeight, setSideHeight] = useState(0);
  const onViewport = useCallback((e: LayoutChangeEvent) => setViewportHeight(e.nativeEvent.layout.height), []);
  const onSide = useCallback((e: LayoutChangeEvent) => setSideHeight(e.nativeEvent.layout.height), []);

  return (
    <PageContainer scrollViewProps={{ onLayout: onViewport }}>
      <BackLink />
      <TwoColumn
        from="wide"
        sidePosition="start"
        sideFirst
        sideWidth={sideWidth}
        stickySide={isWide && canStickSide(sideHeight, viewportHeight)}
        gap={space.xxl}
        sideLabel={t('series:aboutA11y')}
        side={
          <View onLayout={onSide}>
            <SidePanel series={series} page={page} stacked={!isWide} coverWidth={sideWidth} />
          </View>
        }
        main={<MainPanel series={series} page={page} />}
      />
    </PageContainer>
  );
}

/** The page around a series that hasn't loaded (a skeleton) or can't be shown (children say why). */
export function SeriesWideFrame({ state, children }: { state: 'loading' | 'error'; children?: ReactNode }) {
  const { t } = useTranslation();
  const { isWide, height } = useLayout();
  const cover = isWide ? seriesSideWidth(height) : MEDIUM_COVER_WIDTH;
  return (
    <PageContainer>
      <BackLink />
      {state === 'loading' ? (
        <View style={[styles.skeleton, isWide && styles.skeletonWide]} accessible accessibilityLabel={t('common:state.loading')} aria-busy>
          <Skeleton width={cover} height={Math.ceil(cover / COVER_RATIO)} />
          <View style={styles.skeletonText}>
            <Skeleton width="60%" height={space.xxl} />
            <Skeleton width="40%" />
            <Skeleton height={space.xxxl} />
            <Skeleton height={space.xxxl} />
          </View>
        </View>
      ) : (
        children
      )}
    </PageContainer>
  );
}

function BackLink() {
  const { t } = useTranslation();
  const goBack = useGoBack();
  const { hovered, focusVisible, handlers } = useInteraction();
  return (
    <Pressable
      {...handlers}
      onPress={goBack}
      accessibilityRole="button"
      accessibilityLabel={t('common:actions.back')}
      style={({ pressed }) => [styles.back, (hovered || pressed) && styles.backHover, focusVisible && focusRing]}
    >
      <DecorativeIcon name="chevron-back" size={ICON} />
      <Text variant="bodySmall" style={styles.backLabel}>
        {t('common:actions.back')}
      </Text>
    </Pressable>
  );
}

function SidePanel({
  series, page, stacked, coverWidth,
}: { series: SeriesRow; page: SeriesPage; stacked: boolean; coverWidth: number }) {
  const { t } = useTranslation();
  const describe = useSeriesText();
  const { resume, following, toggleFollow, isFollowing, onFollow, creatorName, episodeList } = page;
  const ai = isAiSeries(series);

  const meta = episodeList.length > 0
    ? t('series:metaLine', { meta: describe(series).meta, episodes: t('common:episode.count', { count: episodeList.length }) })
    : describe(series).meta;

  const details = (
    <View style={styles.details}>
      <Text variant="title" accessibilityRole="header" {...headingLevel(1)}>
        {series.title}
      </Text>
      {creatorName ? (
        <Text variant="bodySmall" color="inkMuted">
          {t('series:byCreator', { name: creatorName })}
        </Text>
      ) : null}
      <Text variant="bodySmall" color="inkMuted">
        {meta}
      </Text>
      {ai || series.maturity === 'mature' || series.editors_pick || isFreeAiSeries(series) ? (
        <View style={styles.labels}>
          {ai ? <AIBadge size="md" /> : null}
          {series.maturity === 'mature' ? <MaturityMarker /> : null}
          {series.editors_pick ? <TagChip label={t('series:editorsPick')} /> : null}
          {isFreeAiSeries(series) ? <TagChip label={t('series:freeToWatch')} /> : null}
        </View>
      ) : null}
    </View>
  );

  const actions = (
    <View style={styles.actions}>
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
        loading={page.episodes.isPending}
        onPress={page.play}
        icon={resume ? <DecorativeIcon name="play" size={ICON} color="onAccent" /> : undefined}
        fullWidth
      />
      <View style={styles.actionRow}>
        <View style={styles.flex}>
          <Button
            label={isFollowing ? t('series:following') : t('series:follow')}
            variant="secondary"
            disabled={following.isPending}
            onPress={onFollow}
            icon={<DecorativeIcon name={isFollowing ? 'bookmark' : 'bookmark-outline'} size={ICON} />}
            fullWidth
          />
        </View>
        <Button
          label={t('series:report')}
          accessibilityLabel={t('series:reportA11y', { title: series.title })}
          variant="secondary"
          onPress={page.report}
          icon={<DecorativeIcon name="flag-outline" size={ICON} />}
        />
      </View>
      {toggleFollow.isError ? (
        // Ink, not `danger`: danger on the page background is 4.2:1, under AA for text this small.
        <Text variant="bodySmall" color="ink" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {t('series:followFailed')}
        </Text>
      ) : null}
    </View>
  );

  if (stacked) {
    return (
      <View style={styles.sideRow}>
        <Cover series={series} width={MEDIUM_COVER_WIDTH} />
        <View style={styles.sideRowText}>
          {details}
          {actions}
        </View>
      </View>
    );
  }
  return (
    <View style={styles.side}>
      <Cover series={series} width={coverWidth} />
      {details}
      {actions}
    </View>
  );
}

function MainPanel({ series, page }: { series: SeriesRow; page: SeriesPage }) {
  const { t, i18n } = useTranslation();
  const { episodes, episodeList, openEpisode, seriesTags } = page;
  const ai = isAiSeries(series);
  const [shown, setShown] = useState(EPISODE_BATCH);
  const hidden = hiddenEpisodeCount(shown, episodeList.length);
  const synopsis = series.synopsis.trim();
  // After Show more, the keyboard focus moves to the first episode it added (the button goes away after the
  // last batch, which would drop the focus to the top of the page).
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const firstNewRef = useRef<View>(null);
  useEffect(() => {
    if (focusIndex === null) return;
    firstNewRef.current?.focus();
    setFocusIndex(null);
  }, [focusIndex]);
  const showMore = () => {
    setFocusIndex(Math.min(shown, episodeList.length));
    setShown((n) => nextEpisodeCount(n, episodeList.length));
  };

  return (
    <View style={styles.main}>
      {ai ? (
        <View style={styles.aiNotice}>
          <AIBadge size="sm" />
          <Text variant="bodySmall" style={styles.flex}>
            {t('series:aiNotice')}
          </Text>
        </View>
      ) : null}

      {synopsis ? (
        <View style={styles.block}>
          <Text variant="subheading" accessibilityRole="header" {...headingLevel(2)}>
            {t('series:synopsis')}
          </Text>
          <Text style={styles.synopsis}>{synopsis}</Text>
        </View>
      ) : null}

      {seriesTags.length > 0 ? (
        <View style={styles.block}>
          <Text variant="subheading" accessibilityRole="header" {...headingLevel(2)}>
            {t('series:tags')}
          </Text>
          <View style={styles.tags}>
            {seriesTags.map((tag) => {
              const name = tagLabel(tag, i18n.language);
              // Genres and tropes open Discover on that tag; content warnings aren't filters.
              return tag.kind === 'warning' ? (
                <TagChip key={tag.id} label={name} />
              ) : (
                <DiscoverLink
                  key={tag.id}
                  options={{ tagId: tag.id }}
                  label={name}
                  accessibilityLabel={t('series:tagLinkA11y', { tag: name })}
                  variant="tag"
                />
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.block}>
        <View style={styles.episodesHeader}>
          <Text variant="heading" accessibilityRole="header" {...headingLevel(2)} style={styles.flex}>
            {t('series:episodes')}
          </Text>
          {episodeList.length > 0 ? (
            <Text variant="bodySmall" color="inkMuted">
              {t('common:episode.count', { count: episodeList.length })}
            </Text>
          ) : null}
        </View>
        {episodes.isPending ? (
          <View style={styles.episodeSkeleton} accessible accessibilityLabel={t('common:state.loading')} aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={space.xxxl} />
            ))}
          </View>
        ) : episodes.isError ? (
          <ErrorState error={episodes.error} onRetry={() => void episodes.refetch()} />
        ) : episodeList.length === 0 ? (
          <EmptyState title={t('series:noEpisodes')} />
        ) : (
          <View>
            {episodeList.slice(0, shown).map((episode, i) => (
              <EpisodeRow
                key={episode.id}
                ref={i === focusIndex ? firstNewRef : undefined}
                series={series}
                episode={episode}
                onPress={openEpisode}
              />
            ))}
          </View>
        )}
        {hidden > 0 ? (
          <View style={styles.moreEpisodes}>
            <Button
              label={t('series:showMoreEpisodes', { count: Math.min(EPISODE_BATCH, hidden) })}
              variant="secondary"
              onPress={showMore}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    minHeight: layout.minTarget,
    paddingHorizontal: space.sm,
    marginLeft: -space.sm,
    marginBottom: space.md,
    borderRadius: radius.chip,
  },
  backHover: { backgroundColor: colors.surfaceAlt },
  backLabel: { fontFamily: fonts.sansMedium },
  side: { gap: space.lg },
  sideRow: { flexDirection: 'row', gap: space.xl, alignItems: 'flex-start' },
  sideRowText: { flex: 1, minWidth: 0, gap: space.lg },
  details: { gap: space.xs },
  labels: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  actions: { gap: space.md },
  actionRow: { flexDirection: 'row', gap: space.md },
  main: { gap: space.xl },
  aiNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceAlt,
  },
  block: { gap: space.sm },
  synopsis: { maxWidth: SYNOPSIS_MAX_WIDTH },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  episodesHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: space.xs },
  episodeSkeleton: { gap: space.md },
  moreEpisodes: { alignItems: 'center', paddingTop: space.lg },
  skeleton: { gap: space.xl },
  skeletonWide: { flexDirection: 'row' },
  skeletonText: { flex: 1, gap: space.md },
});
