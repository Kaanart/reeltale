import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { Text } from '../../../components/ui';
import { colors, fonts, radius, space } from '../../../theme/tokens';

export interface DangerButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}

const HEIGHT = 48;
const BORDER = 2;
const ICON = 20;

// The button for something that can't be undone. The UI kit has no danger variant, and white on the danger
// red is just under AA at this size, so the label stays ink and the red is the border and the icon.
export function DangerButton({ label, onPress, disabled = false, loading = false, testID }: DangerButtonProps) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy: loading }}
      testID={testID}
      style={({ pressed }) => [styles.button, pressed && !off && styles.pressed, off && styles.disabled]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.danger} style={styles.icon} />
      ) : (
        <Ionicons name="trash-outline" size={ICON} color={colors.danger} style={styles.icon} />
      )}
      <Text variant="body" numberOfLines={1} style={styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: HEIGHT,
    paddingHorizontal: space.lg,
    borderRadius: radius.card,
    borderWidth: BORDER,
    borderColor: colors.danger,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
  icon: { marginRight: space.sm },
  label: { fontFamily: fonts.sansBold, flexShrink: 1 },
});
