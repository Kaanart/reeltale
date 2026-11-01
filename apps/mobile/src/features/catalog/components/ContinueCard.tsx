import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AIBadge, Text } from '../../../components/ui';
import { colors, fonts, radius, space } from '../../../theme/tokens';
import { isAiSeries, type HistoryEntry } from '../logic';
import { Cover } from './Cover';
import { MaturityMarker } from './MaturityMarker';
import { ProgressBar } from './ProgressBar';
import { useSeriesText } from './useSeriesText';

export const CONTINUE_CARD_WIDTH = 264;
const COVER_WIDTH = 72;

/** An episode to pick up again: cover, series, which episode and how far in. */
export function ContinueCard({ entry, onPress }: { entry: HistoryEntry; onPress: (entry: HistoryEntry) => void }) {
  const { t } = useTranslation();
  const { labels } = useSeriesText()(entry.series);
  const episodeLabel = t('common:episode.number', { number: entry.episode.number });
  const progress = t('home:home.progress', { percent: entry.percent });
  const ai = isAiSeries(entry.series);
  const mature = entry.series.maturity === 'mature';
  return (
    <Pressable
      onPress={() => onPress(entry)}
      accessibilityRole="button"
      // The badges inside are hidden behind this label, so it names them too.
      accessibilityLabel={[
        t('home:home.continueA11y', { title: entry.series.title, episode: episodeLabel, progress }),
        ...labels,
      ].join(', ')}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Cover series={entry.series} width={COVER_WIDTH} />
      <View style={styles.body}>
        <Text numberOfLines={2} style={styles.title}>
          {entry.series.title}
        </Text>
        <Text variant="bodySmall" color="inkMuted" numberOfLines={1}>
          {episodeLabel}
        </Text>
        <ProgressBar percent={entry.percent} />
        <Text variant="caption" color="inkMuted">
          {progress}
        </Text>
        {ai || mature ? (
          <View style={styles.labels}>
            {ai ? <AIBadge size="sm" /> : null}
            {mature ? <MaturityMarker /> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CONTINUE_CARD_WIDTH,
    flexDirection: 'row',
    gap: space.md,
    padding: space.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.7 },
  body: { flex: 1, justifyContent: 'center', gap: space.xs },
  title: { fontFamily: fonts.sansMedium },
  labels: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs },
});
