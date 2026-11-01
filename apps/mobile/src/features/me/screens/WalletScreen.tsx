import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button, Skeleton, Text } from '../../../components/ui';
import { summarizeWallet } from '../../../core/wallet';
import { fonts, space } from '../../../theme/tokens';
import { ErrorText } from '../../auth';
import { CoinMark } from '../components/CoinMark';
import { Notice } from '../components/Notice';
import { RedeemLink } from '../components/RedeemLink';
import { Card, Divider, Section } from '../components/Section';
import { ScreenFrame } from '../components/ScreenFrame';
import { useWallet } from '../hooks';
import { errorText } from '../logic/errors';
import { lotLabelKey, lotLines } from '../logic/walletView';

const BIG_COIN = 40;

// The wallet: the balance, what is paid and what is bonus (each bonus lot with its expiry), Free Passes,
// and a refund shortfall when there is one. No way to buy yet: the apps show a neutral note, and the web adds
// the link to the redeem screen (RedeemLink is empty on iOS and Android).
export function WalletScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const wallet = useWallet();
  const [refreshing, setRefreshing] = useState(false);

  // The numbers are as of the fetch: load them again whenever the screen comes back into view.
  const { refetch } = wallet;
  // (cancelRefetch: false keeps the load that is already running on the first visit.)
  useFocusEffect(useCallback(() => { void refetch({ cancelRefetch: false }); }, [refetch]));

  // One "now" for the whole render, so the summary and the lot lines agree on what has expired.
  const now = new Date();
  const summary = wallet.data ? summarizeWallet(wallet.data, now) : null;
  const lots = summary ? lotLines(summary.expiring, now, i18n.language) : [];

  const refresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <ScreenFrame title={t('wallet:title')} refreshing={refreshing} onRefresh={() => void refresh()}>
      {!summary && wallet.isError ? (
        <View>
          <ErrorText error={errorText(wallet.error)} />
          <View style={styles.retry}>
            <Button label={t('common:actions.retry')} variant="secondary" onPress={() => void refresh()} loading={refreshing} />
          </View>
        </View>
      ) : null}

      {!summary && !wallet.isError ? (
        <View accessibilityLabel={t('common:state.loading')} accessibilityRole="progressbar">
          <Skeleton width="50%" height={space.xxl} />
          <View style={styles.gap} />
          <Skeleton height={space.xxl * 2} />
        </View>
      ) : null}

      {summary ? (
        <>
          <Card padded>
            <Text variant="bodySmall" color="inkMuted">
              {t('wallet:balance')}
            </Text>
            <View
              style={styles.balanceRow}
              accessible
              accessibilityRole="text"
              accessibilityLabel={t('wallet:balanceA11y', { count: summary.balance })}
            >
              <CoinMark size={BIG_COIN} />
              <Text variant="display" style={styles.balance} testID="wallet-balance">
                {summary.balance.toLocaleString(i18n.language)}
              </Text>
            </View>
            {wallet.isError ? <ErrorText error={errorText(wallet.error)} /> : null}
          </Card>

          {summary.blockedByDebt ? (
            <View style={styles.block}>
              <Notice tone="warn" title={t('wallet:debt.title')}>
                {t('wallet:debt.body', { count: summary.refundDebt })}
              </Notice>
            </View>
          ) : null}

          {summary.expiringSoonCoins > 0 ? (
            <View style={styles.block}>
              <Notice tone="warn" title={t('wallet:expiringSoon.title')}>
                {t('wallet:expiringSoon.body', { count: summary.expiringSoonCoins })}
              </Notice>
              <View style={styles.cta}>
                <Button label={t('wallet:expiringSoon.cta')} variant="secondary" size="sm" onPress={() => router.navigate('/discover')} />
              </View>
            </View>
          ) : null}

          <Section title={t('wallet:paid.title')} note={t('wallet:paid.hint')}>
            <Card padded>
              <Text variant="heading" testID="wallet-paid">
                {t('wallet:lot.coins', { count: summary.paid })}
              </Text>
            </Card>
          </Section>

          <Section title={t('wallet:bonus.title')} note={t('wallet:bonus.hint')}>
            {lots.length === 0 ? (
              <Card padded>
                <Text variant="body" color="inkMuted">
                  {t('wallet:bonus.none')}
                </Text>
              </Card>
            ) : (
              <Card>
                {/* The bonus total, next to the paid one above: "paid vs bonus" at a glance. */}
                <View style={styles.total}>
                  <Text variant="heading" testID="wallet-bonus">
                    {t('wallet:lot.coins', { count: summary.bonus })}
                  </Text>
                </View>
                {lots.map((lot) => {
                  const source = t(lotLabelKey(lot.group));
                  const coins = t('wallet:lot.coins', { count: lot.coins });
                  const expiry = t(lot.expiry.key, lot.expiry.params);
                  return (
                    <View key={lot.id}>
                      <Divider />
                      <View
                        style={styles.lot}
                        accessible
                        accessibilityRole="text"
                        accessibilityLabel={t('wallet:lot.rowA11y', { source, coins, expiry })}
                      >
                        <View style={styles.lotText}>
                          <Text variant="body">{source}</Text>
                          <Text variant="bodySmall" color={lot.soon ? 'ink' : 'inkMuted'} style={lot.soon ? styles.soon : undefined}>
                            {expiry}
                          </Text>
                        </View>
                        <Text variant="body" style={styles.lotCoins}>
                          {coins}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </Card>
            )}
          </Section>

          <Section title={t('wallet:freePasses.title')} note={t('wallet:freePasses.hint')}>
            <Card padded>
              <Text variant="body" testID="wallet-free-passes">
                {summary.freePassesLeft > 0
                  ? t('wallet:freePasses.left', { left: summary.freePassesLeft })
                  : t('wallet:freePasses.none')}
              </Text>
            </Card>
          </Section>
        </>
      ) : null}

      <Section>
        <Notice title={t('wallet:comingSoon')} testID="wallet-coming-soon" />
        <Text variant="caption" color="inkMuted" style={styles.policy}>
          {t('wallet:policy')}
        </Text>
        <View style={styles.links}>
          <RedeemLink />
          <View style={styles.vipLink}>
            <Button label={t('wallet:vip')} variant="secondary" onPress={() => router.push('/vip')} testID="wallet-vip" />
          </View>
        </View>
      </Section>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  retry: { marginTop: space.md, alignItems: 'flex-start' },
  gap: { height: space.lg },
  balanceRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.xs },
  balance: { marginLeft: space.md, fontFamily: fonts.serifBold },
  block: { marginTop: space.lg },
  cta: { marginTop: space.sm, alignItems: 'flex-start' },
  total: { padding: space.lg },
  lot: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: space.lg, paddingVertical: space.sm },
  lotText: { flex: 1, marginRight: space.md },
  soon: { fontFamily: fonts.sansMedium },
  lotCoins: { fontFamily: fonts.sansMedium },
  policy: { marginTop: space.md },
  links: { marginTop: space.lg },
  vipLink: { marginTop: space.md, alignItems: 'flex-start' },
});
