import { Image, type ImageSource } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { demoCover } from '../../../demo';
import { isDemo, MEDIA_ORIGIN } from '../../../lib/env';
import { colors, radius } from '../../../theme/tokens';
import { mediaUrl, type SeriesCard } from '../logic';
import { Text } from '../../../components/ui';

/** Series covers are portrait, 3 wide to 4 tall (the same as the demo pictures). */
export const COVER_RATIO = 3 / 4;

export interface CoverProps {
  series: Pick<SeriesCard, 'slug' | 'cover_key' | 'title'>;
  width: DimensionValue;
  style?: StyleProp<ViewStyle>;
  /** Overlays (labels), positioned by the caller. */
  children?: ReactNode;
}

function sourceOf(series: CoverProps['series']): ImageSource | number | null {
  if (isDemo) return (demoCover(series.slug) as ImageSource | number | null) ?? null;
  const uri = mediaUrl(series.cover_key, MEDIA_ORIGIN);
  return uri ? { uri } : null;
}

/**
 * A series cover: the picture when there is one, else a quiet tile with the title's first letter. Decorative:
 * the title next to it is what screen readers get.
 */
export function Cover({ series, width, style, children }: CoverProps) {
  const source = sourceOf(series);
  const initial = Array.from(series.title.trim())[0]?.toUpperCase() ?? '';
  return (
    <View style={[styles.frame, { width }, style]}>
      {source ? (
        <Image
          source={source}
          alt=""
          accessible={false}
          contentFit="cover"
          transition={150}
          recyclingKey={series.slug}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={styles.placeholder} accessible={false}>
          <Text variant="display" color="inkMuted" accessible={false}>
            {initial}
          </Text>
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    aspectRatio: COVER_RATIO,
    overflow: 'hidden',
    borderRadius: radius.card,
    backgroundColor: colors.surfaceAlt,
  },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
