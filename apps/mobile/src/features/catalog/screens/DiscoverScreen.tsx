import { FlashList } from '@shopify/flash-list';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent,
  type NativeScrollEvent, type NativeSyntheticEvent, type TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { columnWidth, focusRing, PageContainer, ResponsiveGrid, TwoColumn, useInteraction, useLayout } from '../../../components/layout';
import { Button, Sheet, Skeleton, TagChip, Text } from '../../../components/ui';
import type { SeriesFormat, TagRow } from '../../../lib/types';
import { colors, fonts, layout, radius, space } from '../../../theme/tokens';
import { focusNth, focusWasLost, headingLevel } from '../components/a11y';
import { DecorativeIcon } from '../components/DecorativeIcon';
import { FilterChip } from '../components/FilterChip';
import { SearchField } from '../components/SearchField';
import { SeriesTile, tileHeight } from '../components/SeriesTile';
import { EmptyState, ErrorState } from '../components/States';
import { useDebounced, useDiscoverResults, useTags } from '../hooks';
import { canStickSide, filterPanelWidth, nearEnd, SHELF_MAX_CARDS, SHELF_MIN_CARD_WIDTH, shelfLayout } from '../layout';
import {
  browsableTags, gridCardWidth, gridColumns, isRanking, RANKINGS, searchTerm, tagLabel, type Ranking, type SeriesCard,
} from '../logic';

const GUTTER = space.lg;
const GAP = space.md;
const MAX_WIDTH = 1100;
const SEARCH_DELAY_MS = 350;
const FORMATS: readonly SeriesFormat[] = ['live_action', 'stop_motion', 'ai_generated'];
/** The results beside the filter panel: covers at least this wide. */
const WIDE_MIN_TILE = SHELF_MIN_CARD_WIDTH;
const WIDE_GAP = space.lg;
const SCROLL_THROTTLE_MS = 100;
const SEARCH_MAX_WIDTH = 560;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

// Discover. Phones and the apps: search, rankings in a row, filters in a sheet, and a grid that loads as it
// scrolls. The website on a laptop: the filters stay in a panel beside the results, the rankings sit above
// them, and the grid uses as many columns as fit (more load as the page nears its end, or with Show more).
// Both read the same state, so resizing the window keeps what was picked.

export function DiscoverScreen() {
  const discover = useDiscover();
  const { hasTopNav } = useLayout();
  return hasTopNav ? <DiscoverWide {...discover} /> : <DiscoverCompact {...discover} />;
}

type Discover = ReturnType<typeof useDiscover>;

function useDiscover() {
  const { t, i18n } = useTranslation();
  const params = useLocalSearchParams<{ ranking?: string; tag?: string; n?: string; focus?: string }>();

  const [text, setText] = useState('');
  const [ranking, setRanking] = useState<Ranking>('trending');
  const [formats, setFormats] = useState<SeriesFormat[]>([]);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const searchRef = useRef<TextInput>(null);

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

  // Arriving from the search button in the top bar (/discover?focus=search): the cursor goes in the field.
  const focusParam = one(params.focus);
  useFocusEffect(
    useCallback(() => {
      if (focusParam !== 'search') return undefined;
      const id = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }, [focusParam]),
  );

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
  const toggleFormat = useCallback((f: SeriesFormat) => setFormats((l) => toggle(l, f)), []);
  const toggleTag = useCallback((id: number) => setTagIds((l) => toggle(l, id)), []);

  // Loads the next page as the list nears its end. After a failed page it waits for Try again instead of
  // asking again on every scroll event.
  const loadMore = useCallback(() => {
    if (results.hasNextPage && !results.isFetchingNextPage && !results.isFetchNextPageError) void results.fetchNextPage();
  }, [results]);

  const formatLabel = useCallback((f: SeriesFormat) => t(`common:format.${f}`), [t]);
  const nameOf = useCallback((tag: TagRow) => tagLabel(tag, i18n.language), [i18n.language]);
  const tagName = useCallback((id: number) => {
    const tag = tagById.get(id);
    return tag ? tagLabel(tag, i18n.language) : null;
  }, [tagById, i18n.language]);

  return {
    text, setText, ranking, setRanking, formats, tagIds, searchRef, term, results, items, browsable, activeCount,
    clearFilters, toggleFormat, toggleTag, loadMore, formatLabel, nameOf, tagName,
  };
}

// ---- Phones and the apps ---------------------------------------------------------------------------------

function DiscoverCompact(d: Discover) {
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(windowWidth, MAX_WIDTH);
  const columns = gridColumns(width);
  const tileWidth = gridCardWidth(width, columns, GUTTER, GAP);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { results, items, activeCount, term } = d;

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
      onAction={activeCount > 0 ? d.clearFilters : undefined}
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
          <SearchField value={d.text} onChangeText={d.setText} placeholder={t('home:discover.searchPlaceholder')} inputRef={d.searchRef} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {RANKINGS.map((r) => (
              <TagChip
                key={r}
                label={t(`home:discover.rankings.${r}`)}
                selected={d.ranking === r}
                onPress={() => d.setRanking(r)}
              />
            ))}
          </ScrollView>
          {activeCount > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {d.formats.map((f) => (
                <TagChip key={f} label={d.formatLabel(f)} selected onPress={() => d.toggleFormat(f)} />
              ))}
              {d.tagIds.map((id) => {
                const name = d.tagName(id);
                return name ? <TagChip key={id} label={name} selected onPress={() => d.toggleTag(id)} /> : null;
              })}
              <Pressable onPress={d.clearFilters} accessibilityRole="button" style={styles.clear}>
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
              <SeriesTile series={item} width={tileWidth} />
            </View>
          )}
          ListEmptyComponent={emptyState}
          ListFooterComponent={results.isFetchingNextPage ? <ActivityIndicator style={styles.footer} color={colors.inkMuted} /> : null}
          onEndReached={d.loadMore}
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
              <TagChip key={f} label={d.formatLabel(f)} selected={d.formats.includes(f)} onPress={() => d.toggleFormat(f)} />
            ))}
          </FilterGroup>
          {d.browsable.genre.length > 0 ? (
            <FilterGroup title={t('home:discover.filters.genre')}>
              {d.browsable.genre.map((tag) => (
                <TagChip key={tag.id} label={d.nameOf(tag)} selected={d.tagIds.includes(tag.id)} onPress={() => d.toggleTag(tag.id)} />
              ))}
            </FilterGroup>
          ) : null}
          {d.browsable.trope.length > 0 ? (
            <FilterGroup title={t('home:discover.filters.trope')}>
              {d.browsable.trope.map((tag) => (
                <TagChip key={tag.id} label={d.nameOf(tag)} selected={d.tagIds.includes(tag.id)} onPress={() => d.toggleTag(tag.id)} />
              ))}
            </FilterGroup>
          ) : null}
        </ScrollView>
        <View style={styles.sheetActions}>
          {activeCount > 0 ? <Button label={t('home:discover.filters.clear')} variant="secondary" onPress={d.clearFilters} /> : null}
          <Button label={t('common:actions.done')} onPress={() => setFiltersOpen(false)} />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text variant="subheading" accessibilityRole="header" {...headingLevel(2)}>
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

// ---- The website on a laptop -----------------------------------------------------------------------------

function DiscoverWide(d: Discover) {
  const { t } = useTranslation();
  const { size, width: windowWidth } = useLayout();
  const { results, items, activeCount, term } = d;

  // Clear filters goes away once it has cleared them, which would drop the keyboard focus to the top of the
  // page: the focus moves to the first filter instead.
  const firstFilterRef = useRef<View>(null);
  const clearing = useRef(false);
  const clearFilters = useCallback(() => {
    clearing.current = true;
    d.clearFilters();
  }, [d.clearFilters]);
  useEffect(() => {
    if (!clearing.current || activeCount > 0) return;
    clearing.current = false;
    if (focusWasLost()) firstFilterRef.current?.focus();
  }, [activeCount]);

  // More results: after Show more (or Try again) the focus moves to the first new result. A page loaded by
  // scrolling leaves the focus alone, unless it was on Show more and the button went away with the last page.
  const gridRef = useRef<View>(null);
  const focusFrom = useRef<{ index: number; always: boolean } | null>(null);
  const canLoadMore = results.hasNextPage && !results.isFetchingNextPage && !results.isFetchNextPageError;
  const requestMore = (always: boolean) => {
    if (!canLoadMore) return;
    focusFrom.current = { index: items.length, always };
    void results.fetchNextPage();
  };
  const retryMore = () => {
    focusFrom.current = { index: items.length, always: true };
    void results.fetchNextPage();
  };
  useEffect(() => {
    const pending = focusFrom.current;
    if (!pending) return;
    if (results.isPending || results.isFetchNextPageError) {
      focusFrom.current = null;
      return;
    }
    if (items.length <= pending.index) return;
    focusFrom.current = null;
    if (pending.always || focusWasLost()) focusNth(gridRef.current, 'a[href]', pending.index);
  }, [items.length, results.isPending, results.isFetchNextPageError]);

  // The filter panel stays in view while the results scroll, when all of it fits in the window.
  const [viewportHeight, setViewportHeight] = useState(0);
  const [panelHeight, setPanelHeight] = useState(0);
  const onViewport = useCallback((e: LayoutChangeEvent) => setViewportHeight(e.nativeEvent.layout.height), []);
  const onPanel = useCallback((e: LayoutChangeEvent) => setPanelHeight(e.nativeEvent.layout.height), []);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    if (nearEnd({ offset: contentOffset.y, viewport: layoutMeasurement.height, content: contentSize.height })) requestMore(false);
  };

  const panel = (
    <View onLayout={onPanel} style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text variant="subheading" accessibilityRole="header" {...headingLevel(2)} style={styles.flex}>
          {activeCount > 0
            ? t('home:discover.filters.titleWithCount', { active: activeCount })
            : t('home:discover.filters.title')}
        </Text>
        {activeCount > 0 ? <TextButton label={t('home:discover.filters.clear')} onPress={clearFilters} /> : null}
      </View>
      <PanelGroup title={t('home:discover.filters.format')}>
        {FORMATS.map((f, i) => (
          <FilterChip
            key={f}
            ref={i === 0 ? firstFilterRef : undefined}
            kind="checkbox"
            label={d.formatLabel(f)}
            selected={d.formats.includes(f)}
            onPress={() => d.toggleFormat(f)}
          />
        ))}
      </PanelGroup>
      {d.browsable.genre.length > 0 ? (
        <PanelGroup title={t('home:discover.filters.genre')}>
          {d.browsable.genre.map((tag) => (
            <FilterChip key={tag.id} kind="checkbox" label={d.nameOf(tag)} selected={d.tagIds.includes(tag.id)} onPress={() => d.toggleTag(tag.id)} />
          ))}
        </PanelGroup>
      ) : null}
      {d.browsable.trope.length > 0 ? (
        <PanelGroup title={t('home:discover.filters.trope')}>
          {d.browsable.trope.map((tag) => (
            <FilterChip key={tag.id} kind="checkbox" label={d.nameOf(tag)} selected={d.tagIds.includes(tag.id)} onPress={() => d.toggleTag(tag.id)} />
          ))}
        </PanelGroup>
      ) : null}
    </View>
  );

  // Skeleton tiles as wide as the real ones will be (the results column beside the panel).
  const estimate = shelfLayout(Math.max(0, columnWidth(windowWidth) - filterPanelWidth(size) - space.xl), {
    minCardWidth: WIDE_MIN_TILE, maxCards: SHELF_MAX_CARDS, gap: WIDE_GAP,
  });

  const main = (
    <View style={styles.results}>
      <View role="radiogroup" aria-label={t('home:discover.rankingsA11y')} style={styles.rankings}>
        {RANKINGS.map((r) => (
          <FilterChip key={r} kind="radio" label={t(`home:discover.rankings.${r}`)} selected={d.ranking === r} onPress={() => d.setRanking(r)} />
        ))}
      </View>
      {term && items.length > 0 ? (
        <Text variant="bodySmall" color="inkMuted" accessibilityLiveRegion="polite">
          {t('home:discover.resultsFor', { query: term })}
        </Text>
      ) : null}

      {results.isPending ? (
        <View style={styles.skeletonWide} accessible accessibilityLabel={t('common:state.loading')} aria-busy>
          {Array.from({ length: estimate.perView * 2 }, (_, i) => (
            <Skeleton key={i} width={estimate.cardWidth} height={tileHeight(estimate.cardWidth)} />
          ))}
        </View>
      ) : results.isError && items.length === 0 ? (
        <ErrorState error={results.error} onRetry={() => void results.refetch()} />
      ) : items.length === 0 ? (
        term ? (
          <EmptyState title={t('home:discover.noResults', { query: term })} body={t('home:discover.noResultsHint')} />
        ) : (
          <EmptyState
            title={t('home:home.empty')}
            actionLabel={activeCount > 0 ? t('home:discover.filters.clear') : undefined}
            onAction={activeCount > 0 ? clearFilters : undefined}
          />
        )
      ) : (
        <View ref={gridRef}>
          <ResponsiveGrid
            items={items}
            keyExtractor={(s: SeriesCard) => s.id}
            minItemWidth={WIDE_MIN_TILE}
            maxColumns={SHELF_MAX_CARDS}
            gap={WIDE_GAP}
            accessibilityLabel={t('home:discover.resultsA11y')}
            renderItem={(s, { width }) => <SeriesTile series={s} width={width} />}
          />
        </View>
      )}

      {results.isFetchNextPageError ? (
        <ErrorState error={results.error} onRetry={retryMore} />
      ) : results.hasNextPage && items.length > 0 ? (
        // Show more stays while the next page loads, so a keyboard user's focus stays on it.
        <View style={styles.more}>
          {results.isFetchingNextPage ? (
            <ActivityIndicator color={colors.inkMuted} accessibilityLabel={t('common:state.loading')} />
          ) : null}
          <Button label={t('home:discover.showMore')} variant="secondary" onPress={() => requestMore(true)} />
        </View>
      ) : null}
    </View>
  );

  return (
    <PageContainer scrollViewProps={{ onScroll, scrollEventThrottle: SCROLL_THROTTLE_MS, onLayout: onViewport }}>
      <View style={styles.wideTop}>
        <Text variant="title" accessibilityRole="header">
          {t('home:discover.title')}
        </Text>
        <View style={styles.wideSearch}>
          <SearchField value={d.text} onChangeText={d.setText} placeholder={t('home:discover.searchPlaceholder')} inputRef={d.searchRef} />
        </View>
      </View>
      <TwoColumn
        from="medium"
        sidePosition="start"
        sideWidth={filterPanelWidth(size)}
        stickySide={canStickSide(panelHeight, viewportHeight)}
        sideLabel={t('home:discover.filters.title')}
        side={panel}
        main={main}
      />
    </PageContainer>
  );
}

function PanelGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View role="group" aria-label={title} style={styles.panelGroup}>
      <Text variant="bodySmall" color="inkMuted" accessibilityRole="header" {...headingLevel(3)} style={styles.panelGroupTitle}>
        {title}
      </Text>
      <View style={styles.wrap}>{children}</View>
    </View>
  );
}

function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { hovered, focusVisible, handlers } = useInteraction();
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.clear, hovered && styles.textButtonHover, focusVisible && focusRing]}
    >
      <Text variant="bodySmall" style={styles.clearLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  page: { flex: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  flex: { flex: 1 },
  top: { gap: space.md, paddingHorizontal: GUTTER, paddingTop: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1 },
  filterButton: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 44, paddingHorizontal: space.sm },
  filterLabel: { fontFamily: fonts.sansMedium },
  chips: { gap: space.sm, alignItems: 'center', paddingVertical: space.sm },
  clear: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm, borderRadius: radius.chip },
  clearLabel: { fontFamily: fonts.sansMedium, textDecorationLine: 'underline' },
  textButtonHover: { backgroundColor: colors.surfaceAlt },
  cell: { alignItems: 'center', paddingBottom: space.lg },
  footer: { paddingVertical: space.lg },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingHorizontal: GAP / 2 },
  sheetScroll: { maxHeight: 420 },
  sheetContent: { gap: space.lg, paddingBottom: space.lg },
  group: { gap: space.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.md, paddingTop: space.sm },
  // Wide
  wideTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.xl, marginBottom: space.xl },
  wideSearch: { flex: 1, minWidth: 0, maxWidth: SEARCH_MAX_WIDTH, marginLeft: 'auto' },
  panel: {
    gap: space.xl,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  panelHeader: { flexDirection: 'row', alignItems: 'center', minHeight: layout.minTarget },
  panelGroup: { gap: space.sm },
  panelGroupTitle: { fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 0.5 },
  results: { gap: space.lg },
  rankings: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  skeletonWide: { flexDirection: 'row', flexWrap: 'wrap', gap: WIDE_GAP },
  more: { alignItems: 'center', gap: space.md, paddingVertical: space.lg },
});
