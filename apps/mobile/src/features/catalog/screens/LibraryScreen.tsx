import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Skeleton, Text } from '../../../components/ui';
import { colors, space } from '../../../theme/tokens';
import { Segmented } from '../components/Segmented';
import { SeriesRow } from '../components/SeriesRow';
import { EmptyState, ErrorState } from '../components/States';
import { useSeriesText } from '../components/useSeriesText';
import { useFollowing, useHistory, useRefreshOnFocus } from '../hooks';
import type { HistoryEntry, SeriesCard } from '../logic';
import { routes } from '../routes';

type Tab = 'following' | 'history';

const GUTTER = space.lg;
const MAX_WIDTH = 760;

export function LibraryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('following');
  const following = useFollowing();
  const history = useHistory();
  const active = tab === 'following' ? following : history;

  // The lists change while the reader is away (a follow, an episode watched).
  useRefreshOnFocus(() => Promise.all([following.refetch(), history.refetch()]));

  const openSeries = useCallback((s: SeriesCard) => router.push(routes.series(s.slug)), [router]);
  const openEpisode = useCallback((e: HistoryEntry) => router.push(routes.watch(e.episode.id)), [router]);

  const loading = active.isPending;
  const failed = active.isError ? active.error : null;

  const status = loading ? (
    <View style={styles.skeletons} accessible accessibilityLabel={t('common:state.loading')} aria-busy>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} height={96} />
      ))}
    </View>
  ) : failed ? (
    <ErrorState error={failed} onRetry={() => void active.refetch()} />
  ) : (
    <EmptyState title={t(`home:library.empty.${tab}`)} />
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
      <View style={styles.page}>
        <View style={styles.top}>
          <Text variant="title" accessibilityRole="header">
            {t('home:library.title')}
          </Text>
          <Segmented<Tab>
            options={[
              { value: 'following', label: t('home:library.tabs.following') },
              { value: 'history', label: t('home:library.tabs.history') },
            ]}
            value={tab}
            onChange={setTab}
          />
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

function HistoryRow({ entry, onPress }: { entry: HistoryEntry; onPress: (entry: HistoryEntry) => void }) {
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
      onPress={() => onPress(entry)}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  page: { flex: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  top: { gap: space.md, paddingHorizontal: GUTTER, paddingTop: space.sm, paddingBottom: space.sm },
  list: { paddingHorizontal: GUTTER, paddingBottom: space.xxl },
  skeletons: { gap: space.md, paddingTop: space.md },
});
