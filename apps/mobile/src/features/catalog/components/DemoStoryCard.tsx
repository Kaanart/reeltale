import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AIBadge, Button, Text } from '../../../components/ui';
import { colors, radius, space } from '../../../theme/tokens';
import { headingLevel } from './a11y';
import { DecorativeIcon } from './DecorativeIcon';

const HERO_ICON = 28;

/**
 * Home's invitation to the AI story flow: pick what happens next in a short story made with AI. `hero` is the
 * panel beside the featured story on wider screens: it fills its height, with the button at the bottom.
 */
export function DemoStoryCard({ onStart, variant = 'card' }: { onStart: () => void; variant?: 'card' | 'hero' }) {
  const { t } = useTranslation();
  if (variant === 'hero') {
    return (
      <View style={[styles.card, styles.hero]} testID="home-demo-story">
        <View style={styles.heroTop}>
          <AIBadge size="md" />
          <DecorativeIcon name="git-branch-outline" size={HERO_ICON} color="ai" />
        </View>
        <View style={styles.heroText}>
          <Text variant="title" accessibilityRole="header" {...headingLevel(2)}>
            {t('home:home.demo.title')}
          </Text>
          <Text color="inkMuted">{t('home:home.demo.body')}</Text>
          <Text variant="bodySmall" color="inkMuted">
            {t('home:home.demo.detail')}
          </Text>
        </View>
        <Button label={t('home:home.demo.cta')} onPress={onStart} fullWidth />
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <AIBadge size="md" />
      <Text variant="heading" accessibilityRole="header" {...headingLevel(2)}>
        {t('home:home.demo.title')}
      </Text>
      <Text color="inkMuted">{t('home:home.demo.body')}</Text>
      <Button label={t('home:home.demo.cta')} onPress={onStart} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.sm,
    alignItems: 'flex-start',
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  hero: {
    flexGrow: 1,
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: space.lg,
    padding: space.xl,
    borderTopWidth: space.xs,
    borderTopColor: colors.ai,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroText: { gap: space.sm },
});
