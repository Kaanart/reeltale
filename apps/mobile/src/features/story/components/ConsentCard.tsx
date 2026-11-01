import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AIBadge, Button, Text } from '../../../components/ui';
import { describeError } from '../../../core/errors';
import { colors, radius, space } from '../../../theme/tokens';
import { ErrorText, TextLink } from '../../auth';
import { useGrantStoryConsent } from '../hooks';
import { AI_POLICY_URL } from '../logic';

// The AI consent step (Apple 5.1.2(i), GDPR): says who gets the reader's text (Meta's models, and Google's
// voice for narration), links the AI policy, and records the answer with set_ai_consent. Nothing is sent
// to a model before this. Withdrawing lives in Settings.
export function ConsentCard() {
  const { t } = useTranslation();
  const grant = useGrantStoryConsent();
  const error = grant.error ? describeError(grant.error) : null;

  const openPolicy = () => {
    void WebBrowser.openBrowserAsync(AI_POLICY_URL).catch(() => undefined);
  };

  return (
    <View style={styles.card} testID="story-consent">
      <View style={styles.badge}>
        <AIBadge size="sm" />
      </View>
      <Text variant="subheading" accessibilityRole="header">
        {t('create:consent.ai.title')}
      </Text>
      <Text variant="bodySmall" style={styles.body}>
        {t('create:consent.ai.body')}
      </Text>
      <View style={styles.link}>
        <TextLink label={t('create:consent.ai.policy')} onPress={openPolicy} role="link" testID="story-ai-policy" />
      </View>
      <Button
        label={t('create:consent.ai.accept')}
        onPress={() => grant.mutate()}
        loading={grant.isPending}
        fullWidth
        testID="story-consent-allow"
      />
      <Text variant="caption" color="inkMuted" style={styles.manage}>
        {t('create:consent.ai.manage')}
      </Text>
      <ErrorText error={error ? { key: error.key, params: error.params } : null} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.ai,
    backgroundColor: colors.surface,
  },
  badge: { marginBottom: space.sm },
  body: { marginTop: space.sm },
  link: { alignItems: 'flex-start', marginLeft: -space.sm, marginVertical: space.xs },
  manage: { marginTop: space.sm, textAlign: 'center' },
});
