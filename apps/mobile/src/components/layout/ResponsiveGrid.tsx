import { Children, useCallback, useState, type Key, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { space } from '../../theme/tokens';
import { columnWidth, gridColumns, gridItemWidth, type LayoutSize } from './logic';
import { useLayout } from './useLayout';

// Cards in rows: as many columns as fit while every card stays at least `minItemWidth` wide (or a fixed
// number per size class with `columns`). Measures its own width, so it is right inside a TwoColumn too.
//
//   <ResponsiveGrid items={series} keyExtractor={(s) => s.id} minItemWidth={160} maxColumns={6}
//     renderItem={(s, { width }) => <SeriesTile series={s} width={width} />} />
//   <ResponsiveGrid columns={{ compact: 1, medium: 2, wide: 3 }}>{cards}</ResponsiveGrid>
//
// It renders every item (no virtualisation): fine for shelves and result pages of a few dozen cards. For
// long lists use FlashList with numColumns={gridColumns(width, ...)} from ./logic.

export interface GridItemInfo {
  /** The item's width in px/pt (whole number). */
  width: number;
  index: number;
  columns: number;
}

interface BaseProps {
  /** Narrowest a card may get (auto columns). Default 160. Ignored when `columns` is set. */
  minItemWidth?: number;
  /** Fixed columns per size class instead of auto. */
  columns?: Partial<Record<LayoutSize, number>>;
  maxColumns?: number;
  minColumns?: number;
  /** Space between cards. Default space.lg (16). */
  gap?: number;
  style?: StyleProp<ViewStyle>;
  /** Names the list for screen readers (web: role="list"). */
  accessibilityLabel?: string;
  testID?: string;
}

export type ResponsiveGridProps<T> = BaseProps &
  (
    | { items: readonly T[]; renderItem: (item: T, info: GridItemInfo) => ReactNode; keyExtractor: (item: T, index: number) => Key; children?: never }
    | { children: ReactNode; items?: never; renderItem?: never; keyExtractor?: never }
  );

export function ResponsiveGrid<T>(props: ResponsiveGridProps<T>) {
  const { minItemWidth = 160, columns, maxColumns, minColumns, gap = space.lg, style, accessibilityLabel, testID } = props;
  const { size, width: windowWidth } = useLayout();
  // Until the grid has measured itself, assume it spans the page column.
  const [measured, setMeasured] = useState<number | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    setMeasured((prev) => (prev === w ? prev : w));
  }, []);
  const width = measured !== null && measured > 0 ? measured : columnWidth(windowWidth);

  const fixed = columns?.[size];
  const cols = fixed !== undefined
    ? Math.max(1, Math.floor(fixed))
    : gridColumns(width, { minItemWidth, gap, maxColumns, minColumns });
  const itemWidth = gridItemWidth(width, cols, gap);

  const cells: { key: Key; node: ReactNode }[] = props.items
    ? props.items.map((item, index) => ({
      key: props.keyExtractor(item, index),
      node: props.renderItem(item, { width: itemWidth, index, columns: cols }),
    }))
    : Children.toArray(props.children).map((node, index) => ({ key: (node as { key?: Key | null }).key ?? index, node }));

  const web = Platform.OS === 'web';
  return (
    <View
      onLayout={onLayout}
      role={web ? 'list' : undefined}
      aria-label={accessibilityLabel}
      testID={testID}
      style={[styles.grid, { gap }, style]}
    >
      {cells.map((cell) => (
        <View key={cell.key} role={web ? 'listitem' : undefined} style={{ width: itemWidth }}>
          {cell.node}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%' },
});
