// The cards a page shows instead of (or over) the video: locked, not watchable, failed to load, and the
// demo notices. White cards with ink text, so they read the same over any poster.

import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button, CoinPrice, LockBadge, Text } from '../../../components/ui';
import type { EpisodeAccessView } from '../../../core/pricing';
import { colors, radius, space } from '../../../theme/tokens';

const CARD_MAX_WIDTH = 340;

export function LockedPanel({ view, onUnlock }: { view: EpisodeAccessView | null; onUnlock: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.center} pointerEvents="box-none">
      <View style={styles.card}>
        <LockBadge size="md" />
        <Text variant="subheading" accessibilityRole="header" style={styles.title}>
          {t('watch:poster.locked')}
        </Text>
        {view && view.state === 'locked' ? (
          <View style={styles.price}>
            <CoinPrice coins={view.price} approx={null} strikethroughBase={view.discounted ? view.basePrice : null} />
          </View>
        ) : null}
        <Button label={t('unlock:unlock')} onPress={onUnlock} fullWidth testID="watch-unlock" />
      </View>
    </View>
  );
}

export interface MessagePanelProps {
  message: string;
  action?: { label: string; onPress: () => void };
}

export function MessagePanel({ message, action }: MessagePanelProps) {
  return (
    <View style={styles.center} pointerEvents="box-none">
      <View style={styles.card}>
        <Text variant="body" align="center" accessibilityRole="alert">
          {message}
        </Text>
        {action ? (
          <View style={styles.action}>
            <Button label={action.label} onPress={action.onPress} variant="secondary" fullWidth />
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function LoadingPanel({ label }: { label: string }) {
  return (
    <View style={styles.center} pointerEvents="none">
      <ActivityIndicator size="large" color={colors.surface} accessibilityLabel={label} />
    </View>
  );
}

/** A small label over demo playback, so nobody mistakes the placeholder for the episode. */
export function DemoNotice({ label }: { label: string }) {
  return (
    <View style={styles.notice} pointerEvents="none">
      <Text variant="caption" color="surface">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  card: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    alignItems: 'center',
    padding: space.xl,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  title: { marginTop: space.md, textAlign: 'center' },
  price: { marginTop: space.sm, marginBottom: space.lg },
  action: { alignSelf: 'stretch', marginTop: space.lg },
  notice: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.chip,
    backgroundColor: colors.scrim,
  },
});
