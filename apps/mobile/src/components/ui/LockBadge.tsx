import { StyleSheet, View } from 'react-native';

import { colors, space } from '../../theme/tokens';
import { Text } from './Text';

export interface LockBadgeProps {
  size?: 'sm' | 'md';
  label?: string;
}

export function LockBadge({ size = 'sm', label }: LockBadgeProps) {
  const small = size === 'sm';
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label ? `Locked, ${label}` : 'Locked'}
    >
      <View style={styles.padlock}>
        <View style={small ? styles.shackleSm : styles.shackleMd} />
        <View style={small ? styles.bodySm : styles.bodyMd} />
      </View>
      {label ? (
        <Text variant={small ? 'caption' : 'bodySmall'} color="inkMuted" style={styles.label}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  padlock: { alignItems: 'center' },
  // Shackle: a bordered box with rounded top corners and no bottom edge.
  shackleSm: {
    width: 8,
    height: 6,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderColor: colors.inkMuted,
  },
  shackleMd: {
    width: 11,
    height: 8,
    borderWidth: 2,
    borderBottomWidth: 0,
    borderTopLeftRadius: 5.5,
    borderTopRightRadius: 5.5,
    borderColor: colors.inkMuted,
  },
  bodySm: {
    width: 12,
    height: 9,
    borderRadius: 2,
    backgroundColor: colors.inkMuted,
  },
  bodyMd: {
    width: 16,
    height: 12,
    borderRadius: 3,
    backgroundColor: colors.inkMuted,
  },
  label: { marginLeft: space.xs + 2 },
});
