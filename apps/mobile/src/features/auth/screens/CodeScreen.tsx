import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button, Text } from '../../../components/ui';
import { space } from '../../../theme/tokens';
import { AuthScreen } from '../components/AuthScreen';
import { CodeInput } from '../components/CodeInput';
import { ErrorText } from '../components/ErrorText';
import { TextLink } from '../components/TextLink';
import { useAuth } from '../hooks';
import { useSubmit } from '../useSubmit';
import { isCompleteCode, RESEND_SECONDS } from '../validation';

// Code: six boxes, checked as soon as the sixth digit is in; a new code after RESEND_SECONDS.
// On success the gate moves on by itself (birthday, Terms or the app).
export function CodeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { pendingEmail, isDemo, actions } = useAuth();
  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const [resent, setResent] = useState(false);
  const { busy, error, setError, run } = useSubmit<'verify' | 'resend'>();

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  // Reloaded on the web, or opened directly: there is no address to check against.
  if (!pendingEmail) return <Redirect href="/email" />;

  const verify = async (value: string) => {
    if (!isCompleteCode(value)) {
      setError({ key: 'auth:code.incomplete', params: {} });
      return;
    }
    setResent(false);
    if (!(await run('verify', () => actions.verifyEmailCode(value)))) setCode('');
  };

  const resend = async () => {
    setResent(false);
    if (await run('resend', () => actions.sendEmailCode(pendingEmail))) {
      setSecondsLeft(RESEND_SECONDS);
      setCode('');
      setResent(true);
    }
  };

  return (
    <AuthScreen back title={t('auth:code.title')} hint={t('auth:code.hint', { email: pendingEmail })}>
      <CodeInput
        value={code}
        onChange={(v) => { setCode(v); setError(null); }}
        onComplete={(v) => void verify(v)}
        label={t('auth:code.label')}
        invalid={!!error}
      />
      {isDemo ? (
        <Text variant="caption" color="inkMuted" style={styles.note}>
          {t('auth:demo.codeHint')}
        </Text>
      ) : null}
      <View style={styles.submit}>
        <Button
          label={busy === 'verify' ? t('auth:code.verifying') : t('auth:code.verify')}
          onPress={() => void verify(code)}
          loading={busy === 'verify'}
          disabled={busy !== null}
          fullWidth
          testID="code-verify"
        />
      </View>
      <ErrorText error={error} />
      {resent ? (
        <Text variant="bodySmall" accessibilityLiveRegion="polite" style={styles.note}>
          {t('auth:code.resent')}
        </Text>
      ) : null}
      <View style={styles.links}>
        {secondsLeft > 0 ? (
          <Text variant="caption" color="inkMuted" style={styles.countdown}>
            {t('auth:code.resendIn', { seconds: secondsLeft })}
          </Text>
        ) : (
          <TextLink label={t('auth:code.resend')} onPress={() => void resend()} disabled={busy !== null} />
        )}
        <TextLink label={t('auth:code.wrongEmail')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/email'))} />
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  note: { marginTop: space.md },
  submit: { marginTop: space.xl },
  links: { marginTop: space.lg, alignItems: 'center' },
  countdown: { paddingVertical: space.md },
});
