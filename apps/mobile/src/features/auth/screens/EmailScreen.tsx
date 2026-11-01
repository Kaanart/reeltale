import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '../../../components/ui';
import { space } from '../../../theme/tokens';
import { AuthScreen } from '../components/AuthScreen';
import { ErrorText } from '../components/ErrorText';
import { TextField } from '../components/TextField';
import { TextLink } from '../components/TextLink';
import { useAuth } from '../hooks';
import { useSubmit } from '../useSubmit';
import { isValidEmail } from '../validation';

// Email: one field; sends a 6-digit code. The address stays in memory (useAuth().pendingEmail), never in the URL.
export function EmailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { pendingEmail, actions } = useAuth();
  const [email, setEmail] = useState(pendingEmail ?? '');
  const [invalid, setInvalid] = useState(false);
  const { busy, error, run } = useSubmit<'send'>();

  const submit = async () => {
    if (!isValidEmail(email)) {
      setInvalid(true);
      return;
    }
    if (await run('send', () => actions.sendEmailCode(email))) router.push('/code');
  };

  return (
    <AuthScreen
      back
      title={t('auth:email.title')}
      hint={t('auth:email.hint')}
      footer={<TextLink label={t('auth:email.usePassword')} onPress={() => router.push('/password')} />}
    >
      <TextField
        label={t('auth:email.label')}
        placeholder={t('auth:email.placeholder')}
        value={email}
        onChangeText={(v) => { setEmail(v); setInvalid(false); }}
        error={invalid ? t('auth:email.invalid') : null}
        keyboardType="email-address"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={() => void submit()}
        autoFocus
        testID="email-input"
      />
      <View style={styles.submit}>
        <Button
          label={busy ? t('auth:email.sending') : t('auth:email.send')}
          onPress={() => void submit()}
          loading={busy === 'send'}
          fullWidth
          testID="email-send"
        />
      </View>
      <ErrorText error={error} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  submit: { marginTop: space.lg },
});
