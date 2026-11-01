import { Pressable, StyleSheet, View } from 'react-native';

import { AIBadge, Text } from '../../../components/ui';
import { fonts, space } from '../../../theme/tokens';
import { isAiSeries, type SeriesCard } from '../logic';
import { Cover } from './Cover';
import { MaturityMarker } from './MaturityMarker';
import { ProgressBar } from './ProgressBar';
import { useSeriesText } from './useSeriesText';

const COVER_WIDTH = 64;

export interface SeriesRowProps {
  series: SeriesCard;
  /** A line about what was watched, for example "Episode 3 · The Lamp". */
  detail?: string;
  /** Shows a bar and `progressLabel` when given (0 to 100). */
  percent?: number | null;
  progressLabel?: string;
  /** Read by screen readers instead of the default (title, format, status). */
  accessibilityLabel?: string;
  onPress: () => void;
}

/** A series in a list: small cover, title, what it is, and optionally how far along the reader is. */
export function SeriesRow({ series, detail, percent = null, progressLabel, accessibilityLabel, onPress }: SeriesRowProps) {
  const text = useSeriesText()(series);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? text.a11y}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Cover series={series} width={COVER_WIDTH} />
      <View style={styles.body}>
        <Text numberOfLines={2} style={styles.title}>
          {series.title}
        </Text>
        <Text variant="caption" color="inkMuted" numberOfLines={1}>
          {text.meta}
        </Text>
        {detail ? (
          <Text variant="bodySmall" color="inkMuted" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
        {percent !== null ? (
          <View style={styles.progress}>
            <ProgressBar percent={percent} />
            {progressLabel ? (
              <Text variant="caption" color="inkMuted">
                {progressLabel}
              </Text>
            ) : null}
          </View>
        ) : null}
        {isAiSeries(series) || series.maturity === 'mature' ? (
          <View style={styles.labels}>
            {isAiSeries(series) ? <AIBadge size="sm" /> : null}
            {series.maturity === 'mature' ? <MaturityMarker /> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.sm },
  pressed: { opacity: 0.7 },
  body: { flex: 1, gap: space.xs },
  title: { fontFamily: fonts.sansMedium },
  progress: { gap: space.xs, marginTop: space.xs },
  labels: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
});
