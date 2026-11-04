import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { columnWidth, PageContainer, TwoColumn, useLayout, usePageTitle } from '../../../components/layout';
import { Text } from '../../../components/ui';
import type { TagRow } from '../../../lib/types';
import { space } from '../../../theme/tokens';
import { CONTINUE_CARD_WIDTH, ContinueCard } from '../components/ContinueCard';
import { DemoStoryCard } from '../components/DemoStoryCard';
import { IconButton } from '../components/IconButton';
import { SeeAllLink } from '../components/SeeAllLink';
import { Shelf } from '../components/Shelf';
import { EmptyState, ErrorState } from '../components/States';
import { MeetReelTale } from '../components/store/MeetReelTale';
import { EditorsChoice, NewArrivals } from '../components/store/NewArrivals';
import { POSTER_GAP, PosterRow, PosterRowSkeleton } from '../components/store/PosterCard';
import { PromoBanners } from '../components/store/PromoBanners';
import { Rankings, type RankingList } from '../components/store/Rankings';
import { HeaderButton, SectionHeader, useSectionGap } from '../components/store/SectionHeader';
import { TagCloud } from '../components/store/TagCloud';
import { WeeklyPick, WeeklyPickSkeleton } from '../components/store/WeeklyPick';
import { useHistory, useRefreshOnFocus, useSeriesCards, useTags } from '../hooks';
import { CONTINUE_MAX_CARDS, CONTINUE_MIN_CARD_WIDTH } from '../layout';
import { continueWatching, SHELF_SIZE, type HistoryEntry } from '../logic';
import { routes } from '../routes';
import {
  buildStorefront, canSwitch, FEATURED_PAGE, nextWindowStart, popularTags, posterColumns, rotatingWindow,
} from '../storefront';

/** How many recent series Home cuts Weekly featured, the rankings, New arrivals and the tags from. */
const POOL_SIZE = 60;
const CONTINUE_LIMIT = 10;
const HEADER_HEIGHT = 56;
/** "Meet ReelTale" beside the carousel, and the demo story beside "Continue watching" (wide windows). */
const SIDE_WIDTH = 380;
/** "Editors' choice" beside "New arrivals" (wide windows). */
const EDITORS_WIDTH = 440;
const NO_TAGS: readonly TagRow[] = [];

const entryKey = (e: HistoryEntry) => e.episode.id;
const renderContinue = (e: HistoryEntry, width: number) => <ContinueCard entry={e} width={width} />;

// Home, as a storefront (the website's front page; phones and the apps stack the same sections):
//   Weekly pick carousel  |  Meet ReelTale
//   Weekly featured (eight posters, Switch)
//   Rankings: Trending, New, Completed (numbered 01-05)
//   Continue watching (when there is history)  |  Try the demo story
//   Popular tags
//   New arrivals (strip + large preview)  |  Editors' choice
//   Completed series
//   Promo banners: Browse all series, Become a creator, Make a story with AI
// and the site footer (PageContainer). Everything comes from the catalog's own lists (storefront.ts): no
// ratings, view counts or prices.

export function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { hasTopNav, isWide, isCompact, width } = useLayout();
  const gap = useSectionGap();
  usePageTitle(t('common:nav.home'));

  const pool = useSeriesCards({ ranking: 'trending', limit: POOL_SIZE });
  const completed = useSeriesCards({ ranking: 'completed', limit: SHELF_SIZE });
  const picks = useSeriesCards({ ranking: 'editorsPicks', limit: SHELF_SIZE });
  const tags = useTags();
  const history = useHistory();

  const tagRows = tags.data ?? NO_TAGS;
  const store = useMemo(
    () => buildStorefront({ pool: pool.data ?? [], picks: picks.data ?? [], completed: completed.data ?? [] }),
    [pool.data, picks.data, completed.data],
  );
  const popular = useMemo(() => popularTags(tagRows, pool.data ?? []), [tagRows, pool.data]);
  const resume = useMemo(() => continueWatching(history.data ?? [], CONTINUE_LIMIT), [history.data]);
  // One row of posters: as many as fit across the page column (phones: a row that scrolls sideways).
  const posterCols = posterColumns(columnWidth(width), POSTER_GAP);
  const featuredPage = isCompact ? FEATURED_PAGE : posterCols;
  const [featuredStart, setFeaturedStart] = useState(0);
  const featured = rotatingWindow(store.featured, featuredStart, featuredPage);
  const completedRow = store.completed.slice(0, featuredPage);

  const [refreshing, setRefreshing] = useState(false);
  const refetchAll = useCallback(
    () => Promise.all([pool.refetch(), completed.refetch(), picks.refetch(), tags.refetch(), history.refetch()]),
    [pool, completed, picks, tags, history],
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

  const loading = pool.isPending;
  const failed = pool.isError && !pool.data;
  const empty = !loading && !failed && store.featured.length === 0;

  const rankings: RankingList[] = [
    { ranking: 'trending', title: t('home:home.trending'), items: store.rankings.trending },
    { ranking: 'new', title: t('home:home.new'), items: store.rankings.fresh },
    { ranking: 'completed', title: t('home:home.completed'), items: store.rankings.completed },
  ];

  // With nothing to feature (an empty or unreachable catalog) the demo story takes the carousel's place, and
  // is not offered a second time further down.
  const heroLoading = loading || picks.isPending;
  const heroIsDemo = !heroLoading && store.hero.length === 0;
  const hero = heroLoading
    ? <WeeklyPickSkeleton />
    : heroIsDemo
      ? <DemoStoryCard onStart={startDemo} variant="hero" />
      : <WeeklyPick series={store.hero} tags={tagRows} />;
  const continueShelf = (
    <Shelf
      title={t('home:home.continueWatching')}
      items={resume}
      keyExtractor={entryKey}
      renderItem={renderContinue}
      compactCardWidth={CONTINUE_CARD_WIDTH}
      minCardWidth={CONTINUE_MIN_CARD_WIDTH}
      maxCards={CONTINUE_MAX_CARDS}
    />
  );

  const arrivals = store.arrivals.length > 0 ? <NewArrivals items={store.arrivals} tags={tagRows} /> : null;
  const editors = store.editors.length > 0 ? <EditorsChoice items={store.editors} tags={tagRows} /> : null;

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

      <TwoColumn main={hero} side={<MeetReelTale />} sideWidth={SIDE_WIDTH} gap={space.xxl} />

      {failed ? (
        <Section gap={gap}>
          <ErrorState error={pool.error} onRetry={() => void refetchAll()} />
        </Section>
      ) : empty ? (
        <Section gap={gap}>
          <EmptyState title={t('home:home.empty')} />
        </Section>
      ) : (
        <>
          <Section gap={gap} testID="home-weekly-featured">
            <SectionHeader
              title={t('home:home.store.weeklyFeatured')}
              action={
                canSwitch(store.featured.length, featuredPage) ? (
                  <HeaderButton
                    label={t('home:home.store.switch')}
                    accessibilityLabel={t('home:home.store.switchA11y')}
                    icon="shuffle"
                    onPress={() => setFeaturedStart((s) => nextWindowStart(s, store.featured.length, featuredPage))}
                  />
                ) : null
              }
            />
            {loading ? (
              <PosterRowSkeleton columns={posterCols} />
            ) : (
              <PosterRow items={featured} tags={tagRows} label={t('home:home.store.weeklyFeatured')} columns={posterCols} />
            )}
          </Section>
          {loading ? null : (
            <Section gap={gap}>
              <Rankings lists={rankings} tags={tagRows} />
            </Section>
          )}
        </>
      )}

      {/* The Continue watching shelf brings its own top margin. */}
      {resume.length > 0 ? (
        <Section gap={gap - space.xl}>
          {heroIsDemo ? (
            continueShelf
          ) : (
            <TwoColumn
              main={continueShelf}
              side={
                <View style={isWide ? styles.besideShelf : null}>
                  <DemoStoryCard onStart={startDemo} variant={isWide ? 'hero' : 'card'} />
                </View>
              }
              sideWidth={SIDE_WIDTH}
              gap={space.xxl}
            />
          )}
        </Section>
      ) : heroIsDemo ? null : (
        <Section gap={gap}>
          <DemoStoryCard onStart={startDemo} />
        </Section>
      )}

      {popular.length > 0 ? (
        <Section gap={gap}>
          <TagCloud tags={popular} />
        </Section>
      ) : null}

      {arrivals || editors ? (
        <Section gap={gap}>
          {arrivals && editors ? (
            <TwoColumn main={arrivals} side={editors} sideWidth={EDITORS_WIDTH} gap={space.xxl} />
          ) : (
            arrivals ?? editors
          )}
        </Section>
      ) : null}

      {store.completed.length > 0 ? (
        <Section gap={gap} testID="home-completed">
          <SectionHeader
            title={t('home:home.store.completedSeries')}
            action={<SeeAllLink title={t('home:home.store.completedSeries')} options={{ ranking: 'completed' }} />}
          />
          <PosterRow items={completedRow} tags={tagRows} label={t('home:home.store.completedSeries')} columns={posterCols} />
        </Section>
      ) : null}

      <Section gap={gap}>
        <PromoBanners />
      </Section>
    </PageContainer>
  );
}

function Section({ gap, children, testID }: { gap: number; children: ReactNode; testID?: string }) {
  return (
    <View style={{ marginTop: gap }} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // The search button's hit area reaches into the gutter, so the icon sits where it always did.
  header: { flexDirection: 'row', alignItems: 'center', minHeight: HEADER_HEIGHT, marginRight: -space.sm },
  wordmark: { flex: 1 },
  // The shelf beside it starts with its own top margin; the card lines up with the shelf's title.
  besideShelf: { paddingTop: space.xl },
});
