// What shows when an episode ends (logic/next.ts): the next episode with a short countdown the viewer can
// stop, or, when the next one is locked, just the way there (its page offers the unlock; nothing is unlocked
// by itself). After the last episode: "You're all caught up" and the way back to the series.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Button, Text } from '../../../components/ui';
import type { EpisodeRow } from '../../../lib/types';
import { colors, radius, space } from '../../../theme/tokens';
import { useEpisodePrice } from '../hooks';
import { pageAccess, watchAccessView } from '../logic/access';
import { endOffer, NEXT_COUNTDOWN_S, secondsLeft } from '../logic/next';

const CARD_MAX_WIDTH = 340;
const TICK_MS = 250;

export interface EndOverlayProps {
  /** The page that ended. */
  index: number;
  episodes: readonly EpisodeRow[];
  /** The countdown only runs while the player is in front. */
  inFront: boolean;
  onNext: (index: number) => void;
  /** Close the overlay and stay on the finished episode (a tap on it replays). */
  onStay: () => void;
  onBackToSeries: () => void;
}

export function EndOverlay({ index, episodes, inFront, onNext, onStay, onBackToSeries }: EndOverlayProps) {
  const next = episodes[index + 1];
  return (
    <View style={styles.overlay}>
      <View style={styles.card} accessibilityViewIsModal>
        {next ? (
          <UpNext index={index} count={episodes.length} next={next} inFront={inFront} onNext={onNext} onStay={onStay} />
        ) : (
          <CaughtUp onBackToSeries={onBackToSeries} onClose={onStay} />
        )}
      </View>
    </View>
  );
}

function UpNext({ index, count, next, inFront, onNext, onStay }: {
  index: number;
  count: number;
  next: EpisodeRow;
  inFront: boolean;
  onNext: (index: number) => void;
  onStay: () => void;
}) {
  const { t } = useTranslation();
  // The next page is a neighbour, so this is the same (cached) price check its page already made.
  const priceQ = useEpisodePrice(next.id, true);
  const access = pageAccess(watchAccessView(priceQ.data, next));
  const offer = endOffer(index, count, access);
  const counting = offer.kind === 'next' && offer.countdown && inFront;
  const locked = offer.kind === 'next' && offer.locked;

  const [left, setLeft] = useState(NEXT_COUNTDOWN_S);
  const go = useRef(() => onNext(index + 1));
  go.current = () => onNext(index + 1);

  useEffect(() => {
    setLeft(NEXT_COUNTDOWN_S);
    if (!counting) return undefined;
    AccessibilityInfo.announceForAccessibility(t('watch:next.countdown', { seconds: NEXT_COUNTDOWN_S }));
    const started = Date.now();
    const timer = setInterval(() => {
      const s = secondsLeft(started, Date.now());
      setLeft(s);
      if (s <= 0) {
        clearInterval(timer);
        go.current();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [counting, t]);

  let status: string | null = null;
  if (counting) status = t('watch:next.countdown', { seconds: left });
  else if (locked) status = t('watch:next.locked');

  return (
    <>
      <Text variant="bodySmall" color="inkMuted" align="center">
        {t('watch:next.title')}
      </Text>
      <Text variant="subheading" align="center" accessibilityRole="header" numberOfLines={2} style={styles.title}>
        {t('watch:next.episode', { number: next.number, title: next.title })}
      </Text>
      {status ? (
        <Text variant="body" align="center" style={styles.status}>
          {status}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button label={t('watch:next.label')} onPress={() => go.current()} fullWidth testID="watch-next" />
        <View style={styles.gap} />
        <Button label={t('watch:next.cancel')} onPress={onStay} variant="secondary" fullWidth testID="watch-stay" />
      </View>
    </>
  );
}

function CaughtUp({ onBackToSeries, onClose }: { onBackToSeries: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <Text variant="subheading" align="center" accessibilityRole="header">
        {t('watch:end.title')}
      </Text>
      <Text variant="body" color="inkMuted" align="center" style={styles.status}>
        {t('watch:end.body')}
      </Text>
      <View style={styles.actions}>
        <Button label={t('watch:end.backToSeries')} onPress={onBackToSeries} fullWidth testID="watch-back-to-series" />
        <View style={styles.gap} />
        <Button label={t('common:actions.close')} onPress={onClose} variant="secondary" fullWidth testID="watch-end-close" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  // Covers the pager (not the top bar): taps land here, not on the finished video underneath.
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    backgroundColor: colors.scrim,
  },
  card: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    padding: space.xl,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  title: { marginTop: space.xs },
  status: { marginTop: space.sm },
  actions: { marginTop: space.lg },
  gap: { height: space.sm },
});
