import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button, Text } from '../../../components/ui';
import { colors, space } from '../../../theme/tokens';
import { ErrorText } from '../../auth';
import { Notice } from '../components/Notice';
import { Card, Section } from '../components/Section';
import { ScreenFrame } from '../components/ScreenFrame';
import { useSubscriptions, useVipPerks } from '../hooks';
import { openStoreSubscriptions } from '../links';
import { formatDay } from '../logic/dates';
import { errorText } from '../logic/errors';
import { activeSubscription, manageSubscriptionUrl, planNameKey } from '../logic/subscription';

const CHECK = 20;

// What VIP gives, and the account's own VIP status. There is nothing to buy yet: no price, no subscribe
// button, only a neutral note. The perks come from the blueprint's economy (logic/vip.ts), with the discount
// and the extra Free Pass read from the live pricing config when it can be.
export function VipScreen() {
  const { t, i18n } = useTranslation();
  const perks = useVipPerks();
  const subscriptions = useSubscriptions();
  const vip = activeSubscription(subscriptions.data);

  const lines = [
    t('vip:perks.coins', { count: perks.coins, period: t(`vip:period.${perks.period}`) }),
    ...(perks.discountPct > 0 ? [t('vip:perks.discount', { percent: perks.discountPct })] : []),
    ...(perks.extraFreePasses > 0 ? [t('vip:perks.freePass', { count: perks.extraFreePasses })] : []),
    t('vip:perks.ai'),
  ];

  return (
    <ScreenFrame title={t('vip:title')}>
      <Text variant="body" color="inkMuted">
        {t('vip:tagline')}
      </Text>

      {vip ? (
        <Section>
          <Card padded>
            <Text variant="heading" accessibilityRole="header">
              {t('vip:active.title')}
            </Text>
            <Text variant="body" style={styles.line} testID="vip-plan">
              {t('vip:active.plan', { plan: t(planNameKey(vip.tier)) })}
            </Text>
            {vip.period_end ? (
              <Text variant="bodySmall" color="inkMuted" style={styles.line}>
                {t(vip.auto_renew ? 'vip:active.renews' : 'vip:active.ends', { date: formatDay(vip.period_end, i18n.language) })}
              </Text>
            ) : null}
            <Text variant="bodySmall" color="inkMuted" style={styles.line}>
              {t('vip:active.next')}
            </Text>
            {manageSubscriptionUrl(vip.store) ? (
              <View style={styles.manage}>
                <Button label={t('vip:active.manage')} variant="secondary" onPress={() => void openStoreSubscriptions(vip.store)} />
              </View>
            ) : null}
          </Card>
        </Section>
      ) : null}

      <Section title={t('vip:perksTitle')} note={t('vip:perks.coinsValid')}>
        <Card padded>
          {lines.map((line, i) => (
            <View key={line} style={[styles.perk, i > 0 && styles.perkGap]}>
              <Ionicons name="checkmark-circle" size={CHECK} color={colors.success} accessible={false} />
              <Text variant="body" style={styles.perkText}>
                {line}
              </Text>
            </View>
          ))}
        </Card>
      </Section>

      {!vip ? (
        <Section>
          <Notice title={t('vip:comingSoon')} testID="vip-coming-soon" />
        </Section>
      ) : null}

      {subscriptions.isError ? <ErrorText error={errorText(subscriptions.error)} /> : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  line: { marginTop: space.sm },
  manage: { marginTop: space.lg, alignItems: 'flex-start' },
  perk: { flexDirection: 'row', alignItems: 'flex-start' },
  perkGap: { marginTop: space.md },
  perkText: { flex: 1, marginLeft: space.md },
});
