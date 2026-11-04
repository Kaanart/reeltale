import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { focusRing, useInteraction } from '../../../components/layout';
import { CoinPrice, LockBadge, Skeleton, Text } from '../../../components/ui';
import { colors, fonts, space } from '../../../theme/tokens';
import { useEpisodePrice } from '../hooks';
import { episodeState, freeByRule, type EpisodeItem, type EpisodeState } from '../logic';
import type { SeriesRow } from '../../../lib/types';

const MIN_HEIGHT = 56;

export interface EpisodeRowProps {
  series: Pick<SeriesRow, 'status' | 'free_episode_count' | 'format' | 'editors_pick'>;
  episode: EpisodeItem;
  onPress: (episode: EpisodeItem) => void;
  /** To move the keyboard focus here (the wide series page, after Show more). */
  ref?: Ref<View>;
}

/**
 * One episode of the list. The server decides what is free, unlocked or priced (get_episode_price); episodes
 * that are free by the series' own rule skip that request. Nothing here can buy anything: a tap opens the
 * watch screen, which shows the unlock sheet.
 */
export function EpisodeRow({ series, episode, onPress, ref }: EpisodeRowProps) {
  const { t } = useTranslation();
  const obviouslyFree = freeByRule(series, episode);
  const priceQuery = useEpisodePrice(episode.id, !obviouslyFree);
  const { hovered, focusVisible, handlers } = useInteraction();
  const price = priceQuery.data;
  const state: EpisodeState | null = obviouslyFree ? 'free' : price ? episodeState(price) : null;

  const title = episode.title.trim() || t('common:episode.number', { number: episode.number });
  const stateA11y =
    state === 'free' ? t('series:episodeRow.freeA11y')
    : state === 'unlocked' ? t('series:episodeRow.unlockedA11y')
    : state === 'priced' && price ? t('series:episodeRow.unlockA11y', { coins: price.price })
    : state === 'locked' ? t('common:episode.locked')
    : null;
  const label = [t('common:episode.number', { number: episode.number }), episode.title.trim(), stateA11y]
    .filter((part): part is string => !!part)
    .join(', ');

  return (
    <Pressable
      ref={ref}
      {...handlers}
      onPress={() => onPress(episode)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, hovered && styles.hovered, pressed && styles.pressed, focusVisible && focusRing]}
    >
      <Text variant="subheading" color="inkMuted" style={styles.number} accessible={false}>
        {episode.number}
      </Text>
      <View style={styles.main}>
        <Text numberOfLines={2} style={[styles.title, hovered && styles.titleHover]}>
          {title}
        </Text>
        {episode.duration_s ? (
          <Text variant="caption" color="inkMuted">
            {t('common:episode.duration', { seconds: episode.duration_s })}
          </Text>
        ) : null}
      </View>
      <View style={styles.state}>
        {state === 'free' ? (
          <Text variant="bodySmall" color="inkMuted">
            {t('common:episode.free')}
          </Text>
        ) : state === 'unlocked' ? (
          <Text variant="bodySmall" color="inkMuted">
            {t('common:episode.unlocked')}
          </Text>
        ) : state === 'priced' && price ? (
          <View style={styles.priced}>
            <LockBadge size="sm" />
            <CoinPrice
              coins={price.price}
              approx={null}
              size="sm"
              strikethroughBase={price.discount_pct > 0 ? price.base_price : null}
            />
          </View>
        ) : state === 'locked' ? (
          <LockBadge size="sm" label={t('common:episode.locked')} />
        ) : priceQuery.isPending ? (
          <Skeleton width={64} height={16} />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: MIN_HEIGHT,
    paddingVertical: space.sm,
    // The hover background reaches a little past the text, which stays lined up with the page.
    paddingHorizontal: space.sm,
    marginHorizontal: -space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  // Muted text on surfaceAlt stays above 4.5:1.
  hovered: { backgroundColor: colors.surfaceAlt },
  pressed: { opacity: 0.7 },
  number: { width: 28, textAlign: 'center' },
  main: { flex: 1 },
  title: { fontFamily: fonts.sansMedium },
  titleHover: { textDecorationLine: 'underline' },
  state: { alignItems: 'flex-end', justifyContent: 'center' },
  priced: { alignItems: 'flex-end', gap: space.xs },
});
