import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AIBadge, Button, Text } from '../../../components/ui';
import { describeError } from '../../../core/errors';
import { colors, radius, space } from '../../../theme/tokens';
import { ErrorText, TextLink } from '../../auth';
import { AI_POLICY_URL } from '../logic';
import { useGrantVoiceConsent } from '../voiceHooks';

// The voice consent step, shown the first time the reader presses "Say your choice" (and again if the Worker says
// the consent is gone, e.g. withdrawn in Settings). It says who hears the recording (an AI model from Meta), that
// only what is recorded after pressing the microphone is sent, and that it isn't stored; then records the answer
// with set_ai_consent('voice', ['meta'], <version>, true). Nothing is recorded or sent before this.

export interface VoiceConsentCardProps {
  /** Allowed: the reader presses the microphone again to speak (a fresh press starts the audio in every browser). */
  onAllowed: () => void;
  onDecline: () => void;
}

export function VoiceConsentCard({ onAllowed, onDecline }: VoiceConsentCardProps) {
  const { t } = useTranslation();
  const grant = useGrantVoiceConsent();
  const error = grant.error ? describeError(grant.error) : null;

  const openPolicy = () => {
    void WebBrowser.openBrowserAsync(AI_POLICY_URL).catch(() => undefined);
  };

  return (
    <View style={styles.card} testID="story-voice-consent">
      <View style={styles.badge}>
        <AIBadge size="sm" />
      </View>
      <Text variant="subheading" accessibilityRole="header">
        {t('create:consent.voice.title')}
      </Text>
      <Text variant="bodySmall" style={styles.body}>
        {t('create:consent.voice.body')}
      </Text>
      <Text variant="bodySmall" color="inkMuted" style={styles.body}>
        {t('create:consent.voice.detail')}
      </Text>
      <View style={styles.link}>
        <TextLink label={t('create:consent.ai.policy')} onPress={openPolicy} role="link" testID="story-voice-policy" />
      </View>
      <View style={styles.actions}>
        <Button
          label={t('create:consent.voice.accept')}
          onPress={() => grant.mutate(undefined, { onSuccess: onAllowed })}
          loading={grant.isPending}
          size="sm"
          testID="story-voice-consent-allow"
        />
        <Button
          label={t('create:consent.voice.decline')}
          onPress={onDecline}
          variant="secondary"
          size="sm"
          disabled={grant.isPending}
          testID="story-voice-consent-decline"
        />
      </View>
      <Text variant="caption" color="inkMuted" style={styles.manage}>
        {t('create:consent.voice.manage')}
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
  badge: { alignItems: 'flex-start', marginBottom: space.sm },
  body: { marginTop: space.sm },
  link: { alignItems: 'flex-start', marginLeft: -space.sm, marginVertical: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  manage: { marginTop: space.sm },
});
