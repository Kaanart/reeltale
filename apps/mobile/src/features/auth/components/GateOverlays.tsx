import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button, Text } from '../../../components/ui';
import { colors, space } from '../../../theme/tokens';
import { useAuth } from '../hooks';
import { signInErrorText, type ErrorText as ErrorTextValue } from '../validation';
import { ErrorText } from './ErrorText';

const CARD_MAX_WIDTH = 400;

// What covers the screens while the account is between gates: a spinner while it loads, and a retry
// screen when it couldn't be loaded (signed in, but offline or the database didn't answer).

export function LoadingOverlay() {
  const { t } = useTranslation();
  return (
    <View style={[StyleSheet.absoluteFill, styles.center, styles.veil]} accessibilityLabel={t('common:state.loading')} accessibilityRole="progressbar">
      <ActivityIndicator size="large" color={colors.ink} />
    </View>
  );
}

export function AccountErrorOverlay() {
  const { t } = useTranslation();
  const { actions } = useAuth();
  const [busy, setBusy] = useState<'retry' | 'signOut' | null>(null);
  const [error, setError] = useState<ErrorTextValue | null>(null);

  const run = async (which: 'retry' | 'signOut') => {
    setBusy(which);
    setError(null);
    try {
      await (which === 'retry' ? actions.reloadAccount() : actions.signOut());
    } catch (err) {
      setError(signInErrorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.center, styles.solid]} accessibilityViewIsModal>
      <View style={styles.card}>
        <Text variant="heading" accessibilityRole="header" align="center">
          {t('common:state.somethingWentWrong')}
        </Text>
        <Text variant="body" color="inkMuted" align="center" style={styles.body}>
          {t('auth:session.loadFailed')}
        </Text>
        <Button label={t('common:actions.retry')} onPress={() => void run('retry')} loading={busy === 'retry'} disabled={busy !== null} fullWidth />
        <View style={styles.gap} />
        <Button label={t('auth:signOut.confirm')} onPress={() => void run('signOut')} variant="secondary" loading={busy === 'signOut'} disabled={busy !== null} fullWidth />
        <ErrorText error={error} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  veil: { backgroundColor: colors.bg, opacity: 0.85 },
  solid: { backgroundColor: colors.bg },
  card: { width: '100%', maxWidth: CARD_MAX_WIDTH },
  body: { marginTop: space.sm, marginBottom: space.xl },
  gap: { height: space.md },
});
