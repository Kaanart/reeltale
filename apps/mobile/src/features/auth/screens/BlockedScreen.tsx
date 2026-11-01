import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button, Text } from '../../../components/ui';
import { openLegal } from '../../../lib/links';
import { space } from '../../../theme/tokens';
import { AuthScreen } from '../components/AuthScreen';
import { ErrorText } from '../components/ErrorText';
import { TextLink } from '../components/TextLink';
import { useAuth } from '../hooks';
import { useSubmit } from '../useSubmit';

// Under 18 (or reported so): a calm explanation, how deletion works, and sign-out. No retry: the server
// has already blocked the account and queued it for deletion.
export function BlockedScreen() {
  const { t } = useTranslation();
  const { actions } = useAuth();
  const { busy, error, run } = useSubmit<'signOut'>();

  return (
    <AuthScreen title={t('age:blocked.title')} hint={t('age:blocked.body')}>
      <View style={styles.link}>
        <TextLink label={t('age:blocked.dataLink')} role="link" onPress={() => void openLegal('privacy')} />
      </View>
      <Text variant="bodySmall" color="inkMuted" style={styles.note}>
        {t('age:adultsOnlyLong')}
      </Text>
      <Button
        label={t('age:blocked.signOut')}
        onPress={() => void run('signOut', actions.signOut)}
        loading={busy === 'signOut'}
        variant="secondary"
        fullWidth
        testID="blocked-sign-out"
      />
      <ErrorText error={error} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  link: { alignItems: 'flex-start', marginLeft: -space.sm },
  note: { marginTop: space.lg, marginBottom: space.xl },
});
