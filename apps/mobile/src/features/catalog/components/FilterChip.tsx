import type { Ref } from 'react';
import { Platform, Pressable, StyleSheet, type View } from 'react-native';

import { focusRing, useInteraction } from '../../../components/layout';
import { Text } from '../../../components/ui';
import { colors, fonts, layout, radius, space } from '../../../theme/tokens';
import { DecorativeIcon } from './DecorativeIcon';

const CHECK_ICON = 14;
const CHIP_HEIGHT = 36;
// The chip is 36 tall; this brings the touch area to 44.
const HIT_SLOP = { top: (layout.minTarget - CHIP_HEIGHT) / 2, bottom: (layout.minTarget - CHIP_HEIGHT) / 2 } as const;

export interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** 'checkbox': one of several filters that combine; 'radio': one choice out of a group (rankings). */
  kind: 'checkbox' | 'radio';
  /** To move the keyboard focus here (Discover, after Clear filters). */
  ref?: Ref<View>;
}

/**
 * A filter on Discover's side panel. Screen readers hear a checkbox or radio button with its state; a
 * selected chip also shows a tick, so the state never rests on colour alone. Enter and Space both toggle it
 * (react-native-web only maps Space for buttons). Hover and keyboard focus are visible.
 */
export function FilterChip({ label, selected, onPress, kind, ref }: FilterChipProps) {
  const { hovered, focusVisible, handlers } = useInteraction();
  const spaceKey = Platform.OS === 'web'
    ? ({
      onKeyDown: (e: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
        const key = e.nativeEvent?.key ?? e.key;
        if (key === ' ' || key === 'Spacebar') {
          e.preventDefault?.();
          onPress();
        }
      },
    } as object)
    : null;
  return (
    <Pressable
      ref={ref}
      {...handlers}
      {...spaceKey}
      onPress={onPress}
      hitSlop={HIT_SLOP}
      accessibilityRole={kind}
      accessibilityLabel={label}
      // aria-* rather than accessibilityState: react-native-web only renders aria-checked from this prop.
      aria-checked={selected}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.selected : styles.idle,
        hovered && !selected && styles.idleHover,
        hovered && selected && styles.selectedHover,
        pressed && styles.pressed,
        focusVisible && focusRing,
      ]}
    >
      {selected ? <DecorativeIcon name="checkmark" size={CHECK_ICON} color="onAccent" /> : null}
      <Text variant="bodySmall" color={selected ? 'onAccent' : 'ink'} numberOfLines={1} style={styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: CHIP_HEIGHT,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  idle: { backgroundColor: colors.surface, borderColor: colors.line },
  idleHover: { backgroundColor: colors.surfaceAlt, borderColor: colors.inkMuted },
  // White text on accentStrong is 5.5:1 (src/core/__tests__/contrast.test.ts).
  selected: { backgroundColor: colors.accentStrong, borderColor: colors.accentStrong },
  selectedHover: { backgroundColor: colors.accentStrongPressed, borderColor: colors.accentStrongPressed },
  pressed: { opacity: 0.8 },
  label: { fontFamily: fonts.sansMedium },
});
