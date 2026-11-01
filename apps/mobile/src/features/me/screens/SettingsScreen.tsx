import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button, Sheet, Text } from '../../../components/ui';
import { colors, space } from '../../../theme/tokens';
import { userKey } from '../../../lib/data';
import { ErrorText, useAuth, useUserId } from '../../auth';
import { InfoRow, NavRow, SwitchRow } from '../components/Rows';
import { Card, Divider, Section } from '../components/Section';
import { ScreenFrame } from '../components/ScreenFrame';
import { useAiConsents, useSetAiConsent } from '../hooks';
import { openLegalPage } from '../links';
import { AI_CONSENT_PURPOSES, consentOn } from '../logic/consent';
import { errorText, type ErrorTextValue } from '../logic/errors';
import { LEGAL_LABEL_KEYS, LEGAL_PAGES } from '../logic/legal';

const ICON = 20;
const METHODS = ['apple', 'google', 'email', 'password', 'demo'] as const;

// Settings: the account, mature content, per-purpose AI consent, the legal pages and deleting the account.
export function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = useUserId();
  const { email, method, matureOptIn, actions } = useAuth();

  // ---- Mature content: turning it on asks first; turning it off doesn't.
  const [confirmMature, setConfirmMature] = useState(false);
  const [matureBusy, setMatureBusy] = useState(false);
  const [matureError, setMatureError] = useState<ErrorTextValue | null>(null);

  const setMature = async (on: boolean) => {
    setMatureBusy(true);
    setMatureError(null);
    try {
      await actions.setMatureOptIn(on);
      // What the catalog shows depends on this: let it load again.
      void queryClient.invalidateQueries({ queryKey: userKey(userId, 'catalog') });
    } catch (err) {
      setMatureError(errorText(err));
    } finally {
      setMatureBusy(false);
      setConfirmMature(false);
    }
  };

  // ---- AI consents: one switch per purpose.
  const consents = useAiConsents();
  const setConsent = useSetAiConsent();
  const [consentNote, setConsentNote] = useState<string | null>(null);

  const toggleConsent = (purpose: (typeof AI_CONSENT_PURPOSES)[number]['purpose'], granted: boolean) => {
    setConsentNote(null);
    const existing = consents.data?.find((r) => r.purpose === purpose);
    setConsent.mutate(
      { purpose, granted, ...(existing ? { existing } : {}) },
      { onSuccess: () => setConsentNote(t(granted ? 'settings:aiConsents.turnedOn' : 'settings:aiConsents.turnedOff')) },
    );
  };

  // ---- Sign out
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<ErrorTextValue | null>(null);
  const signOut = async () => {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await actions.signOut();
    } catch (err) {
      setSignOutError(errorText(err));
      setSigningOut(false);
    }
  };

  return (
    <ScreenFrame title={t('settings:title')}>
      <Section first title={t('settings:account.title')}>
        <Card>
          {email ? <InfoRow label={t('settings:account.email')} value={email} testID="settings-email" /> : null}
          {email && method ? <Divider /> : null}
          {method && (METHODS as readonly string[]).includes(method) ? (
            <InfoRow label={t('settings:account.signInMethod')} value={t(`settings:account.methods.${method}`)} />
          ) : null}
        </Card>
        <View style={styles.action}>
          <Button label={t('settings:account.signOut')} variant="secondary" onPress={() => void signOut()} loading={signingOut} testID="settings-sign-out" />
        </View>
        <ErrorText error={signOutError} />
      </Section>

      <Section>
        <Card>
          <SwitchRow
            label={t('settings:mature.title')}
            body={t('settings:mature.body')}
            value={matureOptIn}
            disabled={matureBusy}
            onValueChange={(next) => (next ? setConfirmMature(true) : void setMature(false))}
            testID="settings-mature"
          />
          <Divider />
          <NavRow label={t('settings:blocked.title')} onPress={() => router.push('/settings/blocked')} testID="settings-blocked" />
        </Card>
        <ErrorText error={matureError} />
      </Section>

      <Section title={t('settings:aiConsents.title')} note={t('settings:aiConsents.intro')}>
        <Card>
          {AI_CONSENT_PURPOSES.map((info, i) => {
            // While a change is on its way, the switch already shows where it is going.
            const sending = setConsent.isPending ? setConsent.variables : undefined;
            const value = sending?.purpose === info.purpose ? sending.granted : consentOn(consents.data, info.purpose);
            return (
              <View key={info.purpose}>
                {i > 0 ? <Divider /> : null}
                <SwitchRow
                  label={t(`settings:aiConsents.${info.textKey}.title`)}
                  body={t(`settings:aiConsents.${info.textKey}.body`)}
                  value={value}
                  disabled={consents.data === undefined || setConsent.isPending}
                  onValueChange={(next) => toggleConsent(info.purpose, next)}
                  testID={`settings-consent-${info.purpose}`}
                />
              </View>
            );
          })}
        </Card>
        {consentNote ? (
          <Text variant="bodySmall" color="inkMuted" accessibilityLiveRegion="polite" style={styles.note}>
            {consentNote}
          </Text>
        ) : null}
        {consents.isError ? (
          <View>
            <ErrorText error={errorText(consents.error)} />
            <View style={styles.action}>
              <Button label={t('common:actions.retry')} variant="secondary" size="sm" onPress={() => void consents.refetch()} />
            </View>
          </View>
        ) : null}
        {setConsent.isError ? <ErrorText error={errorText(setConsent.error)} /> : null}
      </Section>

      <Section title={t('settings:legal.title')}>
        <Card>
          {LEGAL_PAGES.map((slug, i) => (
            <View key={slug}>
              {i > 0 ? <Divider /> : null}
              <NavRow label={t(LEGAL_LABEL_KEYS[slug])} role="link" onPress={() => void openLegalPage(slug)} testID={`settings-legal-${slug}`} />
            </View>
          ))}
        </Card>
      </Section>

      <Section>
        <Card>
          <NavRow
            label={t('settings:delete.title')}
            leading={<Ionicons name="trash-outline" size={ICON} color={colors.danger} accessible={false} />}
            onPress={() => router.push('/settings/delete')}
            testID="settings-delete"
          />
        </Card>
      </Section>

      <Sheet visible={confirmMature} onClose={() => setConfirmMature(false)} title={t('settings:mature.confirmTitle')}>
        <Text variant="body" color="inkMuted">
          {t('settings:mature.confirmBody')}
        </Text>
        <View style={styles.sheetActions}>
          <Button label={t('settings:mature.confirm')} onPress={() => void setMature(true)} loading={matureBusy} fullWidth testID="settings-mature-confirm" />
          <View style={styles.gap} />
          <Button label={t('common:actions.cancel')} variant="secondary" onPress={() => setConfirmMature(false)} disabled={matureBusy} fullWidth />
        </View>
      </Sheet>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: space.md, alignItems: 'flex-start' },
  note: { marginTop: space.sm },
  sheetActions: { marginTop: space.xl },
  gap: { height: space.md },
});
