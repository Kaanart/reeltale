import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { focusRing, ResponsiveGrid } from '../../../../components/layout';
import { AIBadge, Text } from '../../../../components/ui';
import type { TagRow } from '../../../../lib/types';
import { colors, fonts, radius, space, type ColorName } from '../../../../theme/tokens';
import { useEpisodeSummary } from '../../hooks';
import { isAiSeries, type Ranking, type SeriesCard } from '../../logic';
import { routes } from '../../routes';
import { isPlaceholder, rankLabel, rankTone, slotKey, type Placeholder, type Slot } from '../../storefront';
import { headingLevel } from '../a11y';
import { CardLink } from '../CardLink';
import { Cover, POSTER_RATIO } from '../Cover';
import { DiscoverLink } from '../SeeAllLink';
import { ComingSoon, ComingSoonArt, SlotCell } from './ComingSoon';
import { SectionHeader } from './SectionHeader';
import { useStoreText } from './useStoreText';

const COVER_WIDTH = 52;
const RANK_WIDTH = 28;
const BAR_WIDTH = 32;
const BAR_HEIGHT = 3;

const TONE: Record<'first' | 'second' | 'third', ColorName> = { first: 'accentStrong', second: 'rankAmber', third: 'rankTeal' };

export interface RankingList {
  ranking: Ranking;
  title: string;
  /** Up to five series, then "Coming soon" placeholders (padWithPlaceholders). */
  items: readonly Slot<SeriesCard>[];
}

/** "Rankings": Trending, New and Completed side by side (stacked on phones), each a numbered list of five. */
export function Rankings({ lists, tags }: { lists: readonly RankingList[]; tags: readonly TagRow[] }) {
  const { t } = useTranslation();
  return (
    <View testID="home-rankings">
      <SectionHeader title={t('home:home.store.rankings')} />
      <ResponsiveGrid
        items={lists}
        keyExtractor={(l) => l.ranking}
        columns={{ compact: 1, medium: 3, wide: 3 }}
        gap={space.xl}
        style={styles.grid}
        renderItem={(list) => <RankingColumn list={list} tags={tags} />}
      />
    </View>
  );
}

function RankingColumn({ list, tags }: { list: RankingList; tags: readonly TagRow[] }) {
  const { t } = useTranslation();
  const web = Platform.OS === 'web';
  return (
    <View style={styles.column}>
      <View style={styles.columnHeader}>
        <View style={styles.columnTitle}>
          <Text variant="heading" accessibilityRole="header" {...headingLevel(3)}>
            {list.title}
          </Text>
          <View style={styles.bar} />
        </View>
        <DiscoverLink
          options={{ ranking: list.ranking }}
          label={t('home:home.store.more')}
          accessibilityLabel={t('home:home.store.moreA11y', { title: list.title })}
          variant="text"
        />
      </View>
      {list.items.length === 0 ? (
        <Text variant="bodySmall" color="inkMuted" style={styles.empty}>
          {t('home:home.store.rankEmpty')}
        </Text>
      ) : (
        <View role={web ? 'list' : undefined} aria-label={list.title} style={styles.rows}>
          {list.items.map((slot, i) => (
            <SlotCell key={slotKey(slot)} slot={slot}>
              {isPlaceholder(slot) ? <PlaceholderRow placeholder={slot} /> : <RankRow series={slot} index={i} tags={tags} />}
            </SlotCell>
          ))}
        </View>
      )}
    </View>
  );
}

function RankRow({ series, index, tags }: { series: SeriesCard; index: number; tags: readonly TagRow[] }) {
  const { t } = useTranslation();
  const text = useStoreText(tags)(series);
  const episodes = useEpisodeSummary(series.id);
  const tone = rankTone(index);
  const rank = rankLabel(index);
  const info = [
    episodes.count > 0 ? t('common:episode.count', { count: episodes.count }) : null,
    series.completed ? t('home:home.store.completedLabel') : null,
  ].filter((x): x is string => !!x).join(' · ');
  const label = [text.a11y, info].filter(Boolean).join(', ');
  return (
    <CardLink
      href={routes.series(series.slug)}
      accessibilityLabel={t('home:home.store.rankA11y', { rank: index + 1, label })}
      cardStyle={(s) => [styles.row, s.hovered && styles.rowHover, s.pressed && styles.pressed, s.focusVisible && focusRing]}
      render={(s) => (
        <>
          <Cover series={series} width={COVER_WIDTH} ratio={POSTER_RATIO} initialVariant="heading" style={styles.cover} />
          <View style={styles.rowText}>
            <View style={styles.titleLine}>
              <Text variant="subheading" color={tone ? TONE[tone] : 'inkMuted'} style={styles.rank}>
                {rank}
              </Text>
              <Text variant="body" numberOfLines={1} style={[styles.title, s.hovered && styles.titleHover]}>
                {series.title}
              </Text>
            </View>
            <View style={styles.details}>
              <Text variant="bodySmall" color="inkMuted" numberOfLines={1}>
                {text.meta}
              </Text>
              {info ? (
                <Text variant="caption" color="inkMuted" numberOfLines={1}>
                  {info}
                </Text>
              ) : null}
              {isAiSeries(series) ? <AIBadge size="sm" /> : null}
            </View>
          </View>
        </>
      )}
    />
  );
}

/** A place no series fills yet: the film-frame cover, "Coming soon" and the hint, no rank number. Not a link. */
function PlaceholderRow({ placeholder }: { placeholder: Placeholder }) {
  const { t } = useTranslation();
  return (
    <ComingSoon announced={placeholder.announced} style={styles.row}>
      <ComingSoonArt width={COVER_WIDTH} ratio={POSTER_RATIO} style={styles.cover} />
      <View style={styles.rowText}>
        <View style={styles.titleLine}>
          <View style={styles.rank} />
          <Text variant="body" color="inkMuted" numberOfLines={1} style={styles.title}>
            {t('home:home.store.comingSoon.title')}
          </Text>
        </View>
        <View style={styles.details}>
          <Text variant="bodySmall" color="inkMuted" numberOfLines={2}>
            {t('home:home.store.comingSoon.hint')}
          </Text>
        </View>
      </View>
    </ComingSoon>
  );
}

const styles = StyleSheet.create({
  grid: { rowGap: space.xxl },
  column: { gap: space.md },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  columnTitle: { flex: 1, gap: space.xs },
  bar: { width: BAR_WIDTH, height: BAR_HEIGHT, borderRadius: radius.pill, backgroundColor: colors.accent },
  empty: { paddingVertical: space.lg },
  rows: { gap: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.sm,
    marginHorizontal: -space.sm,
    borderRadius: radius.card,
  },
  rowHover: { backgroundColor: colors.surfaceAlt },
  pressed: { opacity: 0.7 },
  cover: { borderRadius: radius.chip },
  rowText: { flex: 1, minWidth: 0, gap: space.xs, paddingTop: space.xs },
  titleLine: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  rank: { width: RANK_WIDTH, fontFamily: fonts.sansBold },
  title: { flex: 1, minWidth: 0, fontFamily: fonts.sansMedium },
  titleHover: { textDecorationLine: 'underline' },
  details: { paddingLeft: RANK_WIDTH + space.sm, gap: space.xs, alignItems: 'flex-start' },
});
