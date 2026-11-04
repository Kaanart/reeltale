import { useTranslation } from 'react-i18next';
import { Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import { focusRing, ResponsiveGrid, useLayout } from '../../../../components/layout';
import { AIBadge, Skeleton, Text } from '../../../../components/ui';
import type { TagRow } from '../../../../lib/types';
import { fonts, layout, motion, radius, space } from '../../../../theme/tokens';
import { isAiSeries, type SeriesCard } from '../../logic';
import { routes } from '../../routes';
import { FEATURED_PAGE, isPlaceholder, POSTER_MIN_WIDTH, slotKey, type Placeholder, type Slot } from '../../storefront';
import { CardLink } from '../CardLink';
import { Cover, POSTER_RATIO } from '../Cover';
import { MaturityMarker } from '../MaturityMarker';
import { TILE_LIFT } from '../SeriesTile';
import { ComingSoon, ComingSoonArt, SlotCell, SlotGrid } from './ComingSoon';
import { useStoreText } from './useStoreText';

const TITLE_LINES = 2;
const TITLE_LINE_HEIGHT = 20;
const META_LINE_HEIGHT = 16;
/** Everything under the poster, fixed so a row of cards has one height. */
const TEXT_HEIGHT = space.sm + TITLE_LINES * TITLE_LINE_HEIGHT + space.xs + META_LINE_HEIGHT;
/** Room in a sideways row for the keyboard focus ring (and the hover lift above the posters). */
const SWIPE_ROOM = layout.focusRingWidth + layout.focusRingOffset + TILE_LIFT;

// Web only: the lift eases in and out (transition* are CSS properties React Native's style types don't list).
const LIFT_TRANSITION = (Platform.OS === 'web'
  ? { transitionProperty: 'transform', transitionDuration: `${motion.fast}ms`, transitionTimingFunction: 'ease-out' }
  : {}) as unknown as ViewStyle;

/**
 * A 9:16 poster with the title (two lines at most) and genre and format under it; opens the series page (a
 * real link on the web). AI series always carry the AI label on the poster.
 */
export function PosterCard({ series, width, tags }: { series: SeriesCard; width: number; tags: readonly TagRow[] }) {
  const text = useStoreText(tags)(series);
  return (
    <CardLink
      href={routes.series(series.slug)}
      accessibilityLabel={text.a11y}
      cardStyle={(s) => [styles.card, { width }, s.pressed && styles.pressed, s.focusVisible && focusRing]}
      render={(s) => (
        <>
          <Cover series={series} width={width} ratio={POSTER_RATIO} style={[LIFT_TRANSITION, s.hovered && styles.lifted]}>
            {isAiSeries(series) ? (
              <View style={styles.topLeft}>
                <AIBadge size="sm" />
              </View>
            ) : null}
            {series.maturity === 'mature' ? (
              <View style={styles.bottomLeft}>
                <MaturityMarker />
              </View>
            ) : null}
          </Cover>
          <View style={styles.text}>
            <Text variant="bodySmall" numberOfLines={TITLE_LINES} style={[styles.title, s.hovered && styles.titleHover]}>
              {series.title}
            </Text>
            <Text variant="caption" color="inkMuted" numberOfLines={1} style={styles.meta}>
              {text.meta}
            </Text>
          </View>
        </>
      )}
    />
  );
}

/**
 * A "Coming soon" poster after a row's real series: the film-frame placeholder with "Coming soon" and the hint
 * where a title and genre would be. Not a link.
 */
export function PlaceholderPoster({ placeholder, width }: { placeholder: Placeholder; width: number }) {
  const { t } = useTranslation();
  return (
    <ComingSoon announced={placeholder.announced} style={{ width }}>
      <ComingSoonArt width={width} ratio={POSTER_RATIO} />
      <View style={styles.text}>
        <Text variant="bodySmall" color="inkMuted" numberOfLines={1} style={styles.title}>
          {t('home:home.store.comingSoon.title')}
        </Text>
        <Text variant="caption" color="inkMuted" numberOfLines={2} style={styles.meta}>
          {t('home:home.store.comingSoon.hint')}
        </Text>
      </View>
    </ComingSoon>
  );
}

/** Space between posters in a row (HomeScreen counts the columns with it: posterColumns). */
export const POSTER_GAP = space.lg;

/**
 * One row of posters: the real series, then any "Coming soon" placeholders (padWithPlaceholders). Medium and
 * wide windows: `columns` across (posterColumns, eight at most), filling the page column, so the caller passes
 * exactly one row. Phones and the apps: posters POSTER_MIN_WIDTH wide in a row that scrolls sideways, so the
 * AI label fits on every picture.
 */
export function PosterRow({
  items, tags, label, columns,
}: { items: readonly Slot<SeriesCard>[]; tags: readonly TagRow[]; label: string; columns: number }) {
  const { isCompact } = useLayout();
  const web = Platform.OS === 'web';
  const renderSlot = (slot: Slot<SeriesCard>, width: number) =>
    isPlaceholder(slot) ? <PlaceholderPoster placeholder={slot} width={width} /> : <PosterCard series={slot} width={width} tags={tags} />;
  if (isCompact) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.swipe} contentContainerStyle={styles.swipeContent}>
        <View role={web ? 'list' : undefined} aria-label={label} style={styles.swipeList}>
          {items.map((slot) => (
            <SlotCell key={slotKey(slot)} slot={slot}>
              {renderSlot(slot, POSTER_MIN_WIDTH)}
            </SlotCell>
          ))}
        </View>
      </ScrollView>
    );
  }
  return <SlotGrid slots={items} columns={columns} gap={POSTER_GAP} label={label} style={styles.row} renderSlot={renderSlot} />;
}

const SKELETON_ITEMS = Array.from({ length: FEATURED_PAGE }, (_, i) => i);

/** Holds a poster row's place while the catalog loads. */
export function PosterRowSkeleton({ columns }: { columns: number }) {
  const { isCompact } = useLayout();
  const items = isCompact ? SKELETON_ITEMS.slice(0, 3) : SKELETON_ITEMS.slice(0, columns);
  return (
    <ResponsiveGrid
      items={items}
      keyExtractor={(i) => i}
      columns={{ compact: items.length, medium: items.length, wide: items.length }}
      gap={POSTER_GAP}
      style={styles.row}
      renderItem={(_, { width }) => (
        <View style={styles.skeleton}>
          <Skeleton width={width} height={Math.ceil(width / POSTER_RATIO)} radius={radius.card} />
          <Skeleton width="80%" />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card },
  pressed: { opacity: 0.7 },
  lifted: { transform: [{ translateY: -TILE_LIFT }] },
  topLeft: { position: 'absolute', top: space.sm, left: space.sm },
  bottomLeft: { position: 'absolute', bottom: space.sm, left: space.sm },
  text: { height: TEXT_HEIGHT, paddingTop: space.sm },
  title: { fontFamily: fonts.sansMedium, lineHeight: TITLE_LINE_HEIGHT },
  titleHover: { textDecorationLine: 'underline' },
  meta: { marginTop: space.xs, lineHeight: META_LINE_HEIGHT },
  // Room above the posters for their hover lift.
  row: { paddingTop: TILE_LIFT, rowGap: space.xl },
  // A sideways scroll view clips what sticks out: room for the focus ring, padded back so posters line up.
  swipe: { margin: -SWIPE_ROOM },
  swipeContent: { padding: SWIPE_ROOM },
  swipeList: { flexDirection: 'row', gap: space.md },
  skeleton: { gap: space.sm },
});
