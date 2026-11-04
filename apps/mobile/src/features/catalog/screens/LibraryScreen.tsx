import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { columnWidth, PageContainer, ResponsiveGrid, useLayout } from '../../../components/layout';
import { Skeleton, Text } from '../../../components/ui';
import { colors, space } from '../../../theme/tokens';
import { Segmented } from '../components/Segmented';
import { SeriesRow } from '../components/SeriesRow';
import { SeriesTile, tileHeight } from '../components/SeriesTile';
import { EmptyState, ErrorState } from '../components/States';
import { useSeriesText } from '../components/useSeriesText';
import { useFollowing, useHistory, useRefreshOnFocus } from '../hooks';
import { SHELF_GAP, SHELF_MAX_CARDS, SHELF_MIN_CARD_WIDTH, shelfLayout } from '../layout';
import type { HistoryEntry, SeriesCard } from '../logic';
import { routes } from '../routes';

type Tab = 'following' | 'history';

const GUTTER = space.lg;
const MAX_WIDTH = 760;
const ROW_SKELETON_HEIGHT = 96;
const TABS_WIDTH = 320;
/** History cards on wider screens: two columns on a tablet, three on a laptop. */
const HISTORY_COLUMNS = { compact: 1, medium: 2, wide: 3 } as const;

// Library. Phones and the apps: Following and History as lists. The website on a laptop: Following is a
// shelf of covers in as many columns as fit, History a grid of cards with how far each episode got.

export function LibraryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { hasTopNav } = useLayout();
  const [tab, setTab] = useState<Tab>('following');
  const following = useFollowing();
  const history = useHistory();
  const active = tab === 'following' ? following : history;

  // The lists change while the reader is away (a follow, an episode watched).
  useRefreshOnFocus(() => Promise.all([following.refetch(), history.refetch()]));

  const openSeries = useCallback((s: SeriesCard) => router.push(routes.series(s.slug)), [router]);
  const openEpisode = useCallback((e: HistoryEntry) => router.push(routes.watch(e.episode.id)), [router]);

  const failed = active.isError ? active.error : null;
  const status = active.isPending ? (
    <LoadingState tab={tab} wide={hasTopNav} />
  ) : failed ? (
    <ErrorState error={failed} onRetry={() => void active.refetch()} />
  ) : (
    <EmptyState title={t(`home:library.empty.${tab}`)} />
  );

  const tabs = (
    <Segmented<Tab>
      options={[
        { value: 'following', label: t('home:library.tabs.following') },
        { value: 'history', label: t('home:library.tabs.history') },
      ]}
      value={tab}
      onChange={setTab}
    />
  );

  if (hasTopNav) {
    const followed = following.data ?? [];
    const watched = history.data ?? [];
    return (
      <PageContainer>
        <View style={styles.wideTop}>
          <Text variant="title" accessibilityRole="header" style={styles.flex}>
            {t('home:library.title')}
          </Text>
          <View style={styles.wideTabs}>{tabs}</View>
        </View>
        {tab === 'following' ? (
          followed.length > 0 ? (
            <ResponsiveGrid
              items={followed}
              keyExtractor={(s) => s.id}
              minItemWidth={SHELF_MIN_CARD_WIDTH}
              maxColumns={SHELF_MAX_CARDS}
              gap={SHELF_GAP}
              accessibilityLabel={t('home:library.tabs.following')}
              renderItem={(s, { width }) => <SeriesTile series={s} width={width} />}
            />
          ) : status
        ) : watched.length > 0 ? (
          <ResponsiveGrid
            items={watched}
            keyExtractor={(e) => e.episode.id}
            columns={HISTORY_COLUMNS}
            gap={SHELF_GAP}
            accessibilityLabel={t('home:library.tabs.history')}
            renderItem={(e) => <HistoryRow entry={e} onPress={openEpisode} variant="card" />}
          />
        ) : status}
      </PageContainer>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
      <View style={styles.page}>
        <View style={styles.top}>
          <Text variant="title" accessibilityRole="header">
            {t('home:library.title')}
          </Text>
          {tabs}
        </View>

        {tab === 'following' ? (
          <FlashList
            key="following"
            data={following.data ?? []}
            keyExtractor={(s) => s.id}
            renderItem={({ item }) => <SeriesRow series={item} onPress={() => openSeries(item)} />}
            ListEmptyComponent={status}
            refreshing={following.isRefetching && !following.isPending}
            onRefresh={() => void following.refetch()}
            contentContainerStyle={styles.list}
          />
        ) : (
          <FlashList
            key="history"
            data={history.data ?? []}
            keyExtractor={(e) => e.episode.id}
            renderItem={({ item }) => <HistoryRow entry={item} onPress={openEpisode} />}
            ListEmptyComponent={status}
            refreshing={history.isRefetching && !history.isPending}
            onRefresh={() => void history.refetch()}
            contentContainerStyle={styles.list}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function LoadingState({ tab, wide }: { tab: Tab; wide: boolean }) {
  const { t } = useTranslation();
  const { width } = useLayout();
  let blocks: ReactNode;
  if (wide && tab === 'following') {
    const shelf = shelfLayout(columnWidth(width));
    blocks = (
      <View style={[styles.skeletonRow, { gap: shelf.gap }]}>
        {Array.from({ length: shelf.perView }, (_, i) => (
          <Skeleton key={i} width={shelf.cardWidth} height={tileHeight(shelf.cardWidth)} />
        ))}
      </View>
    );
  } else {
    blocks = [0, 1, 2, 3].map((i) => <Skeleton key={i} height={ROW_SKELETON_HEIGHT} />);
  }
  return (
    <View style={styles.skeletons} accessible accessibilityLabel={t('common:state.loading')} aria-busy>
      {blocks}
    </View>
  );
}

function HistoryRow({
  entry, onPress, variant,
}: { entry: HistoryEntry; onPress: (entry: HistoryEntry) => void; variant?: 'plain' | 'card' }) {
  const { t } = useTranslation();
  // The custom label hides the AI and Mature badges of the row, so it names them itself.
  const { labels } = useSeriesText()(entry.series);
  const episode = t('common:episode.number', { number: entry.episode.number });
  const title = entry.episode.title.trim();
  const progress = entry.completed ? t('home:library.watched') : t('home:home.progress', { percent: entry.percent });
  return (
    <SeriesRow
      series={entry.series}
      detail={title ? t('home:library.episodeLine', { episode, title }) : episode}
      percent={entry.percent}
      progressLabel={progress}
      accessibilityLabel={[entry.series.title, episode, title, progress, ...labels].filter(Boolean).join(', ')}
      variant={variant}
      onPress={() => onPress(entry)}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  page: { flex: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  flex: { flex: 1 },
  top: { gap: space.md, paddingHorizontal: GUTTER, paddingTop: space.sm, paddingBottom: space.sm },
  list: { paddingHorizontal: GUTTER, paddingBottom: space.xxl },
  skeletons: { gap: space.md, paddingTop: space.md },
  skeletonRow: { flexDirection: 'row', overflow: 'hidden' },
  wideTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.lg, marginBottom: space.xl },
  wideTabs: { width: TABS_WIDTH, maxWidth: '100%' },
});
