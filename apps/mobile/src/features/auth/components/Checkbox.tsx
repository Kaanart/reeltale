import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../../components/ui';
import { colors, radius, space } from '../../../theme/tokens';

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Read by screen readers instead of the visible label, when that is too short to stand alone. */
  accessibilityLabel?: string;
}

const BOX = 24;

export function Checkbox({ label, checked, onChange, accessibilityLabel }: CheckboxProps) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked ? <Ionicons name="checkmark" size={BOX - 6} color={colors.surface} /> : null}
      </View>
      <Text variant="body" style={styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  pressed: { opacity: 0.7 },
  box: {
    width: BOX,
    height: BOX,
    marginRight: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: radius.chip / 2,
    backgroundColor: colors.surface,
  },
  boxChecked: { backgroundColor: colors.ink },
  label: { flexShrink: 1 },
});
