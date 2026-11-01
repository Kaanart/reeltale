import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '../../../components/ui';
import { openLegal } from '../../../lib/links';
import { space } from '../../../theme/tokens';
import { AuthScreen } from '../components/AuthScreen';
import { Checkbox } from '../components/Checkbox';
import { ErrorText } from '../components/ErrorText';
import { TextLink } from '../components/TextLink';
import { useAuth } from '../hooks';
import { useSubmit } from '../useSubmit';

// Once after sign-in (and again when the Terms version changes): the Terms, the plain statement that
// comments, bios, handles and uploads are checked by AI from Meta (App Store 5.1.2(i)), and an explicit
// tick before accept_terms is called.
export function TermsScreen() {
  const { t } = useTranslation();
  const { actions } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const { busy, error, run } = useSubmit<'accept' | 'signOut'>();

  return (
    <AuthScreen
      title={t('auth:terms.title')}
      hint={t('auth:terms.body')}
      footer={<TextLink label={t('auth:signOut.confirm')} onPress={() => void run('signOut', actions.signOut)} disabled={busy !== null} />}
    >
      <View style={styles.links}>
        <TextLink label={t('auth:terms.agreeLink')} role="link" onPress={() => void openLegal('terms')} />
        <TextLink label={t('auth:welcome.privacy')} role="link" onPress={() => void openLegal('privacy')} />
      </View>
      <View style={styles.agree}>
        <Checkbox label={t('auth:terms.agree')} accessibilityLabel={t('auth:terms.a11yAgree')} checked={agreed} onChange={setAgreed} />
      </View>
      <Button
        label={t('auth:terms.continue')}
        onPress={() => void run('accept', actions.acceptTerms)}
        disabled={!agreed || busy !== null}
        loading={busy === 'accept'}
        fullWidth
        testID="terms-accept"
      />
      <ErrorText error={error} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  links: { flexDirection: 'row', gap: space.md, marginLeft: -space.sm },
  agree: { marginTop: space.lg, marginBottom: space.xl },
});
