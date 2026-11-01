import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { colors, radius } from '../../../theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface IconButtonProps {
  icon: IconName;
  /** What the button does ("Mute"), or what it switches for a toggle ("Captions"). */
  label: string;
  onPress: () => void;
  /** A toggle (captions): announced as a switch with its state. */
  checked?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
}

const SIZE = 44;
const ICON_SIZE = 24;

// A round, 44 pt control for the player's overlay: white icon on the scrim, readable over any frame.
export function IconButton({ icon, label, onPress, checked, disabled = false, accessibilityHint, testID }: IconButtonProps) {
  const toggle = checked !== undefined;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={toggle ? 'switch' : 'button'}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={toggle ? { checked, disabled } : { disabled }}
      testID={testID}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Ionicons name={icon} size={ICON_SIZE} color={colors.surface} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.scrim,
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
});
