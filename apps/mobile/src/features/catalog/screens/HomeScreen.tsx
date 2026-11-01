import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Skeleton, Text } from '../../../components/ui';
import { colors, space } from '../../../theme/tokens';
import { ContinueCard } from '../components/ContinueCard';
import { DecorativeIcon } from '../components/DecorativeIcon';
import { DemoStoryCard } from '../components/DemoStoryCard';
import { SCREEN_GUTTER, Shelf, SHELF_CARD_WIDTH } from '../components/Shelf';
import { tileHeight } from '../components/SeriesTile';
import { EmptyState, ErrorState } from '../components/States';
import { useHistory, useRefreshOnFocus, useSeriesCards, useTags } from '../hooks';
import {
  buildHomeShelves, continueWatching, SHELF_SIZE, tagLabel, type HistoryEntry, type Ranking, type SeriesCard,
} from '../logic';
import { routes } from '../routes';

/** How many recent series Home cuts Trending, New and the genre shelves from. */
const POOL_SIZE = 60;
const CONTINUE_LIMIT = 10;
const CONTENT_MAX_WIDTH = 960;

export function HomeScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();

  // Trending, New and the genre shelves are cut from one list; the other three rows are their own filters.
  const pool = useSeriesCards({ ranking: 'trending', limit: POOL_SIZE });
  const completed = useSeriesCards({ ranking: 'completed', limit: SHELF_SIZE });
  const picks = useSeriesCards({ ranking: 'editorsPicks', limit: SHELF_SIZE });
  const ai = useSeriesCards({ ranking: 'aiStories', limit: SHELF_SIZE });
  const tags = useTags();
  const history = useHistory();

  const shelves = useMemo(() => buildHomeShelves(pool.data ?? [], tags.data ?? [], new Date()), [pool.data, tags.data]);
  const resume = useMemo(() => continueWatching(history.data ?? [], CONTINUE_LIMIT), [history.data]);

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

  const openSeries = useCallback((s: SeriesCard) => router.push(routes.series(s.slug)), [router]);
  const openEpisode = useCallback((e: HistoryEntry) => router.push(routes.watch(e.episode.id)), [router]);

  const rows: { key: string; title: string; items: readonly SeriesCard[]; ranking?: Ranking; tagId?: number }[] = [
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

  const loading = pool.isPending;
  const failed = pool.isError && !pool.data;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text variant="title" accessibilityRole="header" style={styles.wordmark}>
            {t('common:appName')}
          </Text>
          <Pressable
            onPress={() => router.navigate(routes.discover())}
            accessibilityRole="button"
            accessibilityLabel={t('home:home.searchA11y')}
            style={styles.searchButton}
          >
            <DecorativeIcon name="search" size={24} />
          </Pressable>
        </View>

        <View style={styles.gutter}>
          <DemoStoryCard onStart={() => router.push(routes.storyNew)} />
        </View>

        {resume.length > 0 ? (
          <View style={styles.section}>
            <Text variant="heading" accessibilityRole="header" style={[styles.gutter, styles.sectionTitle]}>
              {t('home:home.continueWatching')}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
              accessibilityLabel={t('home:home.continueWatching')}
            >
              {resume.map((entry) => (
                <ContinueCard key={entry.episode.id} entry={entry} onPress={openEpisode} />
              ))}
            </ScrollView>
          </View>
        ) : null}

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
          visibleRows.map((row) => (
            <Shelf
              key={row.key}
              title={row.title}
              items={row.items}
              onOpen={openSeries}
              onSeeAll={() => router.navigate(routes.discover({ ranking: row.ranking, tagId: row.tagId }))}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ShelfSkeleton() {
  return (
    <View style={styles.skeleton}>
      <View style={styles.gutter}>
        <Skeleton width={160} height={24} />
      </View>
      <View style={styles.skeletonRow}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} width={SHELF_CARD_WIDTH} height={tileHeight(SHELF_CARD_WIDTH)} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', paddingBottom: space.xxl },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: SCREEN_GUTTER, paddingRight: space.sm, minHeight: 56 },
  wordmark: { flex: 1 },
  searchButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  gutter: { paddingHorizontal: SCREEN_GUTTER },
  section: { marginTop: space.xl },
  sectionTitle: { marginBottom: space.md },
  row: { paddingHorizontal: SCREEN_GUTTER, gap: space.md },
  skeleton: { marginTop: space.xl, gap: space.md },
  skeletonRow: { flexDirection: 'row', paddingHorizontal: SCREEN_GUTTER, gap: space.md, overflow: 'hidden' },
});
