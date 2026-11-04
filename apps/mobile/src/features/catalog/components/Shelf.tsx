import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { columnWidth, focusRing, useInteraction, useLayout } from '../../../components/layout';
import { Text } from '../../../components/ui';
import { colors, layout, radius, space } from '../../../theme/tokens';
import {
  rowWidth, SHELF_MAX_CARDS, SHELF_MIN_CARD_WIDTH, shelfArrows, shelfLayout, shelfOverflows, shelfScrollTarget,
} from '../layout';
import type { DiscoverOptions } from '../routes';
import { focusWasLost, headingLevel } from './a11y';
import { DecorativeIcon } from './DecorativeIcon';
import { SeeAllLink } from './SeeAllLink';
import { TILE_LIFT } from './SeriesTile';

// Wide enough for "Stop-motion · Completed" on one line (the meta line under a cover never wraps).
export const SHELF_CARD_WIDTH = 148;
/** Space between cards on phones. */
const COMPACT_GAP = space.md;
const ARROW_ICON = 20;
const SCROLL_THROTTLE_MS = 32;
/**
 * Room around the cards for the keyboard focus ring. A sideways scroll view clips whatever sits outside its
 * box, so the row reaches this far past the page column on both sides, padded back by the same amount (the
 * cards still line up with the page).
 */
const RING_ROOM = layout.focusRingWidth + layout.focusRingOffset;

export interface ShelfProps<T> {
  title: string;
  items: readonly T[];
  keyExtractor: (item: T) => string;
  /** One card, `width` wide. */
  renderItem: (item: T, width: number) => ReactNode;
  /** Phones and the apps: every card is this wide and the row scrolls sideways to the screen's edges. */
  compactCardWidth?: number;
  /** The website at medium and wide widths: as many cards as fit at this width or more, stretched to fill. */
  minCardWidth?: number;
  maxCards?: number;
  /** Shows "See all" (Discover on that ranking or tag) in the header. */
  seeAll?: DiscoverOptions;
}

/**
 * A titled row of cards that scrolls sideways (a dozen at most, so a plain scroll view is enough).
 *
 * Phones and the apps: fixed-width cards running to the screen's edges, swiped sideways. The website on a
 * laptop: the cards fill the page column exactly, and when there are more than fit, Previous / Next buttons
 * in the header move the row a whole view at a time (a mouse can't swipe). Keyboard users can also Tab
 * through the cards; the row follows the focus. Lives inside a PageContainer (it reaches past the gutters on
 * phones by itself).
 */
export function Shelf<T>(props: ShelfProps<T>) {
  const { hasTopNav } = useLayout();
  return hasTopNav ? <PagedShelf {...props} /> : <SwipeShelf {...props} />;
}

function SwipeShelf<T>({ title, items, keyExtractor, renderItem, compactCardWidth = SHELF_CARD_WIDTH, seeAll }: ShelfProps<T>) {
  const { gutter } = useLayout();
  return (
    <View style={styles.shelf}>
      <Header title={title} seeAll={seeAll} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -gutter }}
        contentContainerStyle={[styles.row, { paddingHorizontal: gutter, gap: COMPACT_GAP }]}
        accessibilityLabel={title}
      >
        {items.map((item) => (
          <View key={keyExtractor(item)}>{renderItem(item, compactCardWidth)}</View>
        ))}
      </ScrollView>
    </View>
  );
}

function PagedShelf<T>({
  title, items, keyExtractor, renderItem, minCardWidth = SHELF_MIN_CARD_WIDTH, maxCards = SHELF_MAX_CARDS, seeAll,
}: ShelfProps<T>) {
  const { t } = useTranslation();
  const { width: windowWidth } = useLayout();
  const reduceMotion = useReducedMotion();
  const scrollRef = useRef<ScrollView>(null);
  const prevRef = useRef<View>(null);
  const nextRef = useRef<View>(null);
  // The arrow just pressed, when that press takes the row to its end. That arrow then turns disabled, and a
  // disabled button drops the keyboard focus to the top of the page, so the focus moves to the other arrow.
  const handoff = useRef<'prev' | 'next' | null>(null);
  // Until the row has measured itself, assume it spans the page column.
  const [measured, setMeasured] = useState(0);
  const [offset, setOffset] = useState(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    setMeasured((prev) => (prev === w ? prev : w));
  }, []);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setOffset(e.nativeEvent.contentOffset.x);
  }, []);

  const viewport = measured > 0 ? measured : columnWidth(windowWidth);
  const shelf = shelfLayout(viewport, { minCardWidth, maxCards });
  const content = rowWidth(items.length, shelf.cardWidth, shelf.gap);
  const metrics = { offset, viewport, content };
  const overflows = shelfOverflows(items.length, shelf.perView);
  const can = shelfArrows(metrics);

  const go = (direction: 'prev' | 'next') => {
    const x = shelfScrollTarget(metrics, direction, shelf);
    const after = shelfArrows({ ...metrics, offset: x });
    handoff.current = (direction === 'next' ? after.next : after.prev) ? null : direction;
    scrollRef.current?.scrollTo({ x, y: 0, animated: !reduceMotion });
  };

  useEffect(() => {
    const from = handoff.current;
    if (!from || (from === 'next' ? can.next : can.prev)) return;
    handoff.current = null;
    const pressed = from === 'next' ? nextRef.current : prevRef.current;
    const other = from === 'next' ? prevRef.current : nextRef.current;
    if (focusWasLost(pressed)) other?.focus();
  }, [can.prev, can.next]);

  return (
    <View style={styles.shelf}>
      <Header title={title} seeAll={seeAll}>
        {overflows ? (
          <View style={styles.arrows}>
            <ArrowButton
              ref={prevRef}
              icon="chevron-back"
              label={t('home:home.shelf.previousA11y', { title })}
              disabled={!can.prev}
              onPress={() => go('prev')}
            />
            <ArrowButton
              ref={nextRef}
              icon="chevron-forward"
              label={t('home:home.shelf.nextA11y', { title })}
              disabled={!can.next}
              onPress={() => go('next')}
            />
          </View>
        ) : null}
      </Header>
      <View onLayout={onLayout}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={SCROLL_THROTTLE_MS}
          style={styles.pagedScroll}
          contentContainerStyle={[styles.row, styles.pagedRow, { gap: shelf.gap }]}
          accessibilityLabel={title}
        >
          {items.map((item) => (
            <View key={keyExtractor(item)} style={{ width: shelf.cardWidth }}>
              {renderItem(item, shelf.cardWidth)}
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function Header({ title, seeAll, children }: { title: string; seeAll?: DiscoverOptions; children?: ReactNode }) {
  return (
    <View style={styles.header}>
      <Text variant="heading" accessibilityRole="header" {...headingLevel(2)} style={styles.title}>
        {title}
      </Text>
      {seeAll ? <SeeAllLink title={title} options={seeAll} /> : null}
      {children}
    </View>
  );
}

function ArrowButton({
  icon, label, disabled, onPress, ref,
}: { icon: 'chevron-back' | 'chevron-forward'; label: string; disabled: boolean; onPress: () => void; ref?: Ref<View> }) {
  const { hovered, focusVisible, handlers } = useInteraction();
  return (
    <Pressable
      ref={ref}
      {...handlers}
      onPress={onPress}
      // react-native-web makes this a disabled <button> (aria-disabled too), which leaves the tab order: the
      // shelf moves the focus to the other arrow when this one turns disabled under it (PagedShelf).
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.arrow,
        (hovered || pressed) && !disabled && styles.arrowHover,
        disabled && styles.arrowDisabled,
        focusVisible && focusRing,
      ]}
    >
      <DecorativeIcon name={icon} size={ARROW_ICON} color={disabled ? 'inkMuted' : 'ink'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shelf: { marginTop: space.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  title: { flex: 1 },
  row: { paddingTop: space.xs },
  // Room above the covers for their hover lift, and around the cards for the focus ring, so the scroll view
  // doesn't clip either. The padding on the sides is the same on both ends, so the arrows' maths (which
  // only uses the difference between the row and the view) doesn't change.
  pagedScroll: { marginHorizontal: -RING_ROOM },
  pagedRow: { paddingTop: TILE_LIFT + space.xs, paddingHorizontal: RING_ROOM, paddingBottom: RING_ROOM },
  arrows: { flexDirection: 'row', gap: space.sm, marginLeft: space.sm },
  arrow: {
    width: layout.minTarget,
    height: layout.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  arrowHover: { backgroundColor: colors.surfaceAlt, borderColor: colors.inkMuted },
  arrowDisabled: { opacity: 0.4 },
});
