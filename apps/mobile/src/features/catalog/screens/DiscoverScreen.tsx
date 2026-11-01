import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Sheet, Skeleton, TagChip, Text } from '../../../components/ui';
import type { SeriesFormat } from '../../../lib/types';
import { colors, fonts, space } from '../../../theme/tokens';
import { DecorativeIcon } from '../components/DecorativeIcon';
import { SearchField } from '../components/SearchField';
import { SeriesTile, tileHeight } from '../components/SeriesTile';
import { EmptyState, ErrorState } from '../components/States';
import { useDebounced, useDiscoverResults, useTags } from '../hooks';
import {
  browsableTags, gridCardWidth, gridColumns, isRanking, RANKINGS, searchTerm, tagLabel, type Ranking, type SeriesCard,
} from '../logic';
import { routes } from '../routes';

const GUTTER = space.lg;
const GAP = space.md;
const MAX_WIDTH = 1100;
const SEARCH_DELAY_MS = 350;
const FORMATS: readonly SeriesFormat[] = ['live_action', 'stop_motion', 'ai_generated'];

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function DiscoverScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ ranking?: string; tag?: string; n?: string }>();
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(windowWidth, MAX_WIDTH);
  const columns = gridColumns(width);
  const tileWidth = gridCardWidth(width, columns, GUTTER, GAP);

  const [text, setText] = useState('');
  const [ranking, setRanking] = useState<Ranking>('trending');
  const [formats, setFormats] = useState<SeriesFormat[]>([]);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Arriving from a "See all" on Home: start on that ranking or tag, with no leftover search narrowing it.
  const rankingParam = one(params.ranking);
  const tagParam = one(params.tag);
  const requestId = one(params.n);
  useEffect(() => {
    if (requestId === undefined) return;
    setRanking(isRanking(rankingParam) ? rankingParam : 'trending');
    const id = Number(tagParam);
    setTagIds(Number.isInteger(id) && id > 0 ? [id] : []);
    setFormats([]);
    setText('');
  }, [rankingParam, tagParam, requestId]);

  const term = searchTerm(useDebounced(text, SEARCH_DELAY_MS));
  const query = useMemo(
    () => ({ ranking, formats, tagIds, search: term ?? undefined }),
    [ranking, formats, tagIds, term],
  );
  const tags = useTags();
  const results = useDiscoverResults(query);
  const items = useMemo(() => results.data?.pages.flat() ?? [], [results.data]);

  const browsable = useMemo(() => browsableTags(tags.data ?? []), [tags.data]);
  const tagById = useMemo(() => new Map((tags.data ?? []).map((tag) => [tag.id, tag])), [tags.data]);
  const activeCount = formats.length + tagIds.length;
  const clearFilters = useCallback(() => {
    setFormats([]);
    setTagIds([]);
  }, []);

  const openSeries = useCallback((s: SeriesCard) => router.push(routes.series(s.slug)), [router]);
  const loadMore = useCallback(() => {
    if (results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
  }, [results]);

  const formatLabel = (f: SeriesFormat) => t(`common:format.${f}`);
  const tagName = (id: number) => {
    const tag = tagById.get(id);
    return tag ? tagLabel(tag, i18n.language) : null;
  };

  const emptyState = results.isPending ? (
    <GridSkeleton columns={columns} tileWidth={tileWidth} loading={t('common:state.loading')} />
  ) : results.isError ? (
    <ErrorState error={results.error} onRetry={() => void results.refetch()} />
  ) : term ? (
    <EmptyState title={t('home:discover.noResults', { query: term })} body={t('home:discover.noResultsHint')} />
  ) : (
    <EmptyState
      title={t('home:home.empty')}
      actionLabel={activeCount > 0 ? t('home:discover.filters.clear') : undefined}
      onAction={activeCount > 0 ? clearFilters : undefined}
    />
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
      <View style={styles.page}>
        <View style={styles.top}>
          <View style={styles.titleRow}>
            <Text variant="title" accessibilityRole="header" style={styles.title}>
              {t('home:discover.title')}
            </Text>
            <Pressable
              onPress={() => setFiltersOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={
                activeCount > 0
                  ? t('home:discover.filters.titleWithCount', { active: activeCount })
                  : t('home:discover.filters.title')
              }
              style={styles.filterButton}
            >
              <DecorativeIcon name="options-outline" size={20} />
              <Text variant="bodySmall" style={styles.filterLabel}>
                {activeCount > 0
                  ? t('home:discover.filters.titleWithCount', { active: activeCount })
                  : t('home:discover.filters.title')}
              </Text>
            </Pressable>
          </View>
          <SearchField value={text} onChangeText={setText} placeholder={t('home:discover.searchPlaceholder')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {RANKINGS.map((r) => (
              <TagChip
                key={r}
                label={t(`home:discover.rankings.${r}`)}
                selected={ranking === r}
                onPress={() => setRanking(r)}
              />
            ))}
          </ScrollView>
          {activeCount > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {formats.map((f) => (
                <TagChip key={f} label={formatLabel(f)} selected onPress={() => setFormats((l) => toggle(l, f))} />
              ))}
              {tagIds.map((id) => {
                const name = tagName(id);
                return name ? <TagChip key={id} label={name} selected onPress={() => setTagIds((l) => toggle(l, id))} /> : null;
              })}
              <Pressable onPress={clearFilters} accessibilityRole="button" style={styles.clear}>
                <Text variant="bodySmall" style={styles.clearLabel}>
                  {t('home:discover.filters.clear')}
                </Text>
              </Pressable>
            </ScrollView>
          ) : null}
        </View>

        <FlashList
          key={columns}
          data={items}
          numColumns={columns}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <SeriesTile series={item} width={tileWidth} onPress={openSeries} />
            </View>
          )}
          ListEmptyComponent={emptyState}
          ListFooterComponent={results.isFetchingNextPage ? <ActivityIndicator style={styles.footer} color={colors.inkMuted} /> : null}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          contentContainerStyle={{ paddingHorizontal: GUTTER - GAP / 2, paddingTop: space.md, paddingBottom: space.xxl }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />
      </View>

      <Sheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title={t('home:discover.filters.title')}>
        <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
          <FilterGroup title={t('home:discover.filters.format')}>
            {FORMATS.map((f) => (
              <TagChip key={f} label={formatLabel(f)} selected={formats.includes(f)} onPress={() => setFormats((l) => toggle(l, f))} />
            ))}
          </FilterGroup>
          {browsable.genre.length > 0 ? (
            <FilterGroup title={t('home:discover.filters.genre')}>
              {browsable.genre.map((tag) => (
                <TagChip
                  key={tag.id}
                  label={tagLabel(tag, i18n.language)}
                  selected={tagIds.includes(tag.id)}
                  onPress={() => setTagIds((l) => toggle(l, tag.id))}
                />
              ))}
            </FilterGroup>
          ) : null}
          {browsable.trope.length > 0 ? (
            <FilterGroup title={t('home:discover.filters.trope')}>
              {browsable.trope.map((tag) => (
                <TagChip
                  key={tag.id}
                  label={tagLabel(tag, i18n.language)}
                  selected={tagIds.includes(tag.id)}
                  onPress={() => setTagIds((l) => toggle(l, tag.id))}
                />
              ))}
            </FilterGroup>
          ) : null}
        </ScrollView>
        <View style={styles.sheetActions}>
          {activeCount > 0 ? <Button label={t('home:discover.filters.clear')} variant="secondary" onPress={clearFilters} /> : null}
          <Button label={t('common:actions.done')} onPress={() => setFiltersOpen(false)} />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text variant="subheading" accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.wrap}>{children}</View>
    </View>
  );
}

function GridSkeleton({ columns, tileWidth, loading }: { columns: number; tileWidth: number; loading: string }) {
  return (
    <View style={styles.skeletonGrid} accessible accessibilityLabel={loading} aria-busy>
      {Array.from({ length: columns * 2 }, (_, i) => (
        <Skeleton key={i} width={tileWidth} height={tileHeight(tileWidth)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  page: { flex: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  top: { gap: space.md, paddingHorizontal: GUTTER, paddingTop: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1 },
  filterButton: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 44, paddingHorizontal: space.sm },
  filterLabel: { fontFamily: fonts.sansMedium },
  chips: { gap: space.sm, alignItems: 'center', paddingVertical: space.sm },
  clear: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm },
  clearLabel: { fontFamily: fonts.sansMedium, textDecorationLine: 'underline' },
  cell: { alignItems: 'center', paddingBottom: space.lg },
  footer: { paddingVertical: space.lg },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingHorizontal: GAP / 2 },
  sheetScroll: { maxHeight: 420 },
  sheetContent: { gap: space.lg, paddingBottom: space.lg },
  group: { gap: space.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.md, paddingTop: space.sm },
});
