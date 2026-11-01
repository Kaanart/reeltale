import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../../components/ui';
import { colors, space } from '../../../theme/tokens';

// The bar at the top of the story screens: back, a one-line title, and room on the right (the AI label).
export interface ScreenHeaderProps {
  title?: string;
  onBack?: () => void;
  right?: ReactNode;
}

const TARGET = 44;

export function ScreenHeader({ title, onBack, right }: ScreenHeaderProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.bar}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('common:actions.back')}
          style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
          testID="story-back"
        >
          <Ionicons name="chevron-back" size={space.xl} color={colors.ink} />
        </Pressable>
      ) : null}
      <Text variant="subheading" numberOfLines={1} accessibilityRole="header" style={styles.title}>
        {title ?? ''}
      </Text>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TARGET + space.sm,
    paddingHorizontal: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    backgroundColor: colors.bg,
  },
  icon: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  title: { flex: 1, marginHorizontal: space.sm },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
