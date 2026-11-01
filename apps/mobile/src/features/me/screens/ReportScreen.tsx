import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AIBadge, Button, Text } from '../../../components/ui';
import { colors, space } from '../../../theme/tokens';
import { Checkbox, ErrorText, useUserId } from '../../auth';
import { RadioRow } from '../components/Rows';
import { Card, Divider, Section } from '../components/Section';
import { ScreenFrame } from '../components/ScreenFrame';
import { TextArea } from '../components/TextArea';
import { useContentOwner, useIsBlocked, useReportContent, useSetBlocked } from '../hooks';
import { blockErrorText, errorText } from '../logic/errors';
import {
  blockableUser, blockOfferKey, checkReport, DETAILS_MAX, parseReportParams, reasonLabelKey, reasonsFor, reportArgs,
  type ReportProblem, type ReportReason,
} from '../logic/report';

const CHECK = 56;

// The report modal: /report?type=series|episode|ai_scene|profile&id=<uuid>[&creator=<uuid>].
// A reason, optional details (up to 2,000 characters) and a good-faith tick, then public.report_content.
// The confirmation is calm and offers to block the person too: the reported profile, or the creator the
// database names for the series or episode (not the link's `creator`, which anyone can write).
export function ReportScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; id?: string; creator?: string }>();
  const target = parseReportParams(params);
  const selfId = useUserId();
  const report = useReportContent();

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [goodFaith, setGoodFaith] = useState(false);
  const [problem, setProblem] = useState<ReportProblem | null>(null);
  const [sent, setSent] = useState(false);

  // Whom to offer to block comes from the content's own row, never from the link's `creator` param.
  const owner = useContentOwner(target);
  const blockId = target ? blockableUser(target, selfId, owner.data ?? null) : null;
  const blocked = useIsBlocked(blockId);
  const setBlocked = useSetBlocked();

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const submit = () => {
    const found = checkReport({ reason, goodFaith });
    setProblem(found);
    if (found || !target || !reason) return;
    report.mutate(reportArgs(target, reason, details), { onSuccess: () => setSent(true) });
  };

  const modal = <Stack.Screen options={{ presentation: 'modal' }} />;

  if (!target) {
    return (
      <ScreenFrame title={t('report:title')} leading="close">
        {modal}
        <ErrorText error={{ key: 'errors:target_not_found', params: {} }} />
        <View style={styles.actions}>
          <Button label={t('common:actions.close')} variant="secondary" onPress={close} />
        </View>
      </ScreenFrame>
    );
  }

  if (sent) {
    return (
      <ScreenFrame title={t('report:title')} leading="close">
        {modal}
        <View style={styles.thanks}>
          <Ionicons name="checkmark-circle" size={CHECK} color={colors.success} accessible={false} />
          <Text variant="heading" align="center" accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.thanksText} testID="report-thanks">
            {t('report:thanks')}
          </Text>
        </View>
        {blockId ? (
          <View style={styles.blockOffer}>
            {blocked.data === true ? (
              <Text variant="body" color="inkMuted" align="center">
                {t('profile:user.blockedNote')}
              </Text>
            ) : (
              <Button
                label={t(setBlocked.isPending ? 'report:blocking' : blockOfferKey(target.type))}
                variant="secondary"
                onPress={() => setBlocked.mutate({ target: blockId, blocked: true })}
                loading={setBlocked.isPending}
                fullWidth
                testID="report-block"
              />
            )}
            <ErrorText error={setBlocked.isError ? blockErrorText(setBlocked.error) : null} />
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button label={t('common:actions.done')} onPress={close} fullWidth testID="report-done" />
        </View>
      </ScreenFrame>
    );
  }

  const reasons = reasonsFor(target.type);

  return (
    <ScreenFrame title={t('report:title')} leading="close">
      {modal}
      <Text variant="body" color="inkMuted">
        {t('report:intro')}
      </Text>
      <View style={styles.what} accessible accessibilityLabel={`${t('report:whatYouReport')}: ${t(`report:target.${target.type}`)}`}>
        <Text variant="bodySmall" color="inkMuted">
          {t('report:whatYouReport')}
        </Text>
        <Text variant="bodySmall" style={styles.whatName}>
          {t(`report:target.${target.type}`)}
        </Text>
        {target.type === 'ai_scene' ? <AIBadge size="sm" /> : null}
      </View>

      <Section title={t('report:reason')}>
        <Card>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('report:reason')}>
            {reasons.map((r, i) => (
              <View key={r}>
                {i > 0 ? <Divider /> : null}
                <RadioRow
                  label={t(reasonLabelKey(r))}
                  selected={reason === r}
                  onPress={() => { setReason(r); setProblem(null); }}
                  testID={`report-reason-${r}`}
                />
              </View>
            ))}
          </View>
        </Card>
        {problem === 'need_reason' ? <Problem text={t('report:needReason')} /> : null}
      </Section>

      <View style={styles.details}>
        <TextArea
          label={t('report:details')}
          placeholder={t('report:detailsPlaceholder')}
          value={details}
          onChangeText={setDetails}
          maxLength={DETAILS_MAX}
          counter={t('report:detailsCount', { current: details.length, max: DETAILS_MAX })}
          testID="report-details"
        />
      </View>

      <View style={styles.goodFaith}>
        <Checkbox label={t('report:goodFaith')} checked={goodFaith} onChange={(next) => { setGoodFaith(next); setProblem(null); }} />
        {problem === 'need_good_faith' ? <Problem text={t('report:needGoodFaith')} /> : null}
      </View>

      <View style={styles.actions}>
        <Button
          label={t(report.isPending ? 'report:submitting' : 'report:submit')}
          onPress={submit}
          loading={report.isPending}
          fullWidth
          testID="report-submit"
        />
      </View>
      <ErrorText error={report.isError ? errorText(report.error) : null} />
    </ScreenFrame>
  );
}

// What is missing from the form. The words stay ink: the danger red is under 4.5:1 on paper (4.16:1), so the
// red is only the icon, and the words say what is wrong.
function Problem({ text }: { text: string }) {
  return (
    <View style={styles.problem}>
      <Ionicons name="alert-circle" size={space.lg} color={colors.danger} accessible={false} />
      <Text variant="bodySmall" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.problemText}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  what: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: space.md },
  whatName: { marginLeft: space.xs, marginRight: space.sm },
  problem: { flexDirection: 'row', alignItems: 'center', marginTop: space.sm },
  problemText: { flexShrink: 1, marginLeft: space.xs },
  details: { marginTop: space.xl },
  goodFaith: { marginTop: space.lg },
  actions: { marginTop: space.xl },
  thanks: { alignItems: 'center', marginTop: space.xl },
  thanksText: { marginTop: space.lg },
  blockOffer: { marginTop: space.xl },
});
