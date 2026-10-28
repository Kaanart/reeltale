import { Pressable, StyleSheet, View } from 'react-native';

import { colors, fonts, radius, space } from '../../theme/tokens';
import { Text } from './Text';

// Mandatory EU AI Act transparency label. Deliberately has no `visible` or `style` prop:
// callers position it by wrapping it, and cannot hide it.
export interface AIBadgeProps {
  size?: 'sm' | 'md';
  /** Opens the explanation of what AI-generated means. */
  onPress?: () => void;
  testID?: string;
}

const A11Y_LABEL = 'AI-generated content';
// The sm pill is about 22pt tall; this brings the touch area close to 44pt.
const HIT_SLOP = { top: 11, bottom: 11, left: 8, right: 8 } as const;

function BadgeContent({ size }: { size: 'sm' | 'md' }) {
  const small = size === 'sm';
  return (
    <>
      <View style={[styles.glyph, small ? styles.glyphSm : styles.glyphMd]}>
        <Text
          variant="caption"
          color="ai"
          allowFontScaling={false}
          style={[styles.glyphText, small ? styles.glyphTextSm : styles.glyphTextMd]}
        >
          AI
        </Text>
      </View>
      <Text variant={small ? 'caption' : 'bodySmall'} color="surface" style={styles.label}>
        AI-generated
      </Text>
    </>
  );
}

export function AIBadge({ size = 'sm', onPress, testID }: AIBadgeProps) {
  const pillStyle = [styles.pill, size === 'sm' ? styles.pillSm : styles.pillMd];

  if (!onPress) {
    return (
      <View style={pillStyle} accessible accessibilityRole="text" accessibilityLabel={A11Y_LABEL} testID={testID}>
        <BadgeContent size={size} />
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={A11Y_LABEL}
      accessibilityHint="Opens an explanation"
      testID={testID}
      style={({ pressed }) => [pillStyle, pressed && styles.pressed]}
    >
      <BadgeContent size={size} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.ai,
    borderRadius: radius.pill,
  },
  pillSm: { paddingVertical: 2, paddingLeft: 3, paddingRight: space.sm },
  pillMd: { paddingVertical: space.xs, paddingLeft: space.xs, paddingRight: space.md },
  pressed: { opacity: 0.8 },
  glyph: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.xs,
    backgroundColor: colors.surface,
    borderRadius: 4,
  },
  glyphSm: { width: 16, height: 16 },
  glyphMd: { width: 20, height: 20 },
  glyphText: { fontFamily: fonts.sansBold, includeFontPadding: false },
  glyphTextSm: { fontSize: 9, lineHeight: 11 },
  glyphTextMd: { fontSize: 11, lineHeight: 13 },
  label: { fontFamily: fonts.sansMedium },
});
