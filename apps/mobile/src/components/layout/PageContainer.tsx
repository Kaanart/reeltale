import type { ReactNode, Ref } from 'react';
import { Platform, ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { colors, space } from '../../theme/tokens';
import { maxWidthFor, type ContentWidth } from './logic';
import { SiteFooter } from './SiteFooter';
import { useLayout } from './useLayout';

// A page: a centred column (at most 1200 px wide by default) with side gutters for the window's size class,
// in a ScrollView, ending with the site footer on the web at medium and wide widths. Phones and the native
// apps get the same column at full width with a 16 pt gutter.
//
//   <PageContainer>                       ...content...    </PageContainer>
//   <PageContainer width="reading">       a series page, settings (760)
//   <PageContainer scroll={false}>        the screen scrolls itself (FlashList): put <SiteFooter /> in it
//   <PageContainer scrollViewProps={{ refreshControl: <RefreshControl ... /> }}>

export interface PageContainerProps {
  children: ReactNode;
  /** The column's widest: 'content' 1200, 'reading' 760, 'narrow' 560, 'full' no cap. Default 'content'. */
  width?: ContentWidth;
  /** Scroll the page (default). false: a plain flex column, for screens with their own list. */
  scroll?: boolean;
  /** End the page with SiteFooter (web, medium and wide only). Default true; ignored when scroll is false. */
  footer?: boolean;
  /** Space above the content. Default true. */
  padTop?: boolean;
  /** Safe-area edges padded in the native apps (the web has no insets). Default top, left, right. */
  edges?: readonly Edge[];
  /** Extra style for the content column (gaps, alignment). */
  contentStyle?: StyleProp<ViewStyle>;
  /** Passed to the ScrollView (refreshControl, onScroll, keyboardShouldPersistTaps, ...). */
  scrollViewProps?: Omit<ScrollViewProps, 'children' | 'contentContainerStyle' | 'style'>;
  scrollRef?: Ref<ScrollView>;
  testID?: string;
}

const DEFAULT_EDGES: readonly Edge[] = ['top', 'left', 'right'];

export function PageContainer({
  children,
  width = 'content',
  scroll = true,
  footer = true,
  padTop = true,
  edges = DEFAULT_EDGES,
  contentStyle,
  scrollViewProps,
  scrollRef,
  testID,
}: PageContainerProps) {
  const { gutter } = useLayout();
  const insets = useSafeAreaInsets();
  const maxWidth = maxWidthFor(width);

  const pad = {
    paddingTop: (edges.includes('top') ? insets.top : 0) + (padTop ? space.lg : 0),
    paddingLeft: (edges.includes('left') ? insets.left : 0) + gutter,
    paddingRight: (edges.includes('right') ? insets.right : 0) + gutter,
    paddingBottom: (edges.includes('bottom') ? insets.bottom : 0) + space.xxl,
  };
  // The main landmark on the web is the page's own column, so the footer (contentinfo) sits beside it,
  // not inside it.
  const main = Platform.OS === 'web' ? ({ role: 'main' } as const) : null;
  const column = (
    <View
      {...main}
      style={[
        styles.column,
        scroll ? styles.grow : styles.fill,
        // The cap is for the content; the gutters come on top, so the column lines up with the top bar.
        maxWidth !== null && { maxWidth: maxWidth + pad.paddingLeft + pad.paddingRight },
        pad,
        contentStyle,
      ]}
    >
      {children}
    </View>
  );

  if (!scroll) {
    return (
      <View style={styles.root} testID={testID}>
        {column}
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.root}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      testID={testID}
      {...scrollViewProps}
    >
      {column}
      {footer ? <SiteFooter /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { flexGrow: 1 },
  column: { width: '100%', alignSelf: 'center' },
  grow: { flexGrow: 1 },
  fill: { flex: 1 },
});
