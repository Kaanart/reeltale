import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { focusRing, useInteraction } from '../../../components/layout';
import { Text } from '../../../components/ui';
import type { TypeVariant } from '../../../theme/tokens';
import { colors, fonts, layout, radius, space } from '../../../theme/tokens';

// The head of a story page on a laptop-sized browser window, where the site's top bar replaces the app's own
// header bar (ScreenHeader, used on phones and in the apps): a "Back" link, the page title as a heading, and room
// on the right for the AI label and actions.

export interface PageHeadProps {
  title: string;
  onBack?: () => void;
  /** Beside the title: the AI label, "How this scene was made". */
  right?: ReactNode;
  /** 'title' for a page's own heading; 'subheading' above a bigger heading (the player's scene title). */
  variant?: Extract<TypeVariant, 'title' | 'heading' | 'subheading'>;
  children?: ReactNode;
}

const ICON = 18;

export function PageHead({ title, onBack, right, variant = 'title', children }: PageHeadProps) {
  return (
    <View style={styles.root}>
      {onBack ? <BackLink onPress={onBack} /> : null}
      <View style={styles.row}>
        <Text variant={variant} accessibilityRole="header" numberOfLines={3} style={styles.title}>
          {title}
        </Text>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
      {children}
    </View>
  );
}

function BackLink({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const { hovered, focusVisible, handlers } = useInteraction();
  const label = t('common:actions.back');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...handlers}
      style={({ pressed }) => [styles.back, (hovered || pressed) && styles.backHover, focusVisible && focusRing]}
      testID="story-back"
    >
      <Ionicons name="chevron-back" size={ICON} color={colors.ink} />
      <Text variant="bodySmall" style={styles.backText}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  title: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: layout.sidePanelWidth / 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    minHeight: layout.minTarget,
    paddingRight: space.md,
    paddingLeft: space.xs,
    marginLeft: -space.xs,
    borderRadius: radius.pill,
  },
  backHover: { backgroundColor: colors.surfaceAlt },
  backText: { fontFamily: fonts.sansMedium },
});
