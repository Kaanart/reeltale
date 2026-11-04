import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useLayout } from '../../../components/layout';
import { colors, layout, space } from '../../../theme/tokens';

// A full-width band of the landing page (its own background), with the content in the same centred column
// as the top bar and the footer (1200 + gutters). On the web it is a <section> named by its heading.

export interface BandProps {
  tone?: 'bg' | 'surface' | 'surfaceAlt';
  /** nativeID of the band's heading (aria-labelledby). */
  labelledBy?: string;
  /** Vertical padding: 'roomy' for the hero, 'normal' for the rest. */
  spacing?: 'roomy' | 'normal';
  children: ReactNode;
  innerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Band({ tone = 'bg', labelledBy, spacing = 'normal', children, innerStyle, testID }: BandProps) {
  const { gutter, isCompact } = useLayout();
  const pad = spacing === 'roomy' ? (isCompact ? space.xxl : space.xxxl + space.xl) : isCompact ? space.xxl : space.xxxl;
  return (
    <View
      role={labelledBy ? 'region' : undefined}
      aria-labelledby={labelledBy}
      style={[styles.band, { backgroundColor: colors[tone], paddingVertical: pad }]}
      testID={testID}
    >
      <View style={[styles.inner, { paddingHorizontal: gutter, maxWidth: layout.contentMaxWidth + 2 * gutter }, innerStyle]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: { width: '100%' },
  inner: { width: '100%', alignSelf: 'center' },
});
