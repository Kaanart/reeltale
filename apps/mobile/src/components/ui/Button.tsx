import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { colors, fonts, radius, space, type ColorName } from '../../theme/tokens';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
  fullWidth?: boolean;
}

const MIN_TARGET = 44;
const HEIGHT: Record<ButtonSize, number> = { md: 48, sm: 36 };
// The tokens have no "on accent" colour, so white text reuses colors.surface.
const LABEL_COLOR: Record<ButtonVariant, ColorName> = {
  primary: 'surface',
  secondary: 'ink',
  ghost: 'accent',
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  accessibilityLabel,
  testID,
  fullWidth = false,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const labelColor = LABEL_COLOR[variant];
  // Extends the touch area of the small button to 44pt without changing how it looks.
  const slop = Math.max(0, (MIN_TARGET - HEIGHT[size]) / 2);

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      hitSlop={slop > 0 ? { top: slop, bottom: slop, left: slop, right: slop } : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        styles[variant],
        fullWidth && styles.fullWidth,
        pressed && !isDisabled && (variant === 'primary' ? styles.primaryPressed : styles.pressed),
        isDisabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors[labelColor]} style={styles.leading} />
      ) : icon ? (
        <View style={styles.leading}>{icon}</View>
      ) : null}
      <Text
        variant={size === 'sm' ? 'bodySmall' : 'body'}
        color={labelColor}
        numberOfLines={1}
        style={styles.label}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: MIN_TARGET,
    paddingHorizontal: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  md: { height: HEIGHT.md },
  sm: { height: HEIGHT.sm, paddingHorizontal: space.md },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surface, borderColor: colors.line },
  ghost: { backgroundColor: 'transparent' },
  fullWidth: { width: '100%' },
  primaryPressed: { backgroundColor: colors.accentPressed },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
  leading: { marginRight: space.sm },
  label: { fontFamily: fonts.sansBold, flexShrink: 1 },
});
