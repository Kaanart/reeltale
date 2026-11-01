import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type TextInput } from 'react-native';

import { Button, Text } from '../../../components/ui';
import { checkDateOfBirth, type DobProblem } from '../../../core/age';
import { colors, radius, space } from '../../../theme/tokens';
import { AuthScreen } from '../components/AuthScreen';
import { ErrorText } from '../components/ErrorText';
import { TextField } from '../components/TextField';
import { TextLink } from '../components/TextLink';
import { useAuth } from '../hooks';
import { useSubmit } from '../useSubmit';
import { dobText } from '../validation';

// The 18+ gate. Day, month and year as three number fields (works the same on iOS, Android and the web,
// with the system's birthday autofill), checked with core/age.ts, confirmed once, then sent to
// set_my_date_of_birth, which answers 'adult' or 'blocked'. The answer can't be changed, and the screen
// can't be swiped away: the gate moves on by itself.
export function BirthdayScreen() {
  const { t, i18n } = useTranslation();
  const { actions } = useAuth();
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [problem, setProblem] = useState<DobProblem | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const monthRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);
  const { busy, error, run } = useSubmit<'send' | 'signOut'>();

  const review = () => {
    const check = checkDateOfBirth(dobText(day, month, year));
    if (!check.ok) {
      setProblem(check.problem);
      return;
    }
    setProblem(null);
    setConfirming(check.dob);
  };

  const formatted = (dob: string) => {
    const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
    return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
  };

  const edit = (setter: (v: string) => void) => (v: string) => {
    setter(v.replace(/\D/g, ''));
    setProblem(null);
  };

  return (
    <AuthScreen
      title={t('age:gate.title')}
      hint={t('age:gate.body')}
      footer={
        <TextLink label={t('auth:signOut.confirm')} onPress={() => void run('signOut', actions.signOut)} disabled={busy !== null} />
      }
    >
      {confirming ? (
        <View style={styles.card} accessibilityLiveRegion="polite">
          <Text variant="heading" accessibilityRole="header">
            {t('age:gate.confirmTitle')}
          </Text>
          <Text variant="body" style={styles.cardBody}>
            {t('age:gate.confirmBody', { date: formatted(confirming) })}
          </Text>
          <Button
            label={busy === 'send' ? t('age:gate.checking') : t('age:gate.confirm')}
            onPress={() => void run('send', () => actions.setDateOfBirth(confirming))}
            loading={busy === 'send'}
            fullWidth
            testID="birthday-confirm"
          />
          <View style={styles.gap} />
          <Button label={t('age:gate.edit')} onPress={() => setConfirming(null)} variant="secondary" disabled={busy !== null} fullWidth />
        </View>
      ) : (
        <>
          <Text variant="bodySmall" color="inkMuted" style={styles.label} accessibilityRole="header">
            {t('age:gate.dateLabel')}
          </Text>
          <View style={styles.row}>
            <TextField
              label={t('age:gate.day')}
              placeholder={t('age:gate.placeholders.day')}
              value={day}
              onChangeText={edit((v) => { setDay(v); if (v.length === 2) monthRef.current?.focus(); })}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={2}
              autoComplete="birthdate-day"
              textContentType="birthdateDay"
              returnKeyType="next"
              autoFocus
              style={styles.short}
              testID="birthday-day"
            />
            <TextField
              ref={monthRef}
              label={t('age:gate.month')}
              placeholder={t('age:gate.placeholders.month')}
              value={month}
              onChangeText={edit((v) => { setMonth(v); if (v.length === 2) yearRef.current?.focus(); })}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={2}
              autoComplete="birthdate-month"
              textContentType="birthdateMonth"
              returnKeyType="next"
              style={styles.short}
              testID="birthday-month"
            />
            <TextField
              ref={yearRef}
              label={t('age:gate.year')}
              placeholder={t('age:gate.placeholders.year')}
              value={year}
              onChangeText={edit(setYear)}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={4}
              autoComplete="birthdate-year"
              textContentType="birthdateYear"
              returnKeyType="done"
              onSubmitEditing={review}
              style={styles.long}
              testID="birthday-year"
            />
          </View>
          {problem ? (
            <Text variant="bodySmall" color="danger" accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.problem}>
              {t(`age:errors.${problem}`)}
            </Text>
          ) : null}
          <Text variant="bodySmall" color="inkMuted" style={styles.hint}>
            {t('age:gate.hint')}
          </Text>
          <Button label={t('age:gate.continue')} onPress={review} fullWidth testID="birthday-continue" />
        </>
      )}
      <ErrorText error={error} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: space.sm },
  row: { flexDirection: 'row', gap: space.md },
  short: { flex: 1 },
  long: { flex: 1.6 },
  problem: { marginTop: space.md },
  hint: { marginTop: space.lg, marginBottom: space.xl },
  card: {
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  cardBody: { marginTop: space.sm, marginBottom: space.xl },
  gap: { height: space.md },
});
