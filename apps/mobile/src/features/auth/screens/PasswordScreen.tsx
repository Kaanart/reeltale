import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';

import { Button } from '../../../components/ui';
import { colors, space } from '../../../theme/tokens';
import { AuthScreen } from '../components/AuthScreen';
import { ErrorText } from '../components/ErrorText';
import { TextField } from '../components/TextField';
import { TextLink } from '../components/TextLink';
import { useAuth } from '../hooks';
import { useSubmit } from '../useSubmit';
import { isValidEmail } from '../validation';

const TOGGLE_SIZE = 44;

// Password sign-in: only for the demo, judge and App Review accounts (reached from the small link on the
// email screen). Everyone else signs in with the email code.
export function PasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { pendingEmail, actions } = useAuth();
  const [email, setEmail] = useState(pendingEmail ?? '');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const { busy, error, run } = useSubmit<'signIn'>();

  const submit = async () => {
    if (!isValidEmail(email)) {
      setInvalid(true);
      return;
    }
    await run('signIn', () => actions.signInWithPassword(email, password));
  };

  return (
    <AuthScreen
      back
      title={t('auth:password.title')}
      hint={t('auth:password.hint')}
      footer={<TextLink label={t('auth:password.useCode')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/email'))} />}
    >
      <TextField
        label={t('auth:password.emailLabel')}
        placeholder={t('auth:email.placeholder')}
        value={email}
        onChangeText={(v) => { setEmail(v); setInvalid(false); }}
        error={invalid ? t('auth:email.invalid') : null}
        keyboardType="email-address"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        testID="password-email"
      />
      <View style={styles.passwordRow}>
        <TextField
          ref={passwordRef}
          label={t('auth:password.passwordLabel')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          style={styles.passwordField}
          testID="password-input"
        />
        <Pressable
          onPress={() => setVisible((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={visible ? t('auth:password.hide') : t('auth:password.show')}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
        >
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={space.xl} color={colors.ink} />
        </Pressable>
      </View>
      <View style={styles.submit}>
        <Button
          label={t('auth:password.submit')}
          onPress={() => void submit()}
          loading={busy === 'signIn'}
          disabled={password.length === 0}
          fullWidth
          testID="password-submit"
        />
      </View>
      <ErrorText error={error} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  passwordRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: space.lg },
  passwordField: { flex: 1 },
  toggle: {
    width: TOGGLE_SIZE,
    height: TOGGLE_SIZE + space.xs,
    marginLeft: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  submit: { marginTop: space.xl },
});
