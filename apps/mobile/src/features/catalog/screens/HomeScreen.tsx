import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { columnWidth, PageContainer, useLayout } from '../../../components/layout';
import { Skeleton, Text } from '../../../components/ui';
import { space } from '../../../theme/tokens';
import { CONTINUE_CARD_WIDTH, ContinueCard } from '../components/ContinueCard';
import { DemoStoryCard } from '../components/DemoStoryCard';
import { FeaturedHero } from '../components/FeaturedHero';
import { IconButton } from '../components/IconButton';
import { Shelf, SHELF_CARD_WIDTH } from '../components/Shelf';
import { SeriesTile, tileHeight } from '../components/SeriesTile';
import { EmptyState, ErrorState } from '../components/States';
import { useHistory, useRefreshOnFocus, useSeriesCards, useTags } from '../hooks';
import {
  CONTINUE_MAX_CARDS, CONTINUE_MIN_CARD_WIDTH, featuredSeries, HERO_SIDE_WIDTH, heroCoverWidth, pairShelves, SHELF_GAP,
  shelfLayout,
} from '../layout';
import {
  buildHomeShelves, continueWatching, SHELF_SIZE, tagLabel, type HistoryEntry, type Ranking, type SeriesCard,
} from '../logic';
import { routes } from '../routes';

/** How many recent series Home cuts Trending, New and the genre shelves from. */
const POOL_SIZE = 60;
const CONTINUE_LIMIT = 10;
const HEADER_HEIGHT = 56;
const SKELETON_TITLE_WIDTH = 160;

interface HomeRow {
  key: string;
  title: string;
  items: readonly SeriesCard[];
  ranking?: Ranking;
  tagId?: number;
}

const seriesKey = (s: SeriesCard) => s.id;
const rowCount = (row: HomeRow) => row.items.length;
const entryKey = (e: HistoryEntry) => e.episode.id;
const renderTile = (s: SeriesCard, width: number) => <SeriesTile series={s} width={width} />;
const renderContinue = (e: HistoryEntry, width: number) => <ContinueCard entry={e} width={width} />;

// Home. Phones and the apps: the wordmark and search, the demo story, then rows of covers that scroll
// sideways. The website on a laptop (the top bar carries the wordmark and search): the featured Editor's Pick
// beside the demo story, then the same rows with as many covers as fit and Previous / Next buttons; short
// rows share a line, two side by side (pairShelves), with their covers on the same grid as the full rows.

export function HomeScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { hasTopNav, isWide, width: windowWidth } = useLayout();

  // Trending, New and the genre shelves are cut from one list; the other three rows are their own filters.
  const pool = useSeriesCards({ ranking: 'trending', limit: POOL_SIZE });
  const completed = useSeriesCards({ ranking: 'completed', limit: SHELF_SIZE });
  const picks = useSeriesCards({ ranking: 'editorsPicks', limit: SHELF_SIZE });
  const ai = useSeriesCards({ ranking: 'aiStories', limit: SHELF_SIZE });
  const tags = useTags();
  const history = useHistory();

  const shelves = useMemo(() => buildHomeShelves(pool.data ?? [], tags.data ?? [], new Date()), [pool.data, tags.data]);
  const resume = useMemo(() => continueWatching(history.data ?? [], CONTINUE_LIMIT), [history.data]);
  const featured = useMemo(() => featuredSeries(picks.data ?? []), [picks.data]);

  const [refreshing, setRefreshing] = useState(false);
  const refetchAll = useCallback(
    () => Promise.all([pool.refetch(), completed.refetch(), picks.refetch(), ai.refetch(), tags.refetch(), history.refetch()]),
    [pool, completed, picks, ai, tags, history],
  );
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetchAll();
    } finally {
      setRefreshing(false);
    }
  }, [refetchAll]);
  // Coming back from watching: the "Continue watching" row has moved.
  useRefreshOnFocus(history.refetch);

  const startDemo = useCallback(() => router.push(routes.storyNew), [router]);

  const rows: HomeRow[] = [
    { key: 'trending', title: t('home:home.trending'), items: shelves.trending, ranking: 'trending' },
    { key: 'new', title: t('home:home.new'), items: shelves.fresh, ranking: 'new' },
    { key: 'completed', title: t('home:home.completed'), items: completed.data ?? [], ranking: 'completed' },
    { key: 'picks', title: t('home:home.editorsPicks'), items: picks.data ?? [], ranking: 'editorsPicks' },
    { key: 'ai', title: t('home:home.aiStories'), items: ai.data ?? [], ranking: 'aiStories' },
    ...shelves.genres.map((g) => ({
      key: `genre-${g.tag.id}`, title: tagLabel(g.tag, i18n.language), items: g.items, tagId: g.tag.id,
    })),
  ];
  const visibleRows = rows.filter((row) => row.items.length > 0);
  // Phones and the apps: one shelf per row. Wider: how many covers a full row shows decides what can pair. The
  // rows measure themselves, as each shelf does: a scroll bar that takes up room (Windows, or a Mac set to
  // always show them) makes the column narrower than the window says, and the halves would then hold fewer.
  const [rowsWidth, setRowsWidth] = useState(0);
  const onRowsLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    setRowsWidth((prev) => (prev === w ? prev : w));
  }, []);
  const perView = hasTopNav ? shelfLayout(rowsWidth > 0 ? rowsWidth : columnWidth(windowWidth)).perView : 0;
  const groups = pairShelves(visibleRows, rowCount, perView);

  const loading = pool.isPending;
  const failed = pool.isError && !pool.data;

  return (
    <PageContainer
      padTop={hasTopNav}
      scrollViewProps={{
        refreshControl: <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />,
        showsVerticalScrollIndicator: hasTopNav,
      }}
    >
      {hasTopNav ? null : (
        <View style={styles.header}>
          <Text variant="title" accessibilityRole="header" style={styles.wordmark}>
            {t('common:appName')}
          </Text>
          <IconButton icon="search" label={t('home:home.searchA11y')} onPress={() => router.navigate(routes.discover())} />
        </View>
      )}

      {!hasTopNav ? (
        <DemoStoryCard onStart={startDemo} />
      ) : isWide ? (
        <View style={styles.heroRow}>
          <View style={styles.heroMain}>
            {featured ? <FeaturedHero series={featured} /> : picks.isPending ? <HeroSkeleton /> : <DemoStoryCard onStart={startDemo} />}
          </View>
          {featured || picks.isPending ? (
            <View style={styles.heroSide}>
              <DemoStoryCard onStart={startDemo} variant="hero" />
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.heroStack}>
          {featured ? <FeaturedHero series={featured} /> : picks.isPending ? <HeroSkeleton /> : null}
          <DemoStoryCard onStart={startDemo} />
        </View>
      )}

      {resume.length > 0 ? (
        <Shelf
          title={t('home:home.continueWatching')}
          items={resume}
          keyExtractor={entryKey}
          renderItem={renderContinue}
          compactCardWidth={CONTINUE_CARD_WIDTH}
          minCardWidth={CONTINUE_MIN_CARD_WIDTH}
          maxCards={CONTINUE_MAX_CARDS}
        />
      ) : null}

      <View onLayout={onRowsLayout}>
      {loading ? (
        <View accessible accessibilityLabel={t('common:state.loading')} aria-busy>
          <ShelfSkeleton />
          <ShelfSkeleton />
        </View>
      ) : failed ? (
        <ErrorState error={pool.error} onRetry={() => void refetchAll()} />
      ) : visibleRows.length === 0 ? (
        <EmptyState title={t('home:home.empty')} />
      ) : (
        groups.map(([first, second]) =>
          second ? (
            <View key={`${first.key}+${second.key}`} style={styles.pair}>
              <View style={styles.half}>
                <SeriesShelf row={first} />
              </View>
              <View style={styles.half}>
                <SeriesShelf row={second} />
              </View>
            </View>
          ) : (
            <SeriesShelf key={first.key} row={first} />
          ),
        )
      )}
      </View>
    </PageContainer>
  );
}

function SeriesShelf({ row }: { row: HomeRow }) {
  return (
    <Shelf
      title={row.title}
      items={row.items}
      keyExtractor={seriesKey}
      renderItem={renderTile}
      seeAll={{ ranking: row.ranking, tagId: row.tagId }}
    />
  );
}

function HeroSkeleton() {
  const { size } = useLayout();
  const cover = heroCoverWidth(size);
  return (
    <View style={styles.heroSkeleton}>
      <Skeleton width={cover} height={Math.ceil((cover * 4) / 3)} />
      <View style={styles.heroSkeletonText}>
        <Skeleton width="30%" />
        <Skeleton width="70%" height={space.xxl} />
        <Skeleton width="50%" />
        <Skeleton width="90%" />
      </View>
    </View>
  );
}

function ShelfSkeleton() {
  const { hasTopNav, width } = useLayout();
  // Wide: as many covers as the real shelf will show; phones: three of the fixed width (the row runs off screen).
  const shelf = hasTopNav ? shelfLayout(columnWidth(width)) : null;
  const count = shelf ? shelf.perView : 3;
  const cardWidth = shelf ? shelf.cardWidth : SHELF_CARD_WIDTH;
  return (
    <View style={styles.skeleton}>
      <Skeleton width={SKELETON_TITLE_WIDTH} height={space.xl} />
      <View style={[styles.skeletonRow, shelf ? { gap: shelf.gap } : null]}>
        {Array.from({ length: count }, (_, i) => (
          <Skeleton key={i} width={cardWidth} height={tileHeight(cardWidth)} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The search button's hit area reaches into the gutter, so the icon sits where it always did.
  header: { flexDirection: 'row', alignItems: 'center', minHeight: HEADER_HEIGHT, marginRight: -space.sm },
  wordmark: { flex: 1 },
  heroRow: { flexDirection: 'row', alignItems: 'stretch', gap: space.lg },
  heroMain: { flex: 1, minWidth: 0 },
  heroSide: { width: HERO_SIDE_WIDTH },
  heroStack: { gap: space.lg },
  // Two short shelves side by side: the shelf gap between them keeps their covers on the full rows' grid.
  pair: { flexDirection: 'row', gap: SHELF_GAP },
  half: { flex: 1, minWidth: 0 },
  heroSkeleton: { flexDirection: 'row', gap: space.xl, alignItems: 'center' },
  heroSkeletonText: { flex: 1, gap: space.md },
  skeleton: { marginTop: space.xl, gap: space.md },
  skeletonRow: { flexDirection: 'row', gap: space.md, overflow: 'hidden' },
});
