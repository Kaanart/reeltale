import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button, Text } from '../../../components/ui';
import { space } from '../../../theme/tokens';
import { ErrorText, TextField, useAuth } from '../../auth';
import { DangerButton } from '../components/DangerButton';
import { Notice } from '../components/Notice';
import { Section } from '../components/Section';
import { ScreenFrame } from '../components/ScreenFrame';
import { useRequestAccountDeletion, useSubscriptions } from '../hooks';
import { openStoreSubscriptions } from '../links';
import { isDeleteConfirmed } from '../logic/deletion';
import { errorText, type ErrorTextValue } from '../logic/errors';
import { deletionNotice } from '../logic/subscription';

type Phase = 'review' | 'confirm' | 'signOutFailed';

const FAILED: ErrorTextValue = { key: 'settings:delete.failed', params: {} };

// Delete account, in two steps: first what goes and what stays by law (and that only the store can cancel a
// subscription: always said, naming the store when a renewing one is known), then the typed word. The
// deletion starts with public.request_account_deletion and the person is signed out at once.
export function DeleteAccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { actions } = useAuth();
  const subscriptions = useSubscriptions();
  const deletion = useRequestAccountDeletion();
  const [phase, setPhase] = useState<Phase>('review');
  const [typed, setTyped] = useState('');
  const [signOutError, setSignOutError] = useState<ErrorTextValue | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const word = t('settings:delete.confirmWord');
  const confirmed = isDeleteConfirmed(typed, word);
  // Shown whatever the lookup says (still loading, failed, or nothing found): only a known one is named.
  const notice = deletionNotice(subscriptions.data);

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const signOut = async () => {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await actions.signOut();
    } catch (err) {
      setSignOutError(errorText(err));
      setPhase('signOutFailed');
      setSigningOut(false);
    }
  };

  const confirmDelete = async () => {
    if (!confirmed || deletion.isPending) return;
    try {
      await deletion.mutateAsync();
    } catch {
      return; // the failure shows under the button
    }
    await signOut();
  };

  return (
    <ScreenFrame title={t('settings:delete.title')}>
      {phase === 'review' ? (
        <>
          <Text variant="body" color="inkMuted">
            {t('settings:delete.body')}
          </Text>
          <Section title={t('settings:delete.whatGoes')}>
            <Text variant="body">{t('settings:delete.whatGoesBody')}</Text>
          </Section>
          <Section title={t('settings:delete.whatStays')}>
            <Text variant="body">{t('settings:delete.whatStaysBody')}</Text>
          </Section>
          <Section>
            <Notice tone="warn" title={t(notice.titleKey)} testID="delete-subscription">
              {t(notice.bodyKey, notice.storeKey ? { store: t(notice.storeKey) } : {})}
            </Notice>
            {notice.manageStore ? (
              <View style={styles.action}>
                <Button
                  label={t('settings:delete.subscription.manage')}
                  variant="secondary"
                  onPress={() => { if (notice.manageStore) void openStoreSubscriptions(notice.manageStore); }}
                />
              </View>
            ) : null}
          </Section>
          <View style={styles.buttons}>
            <Button label={t('settings:delete.continue')} onPress={() => setPhase('confirm')} fullWidth testID="delete-continue" />
            <View style={styles.gap} />
            <Button label={t('common:actions.cancel')} variant="secondary" onPress={leave} fullWidth />
          </View>
        </>
      ) : null}

      {phase === 'confirm' ? (
        <>
          <Text variant="subheading" accessibilityRole="header">
            {t('settings:delete.confirmTitle', { word })}
          </Text>
          <View style={styles.field}>
            <TextField
              label={t('settings:delete.confirmLabel')}
              hint={t('settings:delete.confirmHint')}
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              returnKeyType="done"
              onSubmitEditing={() => void confirmDelete()}
              editable={!deletion.isPending}
              testID="delete-input"
            />
          </View>
          <View style={styles.buttons}>
            <DangerButton
              label={t(deletion.isPending ? 'settings:delete.deleting' : 'settings:delete.confirm')}
              onPress={() => void confirmDelete()}
              disabled={!confirmed}
              loading={deletion.isPending}
              testID="delete-confirm"
            />
            <View style={styles.gap} />
            <Button label={t('common:actions.cancel')} variant="secondary" onPress={leave} disabled={deletion.isPending} fullWidth />
          </View>
          <ErrorText error={deletion.isError ? FAILED : null} />
        </>
      ) : null}

      {phase === 'signOutFailed' ? (
        <>
          <Notice tone="warn" title={t('settings:delete.signOutFailed')} testID="delete-signout-failed" />
          <View style={styles.buttons}>
            <Button label={t('settings:account.signOut')} onPress={() => void signOut()} loading={signingOut} fullWidth />
          </View>
          <ErrorText error={signOutError} />
        </>
      ) : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: space.md, alignItems: 'flex-start' },
  field: { marginTop: space.lg },
  buttons: { marginTop: space.xl },
  gap: { height: space.md },
});
