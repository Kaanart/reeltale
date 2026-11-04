import type { ReactNode, Ref } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { maxWidthFor, useLayout, type ContentWidth } from '../../../components/layout';
import { colors, space } from '../../../theme/tokens';
import { PublicPageEnd } from './PublicLinks';

// A public web page (/about, /notice): PageContainer's centred column and gutters, but it ends with
// PublicPageEnd instead of only the site footer, so visitors on a phone-sized window (no footer, no Settings
// screen) still get the legal links and the notice form. The column is the page's `main` landmark.

export interface PublicPageProps {
  children: ReactNode;
  /** The column's widest: 'reading' 760 (default), 'content' 1200, 'narrow' 560. */
  width?: Exclude<ContentWidth, 'full'>;
  contentStyle?: StyleProp<ViewStyle>;
  scrollRef?: Ref<ScrollView>;
  testID?: string;
}

export function PublicPage({ children, width = 'reading', contentStyle, scrollRef, testID }: PublicPageProps) {
  const { gutter, isCompact } = useLayout();
  const cap = maxWidthFor(width) ?? 0;
  return (
    <ScrollView ref={scrollRef} style={styles.root} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" testID={testID}>
      <View
        role="main"
        style={[
          styles.column,
          {
            maxWidth: cap + 2 * gutter,
            paddingHorizontal: gutter,
            paddingTop: isCompact ? space.xl : space.xxxl,
            paddingBottom: isCompact ? space.xl : space.xxxl,
          },
          contentStyle,
        ]}
      >
        {children}
      </View>
      <PublicPageEnd />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1 },
  column: { width: '100%', alignSelf: 'center', flexGrow: 1 },
});
