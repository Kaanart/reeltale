import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

import { colors, type ColorName } from '../../../theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** An icon that only decorates a control which already has its own label: hidden from screen readers (the web would read the glyph). */
export function DecorativeIcon({ name, size = 24, color = 'ink' }: { name: IconName; size?: number; color?: ColorName }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      <Ionicons name={name} size={size} color={colors[color]} />
    </View>
  );
}
