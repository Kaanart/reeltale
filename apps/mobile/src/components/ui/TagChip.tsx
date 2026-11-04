import { Pressable, StyleSheet, View } from 'react-native';

import { colors, fonts, radius, space } from '../../theme/tokens';
import { Text } from './Text';

export interface TagChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}

// The chip itself is about 24pt tall; this brings the touch area to 44pt.
const HIT_SLOP = { top: 10, bottom: 10, left: 4, right: 4 } as const;

export function TagChip({ label, selected = false, onPress }: TagChipProps) {
  const text = (
    <Text variant="caption" color={selected ? 'onAccent' : 'inkMuted'} numberOfLines={1} style={styles.label}>
      {label}
    </Text>
  );

  if (!onPress) {
    return <View style={[styles.chip, selected ? styles.selected : styles.unselected]}>{text}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.chip, selected ? styles.selected : styles.unselected, pressed && styles.pressed]}
    >
      {text}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.chip,
  },
  // White caption text on it: accentStrong (5.5:1), not the brand accent (3.6:1).
  selected: { backgroundColor: colors.accentStrong },
  unselected: { backgroundColor: colors.surfaceAlt },
  pressed: { opacity: 0.7 },
  label: { fontFamily: fonts.sansMedium },
});
