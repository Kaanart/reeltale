import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AIBadge, Button, Text } from '../../../components/ui';
import { colors, radius, space } from '../../../theme/tokens';

/** Home's invitation to the AI story flow: pick what happens next in a short story made with AI. */
export function DemoStoryCard({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.card}>
      <AIBadge size="md" />
      <Text variant="heading" accessibilityRole="header">
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
});
