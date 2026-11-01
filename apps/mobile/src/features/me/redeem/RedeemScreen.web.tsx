import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { RedeemResponse } from '@reeltale/shared';
import { Button, Text } from '../../../components/ui';
import { api } from '../../../lib/api';
import { isDemo, userKey } from '../../../lib/data';
import { colors, space } from '../../../theme/tokens';
import { ErrorText, TextField, useAuth, useUserId } from '../../auth';
import { ScreenFrame } from '../components/ScreenFrame';
import { Card } from '../components/Section';
import { errorText, type ErrorTextValue } from '../logic/errors';
import { isCodeFormat, normalizeCode, redeemMessages } from './redeemLogic';
import { TURNSTILE_SITE_KEY } from './siteKey';
import { Turnstile, type TurnstileHandle } from './Turnstile';

const CHECK = 28;

// Web only: this is the .web version, and RedeemScreen.tsx is the native stub that redirects Home (App Store
// 3.1.1). Enter an access code, pass the Turnstile check, and POST /api/codes/redeem. The coins and AI access
// it grants show in the wallet, in the apps too.
export function RedeemScreen() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const userId = useUserId();
  const { actions } = useAuth();

  const [code, setCode] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorTextValue | null>(null);
  const [done, setDone] = useState<RedeemResponse | null>(null);
  const widget = useRef<TurnstileHandle | null>(null);
  // Demo mode makes no network calls at all: no Turnstile script, no redeem request.
  const siteKey = isDemo ? null : TURNSTILE_SITE_KEY;

  const invalid = (key: string): ErrorTextValue => ({ key, params: {} });

  const submit = async () => {
    if (busy) return;
    const clean = normalizeCode(code);
    if (!isCodeFormat(clean)) {
      setError(invalid('redeem:errors.format'));
      return;
    }
    if (!token) return; // the button is off until the check passes; this is the Enter key
    setBusy(true);
    setError(null);
    try {
      const res = await api.redeemCode({ code: clean, turnstileToken: token });
      setDone(res);
      setCode('');
      // Coins and AI access changed: the wallet and the account load again.
      void queryClient.invalidateQueries({ queryKey: userKey(userId, 'wallet') });
      void actions.reloadAccount();
    } catch (err) {
      setError(errorText(err));
    } finally {
      // A Turnstile token works once, so every attempt needs a new one.
      setToken(null);
      widget.current?.reset();
      setBusy(false);
    }
  };

  const again = () => {
    setDone(null);
    setError(null);
  };

  return (
    <ScreenFrame title={t('redeem:title')}>
      {siteKey === null ? (
        <Text variant="body" color="inkMuted" testID="redeem-unavailable">
          {t('redeem:notAvailable')}
        </Text>
      ) : done ? (
        <Card padded>
          <View style={styles.done}>
            <Ionicons name="checkmark-circle" size={CHECK} color={colors.success} accessible={false} />
            <Text variant="heading" accessibilityRole="header" style={styles.doneTitle}>
              {t('redeem:success.title')}
            </Text>
          </View>
          <View accessibilityLiveRegion="polite" testID="redeem-result">
            {redeemMessages(done, i18n.language).map((line) => (
              <Text key={line.key} variant="body" style={styles.doneLine}>
                {t(line.key, line.params)}
              </Text>
            ))}
          </View>
          {done.status === 'redeemed' ? (
            <Text variant="bodySmall" color="inkMuted" style={styles.doneLine}>
              {t('redeem:syncNote')}
            </Text>
          ) : null}
          <View style={styles.again}>
            <Button label={t('redeem:another')} variant="secondary" onPress={again} />
          </View>
        </Card>
      ) : (
        <>
          <Text variant="body" color="inkMuted">
            {t('redeem:intro')}
          </Text>
          <View style={styles.field}>
            <TextField
              label={t('redeem:label')}
              placeholder={t('redeem:placeholder')}
              value={code}
              onChangeText={(next) => { setCode(next); setError(null); }}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              maxLength={80}
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              editable={!busy}
              testID="redeem-code"
            />
          </View>
          <View style={styles.check}>
            <Turnstile
              siteKey={siteKey}
              label={t('redeem:securityCheck')}
              handle={widget}
              onToken={(next) => { setToken(next); setCheckFailed(false); }}
              onInvalid={() => setToken(null)}
              onError={() => { setToken(null); setCheckFailed(true); }}
            />
            {!token && !checkFailed ? (
              <Text variant="caption" color="inkMuted" style={styles.human}>
                {t('redeem:human')}
              </Text>
            ) : null}
          </View>
          <View style={styles.submit}>
            <Button
              label={t(busy ? 'redeem:submitting' : 'redeem:submit')}
              onPress={() => void submit()}
              loading={busy}
              disabled={code.trim().length === 0 || !token}
              fullWidth
              testID="redeem-submit"
            />
          </View>
          <ErrorText error={error ?? (checkFailed ? invalid('redeem:errors.turnstile_failed') : null)} />
        </>
      )}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  field: { marginTop: space.xl },
  check: { marginTop: space.lg },
  human: { marginTop: space.sm },
  submit: { marginTop: space.xl },
  done: { flexDirection: 'row', alignItems: 'center' },
  doneTitle: { marginLeft: space.md },
  doneLine: { marginTop: space.md },
  again: { marginTop: space.xl, alignItems: 'flex-start' },
});
