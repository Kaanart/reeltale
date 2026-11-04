import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { columnWidth, gridItemWidth, useLayout } from '../../../../components/layout';
import { Text } from '../../../../components/ui';
import { colors, fonts, radius, space } from '../../../../theme/tokens';
import { isPlaceholder, slotKey, type Slot } from '../../storefront';
import { DecorativeIcon } from '../DecorativeIcon';

// "Coming soon" placeholders for storefront rows the catalog can't fill yet (storefront.ts:
// padWithPlaceholders). Drawn with tokens only, no pictures. A placeholder names no series and opens nothing.

/** Narrower than this, the film frame has thinner edges and a smaller icon, and no words fit inside it. */
const SMALL = 96;
/** Narrower than this, the words inside are set a size smaller (the New arrivals strip). */
const NARROW = 140;
const RAIL = { small: 6, large: 9 } as const;
const HOLE = { small: { width: 3, height: 4 }, large: { width: 5, height: 6 } } as const;
const ICON = { small: 16, large: 28 } as const;

/** Spread into a View to hide it, and everything in it, from screen readers (iOS, Android and the web). */
export const hiddenFromScreenReaders = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
  'aria-hidden': true,
} as const;

export interface ComingSoonArtProps {
  width: number;
  /** Width over height (POSTER_RATIO for 9:16 posters). */
  ratio: number;
  /** 'page' on the page's background; 'panel' inside a surfaceAlt panel (New arrivals). */
  tone?: 'page' | 'panel';
  /** Words inside the frame: none (the caller writes them beside it), "Coming soon", or that and the hint. */
  words?: 'none' | 'title' | 'full';
  /** Sprocket holes down both edges. Off inside the Weekly pick's film strip, which has its own. */
  sprockets?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The placeholder's picture: a frame of vertical film in a soft paper tone, with sprocket holes down both edges
 * and a film icon in the middle. Decorative: the placeholder around it is what screen readers get.
 */
export function ComingSoonArt({ width, ratio, tone = 'page', words = 'none', sprockets = true, style }: ComingSoonArtProps) {
  const { t } = useTranslation();
  const size = width < SMALL ? 'small' : 'large';
  const height = width / ratio;
  const hole = HOLE[size];
  const holes = Math.max(3, Math.floor(height / (hole.height * 3)));
  const rail = sprockets ? (
    <View style={[styles.rail, { width: RAIL[size] }]}>
      {Array.from({ length: holes }, (_, i) => (
        <View key={i} style={[styles.hole, hole, tone === 'panel' && styles.holePanel]} />
      ))}
    </View>
  ) : null;
  return (
    <View
      {...hiddenFromScreenReaders}
      style={[styles.frame, { width, aspectRatio: ratio }, tone === 'panel' && styles.framePanel, style]}
    >
      {rail}
      <View style={styles.middle}>
        <DecorativeIcon name="film-outline" size={ICON[size]} color="inkMuted" />
        {words !== 'none' && size === 'large' ? (
          <View style={styles.words}>
            <Text variant={width < NARROW ? 'caption' : 'bodySmall'} color="inkMuted" align="center" style={styles.title}>
              {t('home:home.store.comingSoon.title')}
            </Text>
            {words === 'full' ? (
              <Text variant="caption" color="inkMuted" align="center">
                {t('home:home.store.comingSoon.hint')}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      {rail}
    </View>
  );
}

/**
 * Wraps one placeholder. The first in a row (`announced`) reads as one picture named "Coming soon: new series
 * are on the way"; the others are hidden from screen readers. Never a link or a button.
 */
export function ComingSoon({ announced, style, children }: { announced: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const { t } = useTranslation();
  if (!announced) {
    return (
      <View {...hiddenFromScreenReaders} style={style}>
        {children}
      </View>
    );
  }
  const label = t('home:home.store.comingSoon.a11y');
  return (
    <View accessible role="img" accessibilityLabel={label} style={style}>
      {children}
    </View>
  );
}

/**
 * One place in a row that is a list on the web: a list item, except a placeholder that only repeats the one
 * before it, which is left out of the list (so the list counts the series and one "Coming soon").
 */
export function SlotCell({ slot, style, children }: { slot: Slot<object>; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  if (isPlaceholder(slot) && !slot.announced) {
    return (
      <View {...hiddenFromScreenReaders} style={style}>
        {children}
      </View>
    );
  }
  return (
    <View role={Platform.OS === 'web' ? 'listitem' : undefined} style={style}>
      {children}
    </View>
  );
}

/**
 * Like ResponsiveGrid with fixed columns, for rows of slots: real series and the first placeholder are list
 * items, later placeholders are hidden from screen readers. Measures its own width (right inside a TwoColumn).
 */
export function SlotGrid<T extends { id: string }>({
  slots, columns, gap, label, style, renderSlot,
}: {
  slots: readonly Slot<T>[];
  columns: number;
  gap: number;
  label: string;
  style?: StyleProp<ViewStyle>;
  renderSlot: (slot: Slot<T>, width: number) => ReactNode;
}) {
  const { width: windowWidth } = useLayout();
  const [measured, setMeasured] = useState<number | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    setMeasured((prev) => (prev === w ? prev : w));
  }, []);
  const rowWidth = measured !== null && measured > 0 ? measured : columnWidth(windowWidth);
  const width = gridItemWidth(rowWidth, columns, gap);
  return (
    <View
      onLayout={onLayout}
      role={Platform.OS === 'web' ? 'list' : undefined}
      aria-label={label}
      style={[styles.grid, { gap }, style]}
    >
      {slots.map((slot) => (
        <SlotCell key={slotKey(slot)} slot={slot} style={{ width }}>
          {renderSlot(slot, width)}
        </SlotCell>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surfaceAlt,
  },
  framePanel: { backgroundColor: colors.bg },
  rail: { alignItems: 'center', justifyContent: 'space-evenly', backgroundColor: colors.line },
  hole: { borderRadius: 1, backgroundColor: colors.bg },
  holePanel: { backgroundColor: colors.surface },
  middle: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xs },
  words: { alignItems: 'center', gap: space.xs },
  title: { fontFamily: fonts.sansMedium },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%' },
});
