import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type Ionicons from '@expo/vector-icons/Ionicons';

import { focusRing, useInteraction, useLayout } from '../../../../components/layout';
import { Text } from '../../../../components/ui';
import { colors, fonts, layout, radius, space } from '../../../../theme/tokens';
import { headingLevel } from '../a11y';
import { DecorativeIcon } from '../DecorativeIcon';

/**
 * A storefront section's title (a level-2 heading, serif) on a hairline, with an optional action at the right
 * end ("Switch", "See all").
 */
export function SectionHeader({ title, action, level = 2 }: { title: string; action?: ReactNode; level?: 2 | 3 }) {
  const { isCompact } = useLayout();
  return (
    <View style={styles.header}>
      <Text
        variant={isCompact || level === 3 ? 'heading' : 'title'}
        accessibilityRole="header"
        {...headingLevel(level)}
        style={styles.title}
      >
        {title}
      </Text>
      {action}
    </View>
  );
}

/** A text button for a section's header ("Switch"): an icon and a word, with hover and the focus ring. */
export function HeaderButton({
  label, accessibilityLabel, icon, onPress,
}: { label: string; accessibilityLabel: string; icon: ComponentProps<typeof Ionicons>['name']; onPress: () => void }) {
  const { hovered, focusVisible, handlers } = useInteraction();
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.button, (hovered || pressed) && styles.buttonHover, focusVisible && focusRing]}
    >
      <DecorativeIcon name={icon} size={ICON} color="accentStrong" />
      <Text variant="bodySmall" color="accentStrong" style={styles.buttonLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

const ICON = 16;

/** Vertical space between the storefront's sections. */
export function useSectionGap(): number {
  const { isCompact } = useLayout();
  return isCompact ? space.xxl : space.xxxl;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: layout.minTarget,
    paddingBottom: space.sm,
    marginBottom: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  title: { flex: 1 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: layout.minTarget,
    paddingHorizontal: space.sm,
    // The label lines up with the page edge; the hover background reaches past it.
    marginRight: -space.sm,
    borderRadius: radius.chip,
  },
  buttonHover: { backgroundColor: colors.surfaceAlt },
  buttonLabel: { fontFamily: fonts.sansMedium },
});
