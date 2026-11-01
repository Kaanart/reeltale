// The unlock sheet: the price from get_episode_price (with the VIP discount struck through when there is
// one), the wallet, and two explicit actions: "Unlock for N coins" (unlock_episode with the price shown)
// and "Use Free Pass". It never unlocks on its own. When coins are short, or a refund left a debt, it
// points to the wallet screen; it shows no money prices and sells nothing itself (coins and VIP are store
// purchases, App Store 3.1.1 / Play billing).

import { useRouter, type Href } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, ActivityIndicator, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { AIBadge, Button, CoinPrice, Sheet, Skeleton, Text } from '../../../components/ui';
import { describeError } from '../../../core/errors';
import { DEFAULT_PRICING, unlockPrice } from '../../../core/pricing';
import type { EpisodeRow, SeriesRow } from '../../../lib/types';
import { colors, radius, space, type as typeScale } from '../../../theme/tokens';
import { TextLink } from '../../auth';
import { useEpisodePrice, useFreePass, usePricingConfig, useUnlockEpisode, useUnlockWallet } from '../hooks';
import { isAiContent, watchAccessView } from '../logic/access';
import { unlockFailure, unlockSheetView, type UnlockFailure } from '../logic/unlock';

export interface UnlockSheetProps {
  /** The episode to unlock; null keeps the sheet closed. */
  episode: EpisodeRow | null;
  series: SeriesRow;
  onClose: () => void;
  /** The episode can be watched now (unlocked here, or it turned out to be free or already unlocked). */
  onUnlocked: (episodeId: string) => void;
}

const WALLET_ROUTE = '/wallet' as string as Href;
const VIP_ROUTE = '/vip' as string as Href;

export function UnlockSheet({ episode, series, onClose, onUnlocked }: UnlockSheetProps) {
  const { t } = useTranslation();
  // Keep the last episode while the sheet slides away. Updated during render, not in an effect: the body must
  // never render the previous episode with `open` (an episode unlocked a moment ago is "playable" and would
  // close the sheet that was just opened for the next one).
  const [shown, setShown] = useState<EpisodeRow | null>(episode);
  if (episode && episode.id !== shown?.id) setShown(episode);
  const body = episode ?? shown;

  return (
    <Sheet visible={!!episode} onClose={onClose} title={t('unlock:title')}>
      {body ? (
        <UnlockBody key={body.id} episode={body} series={series} open={!!episode} onClose={onClose} onUnlocked={onUnlocked} />
      ) : null}
    </Sheet>
  );
}

function celebrate(message: string) {
  if (Platform.OS !== 'web') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }
  AccessibilityInfo.announceForAccessibility(message);
}

function UnlockBody({ episode, series, open, onClose, onUnlocked }: {
  episode: EpisodeRow;
  series: SeriesRow;
  open: boolean;
  onClose: () => void;
  onUnlocked: (episodeId: string) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const priceQ = useEpisodePrice(episode.id, open);
  const walletQ = useUnlockWallet(open);
  const pricingQ = usePricingConfig(open);
  const unlock = useUnlockEpisode();
  const freePass = useFreePass();
  const [failure, setFailure] = useState<UnlockFailure | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const access = watchAccessView(priceQ.data, episode);
  const view = unlockSheetView({ access, wallet: walletQ.data, failure });
  const busy = unlock.isPending || freePass.isPending;

  // Nothing to unlock (free, already unlocked, unlocked elsewhere): let the episode play.
  const playable = view.kind === 'playable';
  useEffect(() => {
    if (open && playable && !busy) onUnlocked(episode.id);
  }, [open, playable, busy, onUnlocked, episode.id]);

  const fail = (err: unknown) => {
    const f = unlockFailure(err);
    setFailure(f);
    if (f.kind === 'price_changed') void priceQ.refetch();
    if (f.kind === 'other') {
      const info = describeError(err);
      setErrorText(t(info.key, info.params));
    }
  };

  const onUnlockCoins = (price: number) => {
    setFailure(null);
    setErrorText(null);
    unlock.mutate({ episodeId: episode.id, expectedPrice: price }, {
      onSuccess: () => {
        celebrate(t('unlock:unlocked'));
        onUnlocked(episode.id);
      },
      onError: fail,
    });
  };

  const onUseFreePass = () => {
    setFailure(null);
    setErrorText(null);
    freePass.mutate({ episodeId: episode.id }, {
      onSuccess: () => {
        celebrate(t('unlock:freePass.success'));
        onUnlocked(episode.id);
      },
      onError: fail,
    });
  };

  const toWallet = () => {
    onClose();
    router.push(WALLET_ROUTE);
  };

  // The sheet covers the page's info card (and its AI label) while the AI-made poster stays in view above it.
  const heading = (
    <View style={styles.heading}>
      {isAiContent(series, episode) ? (
        <View style={styles.aiBadge}>
          <AIBadge size="sm" />
        </View>
      ) : null}
      <Text variant="bodySmall" color="inkMuted">
        {t('unlock:episode', { series: series.title, number: episode.number })}
      </Text>
      <Text variant="subheading" numberOfLines={2}>
        {episode.title}
      </Text>
    </View>
  );

  if (view.kind === 'loading' || view.kind === 'playable') {
    const error = priceQ.error ? describeError(priceQ.error) : null;
    return (
      <View style={styles.body}>
        {heading}
        {error ? (
          <>
            <Notice text={t(error.key, error.params)} tone="danger" />
            <Button label={t('common:actions.retry')} onPress={() => void priceQ.refetch()} variant="secondary" fullWidth />
          </>
        ) : (
          <ActivityIndicator color={colors.ink} accessibilityLabel={t('common:state.loading')} style={styles.loading} />
        )}
      </View>
    );
  }

  if (view.kind === 'unavailable') {
    return (
      <View style={styles.body}>
        {heading}
        <Notice text={t(view.reason === 'mature' ? 'errors:mature_opt_in_required' : 'errors:not_available')} tone="danger" />
      </View>
    );
  }

  const coins = (count: number) => t('common:coins.count', { count });
  const config = pricingQ.data ?? DEFAULT_PRICING;
  const vip = unlockPrice(view.basePrice, 'plus', config);
  const showVipTeaser = !view.discounted && vip.price < view.price;
  const passes = view.freePasses;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body} bounces={false}>
      {heading}

      <View style={styles.row}>
        <Text variant="body" color="inkMuted">
          {t('unlock:price')}
        </Text>
        <CoinPrice coins={view.price} approx={null} strikethroughBase={view.discounted ? view.basePrice : null} />
      </View>
      {view.discounted ? (
        <Text variant="bodySmall" color="inkMuted" style={styles.line}>
          {t('unlock:discount', { percent: view.discountPct })}
        </Text>
      ) : null}
      {/* The balance line keeps its place while the wallet loads, so the buttons below never jump under a finger. */}
      {view.balance !== null ? (
        <Text variant="bodySmall" color="inkMuted" style={styles.line}>
          {t('unlock:youHave', { count: view.balance })}
        </Text>
      ) : walletQ.isPending ? (
        <View style={styles.line}>
          <Skeleton width={BALANCE_SKELETON_WIDTH} height={typeScale.bodySmall.lineHeight} />
        </View>
      ) : null}

      {view.priceChangedTo !== null ? <Notice text={t('unlock:priceChanged', { price: coins(view.priceChangedTo) })} tone="warn" /> : null}
      {errorText ? <Notice text={errorText} tone="danger" /> : null}

      <View style={styles.actions}>
        {view.debt > 0 ? (
          <>
            <Notice title={t('unlock:debt.title')} text={t('unlock:debt.body')} detail={t('unlock:debt.amount', { count: view.debt })} tone="warn" />
            <Button label={t('unlock:getCoins')} onPress={toWallet} fullWidth testID="unlock-get-coins" />
          </>
        ) : view.shortBy > 0 ? (
          <>
            <Notice text={t('unlock:notEnough', { count: view.shortBy })} tone="warn" />
            <Button label={t('unlock:getCoins')} onPress={toWallet} fullWidth testID="unlock-get-coins" />
          </>
        ) : (
          <>
            <Button
              label={t('unlock:unlockFor', { price: coins(view.price) })}
              onPress={() => onUnlockCoins(view.price)}
              loading={unlock.isPending}
              disabled={busy}
              fullWidth
              testID="unlock-coins"
            />
            {view.balanceAfter !== null ? (
              <Text variant="caption" color="inkMuted" align="center" style={styles.line}>
                {t('unlock:balanceAfter', { price: coins(view.balanceAfter) })}
              </Text>
            ) : null}
          </>
        )}

        <View style={styles.freePass}>
          {passes !== null && passes > 0 && failure?.kind !== 'no_free_pass' ? (
            <>
              <Button
                label={t('unlock:useFreePass')}
                onPress={onUseFreePass}
                variant="secondary"
                loading={freePass.isPending}
                disabled={busy}
                fullWidth
                testID="unlock-free-pass"
              />
              <Text variant="caption" color="inkMuted" align="center" style={styles.line}>
                {t('unlock:freePassesLeft', { count: passes })}
              </Text>
            </>
          ) : passes !== null ? (
            <Text variant="bodySmall" color="inkMuted" align="center">
              {failure?.kind === 'no_free_pass' ? t('unlock:freePass.used') : t('unlock:freePassesNone')}
            </Text>
          ) : null}
          <Text variant="caption" color="inkMuted" align="center" style={styles.line}>
            {t('unlock:freePass.body')}
          </Text>
        </View>
      </View>

      {showVipTeaser ? (
        <View style={styles.vip}>
          <Text variant="bodySmall" color="inkMuted">
            {t('unlock:vipPrice', { price: coins(vip.price) })}
          </Text>
          <TextLink label={t('unlock:joinVip')} role="link" onPress={() => { onClose(); router.push(VIP_ROUTE); }} />
        </View>
      ) : null}

      <Text variant="caption" color="inkMuted" align="center" style={styles.footer}>
        {t('unlock:permanent')}
      </Text>
    </ScrollView>
  );
}

/** A message in the sheet: ink text (readable at any size) with a coloured edge for its tone. */
function Notice({ title, text, detail, tone }: { title?: string; text: string; detail?: string; tone: 'warn' | 'danger' }) {
  return (
    <View
      style={[styles.notice, tone === 'warn' ? styles.noticeWarn : styles.noticeDanger]}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      {title ? <Text variant="body" style={styles.noticeTitle}>{title}</Text> : null}
      <Text variant="bodySmall">{text}</Text>
      {detail ? <Text variant="bodySmall" color="inkMuted">{detail}</Text> : null}
    </View>
  );
}

const NOTICE_EDGE = 4;
const BALANCE_SKELETON_WIDTH = 140;

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  body: { paddingBottom: space.sm },
  heading: { marginBottom: space.lg },
  aiBadge: { alignSelf: 'flex-start', marginBottom: space.xs },
  loading: { marginVertical: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  line: { marginTop: space.xs },
  actions: { marginTop: space.lg },
  freePass: { marginTop: space.lg },
  vip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginTop: space.lg,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  footer: { marginTop: space.lg },
  notice: {
    marginVertical: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderLeftWidth: NOTICE_EDGE,
    borderRadius: radius.chip,
    backgroundColor: colors.surfaceAlt,
  },
  noticeWarn: { borderLeftColor: colors.warn },
  noticeDanger: { borderLeftColor: colors.danger },
  noticeTitle: { marginBottom: space.xs },
});
