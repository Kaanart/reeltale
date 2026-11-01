import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { summarizeWallet } from '../../../core/wallet';
import { Button, Skeleton, Text } from '../../../components/ui';
import { colors, space } from '../../../theme/tokens';
import { ErrorText } from '../../auth';
import { Avatar } from '../components/Avatar';
import { CoinMark } from '../components/CoinMark';
import { NavRow } from '../components/Rows';
import { Card, Divider, Section } from '../components/Section';
import { ScreenFrame } from '../components/ScreenFrame';
import { useMyProfile, useSubscriptions, useWallet } from '../hooks';
import { errorText } from '../logic/errors';
import { displayNameOf, handleText, initialOf } from '../logic/profileView';
import { activeSubscription, planNameKey } from '../logic/subscription';
import { formatDay } from '../logic/dates';

const COIN = 22;
const ICON = 22;

// The Me tab: who you are (a placeholder avatar, name and handle), your wallet, VIP, and the way to the
// rest (Library, Settings). Pull down to refresh in the apps.
export function MeScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const profile = useMyProfile();
  const wallet = useWallet();
  const subscriptions = useSubscriptions();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([profile.refetch(), wallet.refetch(), subscriptions.refetch()]);
    setRefreshing(false);
  };

  const name = displayNameOf(profile.data) ?? t('profile:me.anonymous');
  const handle = handleText(profile.data);
  const bio = profile.data?.bio?.trim() ?? '';
  const summary = wallet.data ? summarizeWallet(wallet.data) : null;
  const vip = activeSubscription(subscriptions.data);

  const vipValue = vip
    ? t('vip:active.plan', { plan: t(planNameKey(vip.tier)) })
    : subscriptions.isSuccess ? t('profile:me.notVip') : null;
  const failed = wallet.isError || profile.isError || subscriptions.isError;
  const firstError = wallet.error ?? profile.error ?? subscriptions.error;

  return (
    <ScreenFrame tab leading="none" refreshing={refreshing} onRefresh={() => void refresh()}>
      <View style={styles.identity}>
        <Avatar initial={initialOf(profile.data)} />
        <View style={styles.names}>
          {profile.isLoading ? (
            <>
              <Skeleton width="60%" height={space.xl} />
              <View style={styles.gap} />
              <Skeleton width="40%" height={space.lg} />
            </>
          ) : (
            <>
              <Text variant="title" accessibilityRole="header" numberOfLines={2}>
                {name}
              </Text>
              {handle ? (
                <Text variant="body" color="inkMuted" numberOfLines={1}>
                  {handle}
                </Text>
              ) : null}
            </>
          )}
        </View>
      </View>
      {bio ? (
        <Text variant="body" color="inkMuted" style={styles.bio}>
          {bio}
        </Text>
      ) : null}

      <Section>
        <Card>
          <NavRow
            label={t('profile:me.links.wallet')}
            value={summary ? t('common:coins.count', { count: summary.balance }) : null}
            leading={<CoinMark size={COIN} />}
            onPress={() => router.push('/wallet')}
            testID="me-wallet"
          />
          <Divider />
          <NavRow
            label={t('profile:me.links.vip')}
            value={vipValue}
            leading={<Ionicons name="star-outline" size={ICON} color={colors.ink} accessible={false} />}
            onPress={() => router.push('/vip')}
            testID="me-vip"
          />
        </Card>
        {vip?.period_end ? (
          <Text variant="caption" color="inkMuted" style={styles.caption}>
            {t(vip.auto_renew ? 'vip:active.renews' : 'vip:active.ends', { date: formatDay(vip.period_end, i18n.language) })}
          </Text>
        ) : null}
        {summary && summary.expiringSoonCoins > 0 ? (
          <Text variant="caption" color="inkMuted" style={styles.caption}>
            {t('wallet:expiringSoon.body', { count: summary.expiringSoonCoins })}
          </Text>
        ) : null}
      </Section>

      <Section>
        <Card>
          <NavRow
            label={t('profile:me.links.library')}
            leading={<Ionicons name="library-outline" size={ICON} color={colors.ink} accessible={false} />}
            onPress={() => router.navigate('/library')}
            testID="me-library"
          />
          <Divider />
          <NavRow
            label={t('profile:me.links.settings')}
            leading={<Ionicons name="settings-outline" size={ICON} color={colors.ink} accessible={false} />}
            onPress={() => router.push('/settings')}
            testID="me-settings"
          />
        </Card>
      </Section>

      {failed ? (
        <View style={styles.failed}>
          <ErrorText error={errorText(firstError)} />
          <View style={styles.retry}>
            <Button label={t('common:actions.retry')} variant="secondary" onPress={() => void refresh()} loading={refreshing} />
          </View>
        </View>
      ) : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center' },
  names: { flex: 1, marginLeft: space.lg },
  gap: { height: space.sm },
  bio: { marginTop: space.lg },
  caption: { marginTop: space.sm },
  failed: { marginTop: space.xl },
  retry: { marginTop: space.md, alignItems: 'flex-start' },
});
