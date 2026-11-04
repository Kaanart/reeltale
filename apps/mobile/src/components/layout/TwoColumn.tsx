import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { layout, space } from '../../theme/tokens';
import type { LayoutSize } from './logic';
import { useLayout } from './useLayout';

// Main content with a side panel beside it from `from` up (default: wide windows), stacked below that
// (main first, unless sideFirst). Use it inside a PageContainer.
//
//   <TwoColumn
//     main={<EpisodeList ... />}
//     side={<SeriesInfo ... />}
//     sidePosition="start"       // panel on the left (default "end": right)
//     stickySide                 // web: the panel stays in view while the main column scrolls
//   />

export interface TwoColumnProps {
  main: ReactNode;
  side: ReactNode;
  /** Smallest size class that shows two columns. Default 'wide'. */
  from?: Exclude<LayoutSize, 'compact'>;
  /** Side panel width when side by side. Default layout.sidePanelWidth (360). */
  sideWidth?: number;
  sidePosition?: 'start' | 'end';
  /** When stacked, put the side panel above the main content. */
  sideFirst?: boolean;
  /** Web only: keep the side panel in view while the page scrolls (position: sticky). */
  stickySide?: boolean;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  /** Names the side panel for screen readers (web: role="complementary"). */
  sideLabel?: string;
}

// position: sticky is web-only, so React Native's style types don't list it.
const STICKY = { position: 'sticky', top: space.lg } as unknown as ViewStyle;

export function TwoColumn({
  main,
  side,
  from = 'wide',
  sideWidth = layout.sidePanelWidth,
  sidePosition = 'end',
  sideFirst = false,
  stickySide = false,
  gap = space.xl,
  style,
  sideLabel,
}: TwoColumnProps) {
  const { size } = useLayout();
  const split = size === 'wide' || (from === 'medium' && size === 'medium');
  const web = Platform.OS === 'web';

  const sidePanel = (
    <View
      role={web && sideLabel ? 'complementary' : undefined}
      aria-label={sideLabel}
      style={split ? [{ width: sideWidth }, styles.side, stickySide && web && STICKY] : null}
    >
      {side}
    </View>
  );
  const mainPanel = <View style={split ? styles.main : null}>{main}</View>;

  if (!split) {
    return (
      <View style={[{ gap }, style]}>
        {sideFirst ? sidePanel : mainPanel}
        {sideFirst ? mainPanel : sidePanel}
      </View>
    );
  }
  return (
    <View style={[styles.row, { gap }, style]}>
      {sidePosition === 'start' ? sidePanel : mainPanel}
      {sidePosition === 'start' ? mainPanel : sidePanel}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  main: { flex: 1, minWidth: 0 },
  side: { flexShrink: 0 },
});
