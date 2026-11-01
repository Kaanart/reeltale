import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button, Text } from '../../../components/ui';
import { colors, radius, space } from '../../../theme/tokens';
import { AppleSignInButton } from '../components/AppleSignInButton';
import { AuthScreen } from '../components/AuthScreen';
import { ErrorText } from '../components/ErrorText';
import { LegalLinks } from '../components/LegalLinks';
import { useAuth } from '../hooks';
import { useSubmit } from '../useSubmit';

const ICON_SIZE = 20;

// Welcome: app name, tagline, 18+ notice, the sign-in choices, Terms and Privacy.
// Apple shows where it is available (iOS, web), Google on the web; email everywhere.
export function WelcomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isDemo, options, actions } = useAuth();
  const { busy, error, run } = useSubmit<'apple' | 'google'>();

  return (
    <AuthScreen footer={<LegalLinks />}>
      <View style={styles.hero}>
        <Text variant="display" accessibilityRole="header" align="center">
          {t('common:appName')}
        </Text>
        <Text variant="subheading" color="inkMuted" align="center" style={styles.tagline}>
          {t('auth:welcome.tagline')}
        </Text>
        <View style={styles.adults}>
          <Text variant="caption" color="inkMuted">
            {t('auth:welcome.adultsOnly')}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        {isDemo ? (
          <View style={styles.demo}>
            <Button label={t('auth:demo.enter')} onPress={actions.enterDemo} fullWidth testID="demo-enter" />
            <Text variant="caption" color="inkMuted" align="center" style={styles.demoHint}>
              {t('auth:demo.hint')}
            </Text>
          </View>
        ) : null}
        {options.apple ? (
          <AppleSignInButton onPress={() => void run('apple', actions.signInWithApple)} busy={busy === 'apple'} />
        ) : null}
        {options.google ? (
          <Button
            label={t('auth:welcome.google')}
            onPress={() => void run('google', actions.signInWithGoogle)}
            variant="secondary"
            loading={busy === 'google'}
            fullWidth
            icon={<Ionicons name="logo-google" size={ICON_SIZE} color={colors.ink} />}
          />
        ) : null}
        <Button
          label={t('auth:welcome.email')}
          onPress={() => router.push('/email')}
          variant={isDemo ? 'secondary' : 'primary'}
          fullWidth
          icon={<Ionicons name="mail-outline" size={ICON_SIZE} color={isDemo ? colors.ink : colors.surface} />}
          testID="welcome-email"
        />
        <ErrorText error={error} />
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  hero: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space.xxl },
  tagline: { marginTop: space.sm },
  adults: {
    marginTop: space.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  actions: { gap: space.md },
  demo: { marginBottom: space.sm },
  demoHint: { marginTop: space.sm },
});
