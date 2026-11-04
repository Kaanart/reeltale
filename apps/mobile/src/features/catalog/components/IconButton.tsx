import type { ComponentProps } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import type Ionicons from '@expo/vector-icons/Ionicons';

import { focusRing, useInteraction } from '../../../components/layout';
import { colors, layout, radius } from '../../../theme/tokens';
import { DecorativeIcon } from './DecorativeIcon';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** A 44 pt round icon button with a label for screen readers, a hover background and the keyboard focus ring. */
export function IconButton({ icon, size = 24, label, onPress }: { icon: IconName; size?: number; label: string; onPress: () => void }) {
  const { hovered, focusVisible, handlers } = useInteraction();
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.button, (hovered || pressed) && styles.hover, focusVisible && focusRing]}
    >
      <DecorativeIcon name={icon} size={size} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: layout.minTarget,
    height: layout.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  hover: { backgroundColor: colors.surfaceAlt },
});
