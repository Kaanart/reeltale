import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { focusRing, useInteraction } from '../../../components/layout';
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
  /**
   * 'overlay' (default): white icon on the scrim, over the video. 'paper': ink icon on a white disc, for the
   * page around the player on a wide window.
   */
  tone?: 'overlay' | 'paper';
  testID?: string;
}

const SIZE = 44;
const ICON_SIZE = 24;
/** The keyboard focus ring over the dark video: white instead of ink. */
const RING_ON_VIDEO: ViewStyle = { ...focusRing, outlineColor: colors.surface };

// A round, 44 pt control. Over the player it is a white icon on the scrim, readable over any frame. On the
// web it shows a focus ring when reached by keyboard, and darkens under the mouse.
export function IconButton({
  icon, label, onPress, checked, disabled = false, accessibilityHint, tone = 'overlay', testID,
}: IconButtonProps) {
  const toggle = checked !== undefined;
  const paper = tone === 'paper';
  const { hovered, focusVisible, handlers } = useInteraction();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={toggle ? 'switch' : 'button'}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={toggle ? { checked, disabled } : { disabled }}
      testID={testID}
      {...handlers}
      style={({ pressed }) => [
        styles.button,
        paper ? styles.paper : styles.overlay,
        hovered && !disabled && (paper ? styles.paperHover : styles.overlayHover),
        pressed && styles.pressed,
        disabled && styles.disabled,
        focusVisible && (paper ? focusRing : RING_ON_VIDEO),
      ]}
    >
      <Ionicons name={icon} size={ICON_SIZE} color={paper ? colors.ink : colors.surface} />
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
  },
  overlay: { backgroundColor: colors.scrim },
  overlayHover: { backgroundColor: colors.ink },
  paper: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  paperHover: { backgroundColor: colors.surfaceAlt },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
});
