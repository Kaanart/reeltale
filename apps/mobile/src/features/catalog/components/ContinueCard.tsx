import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { focusRing } from '../../../components/layout';
import { AIBadge, Text } from '../../../components/ui';
import { colors, fonts, radius, space } from '../../../theme/tokens';
import { isAiSeries, type HistoryEntry } from '../logic';
import { routes } from '../routes';
import { CardLink } from './CardLink';
import { Cover } from './Cover';
import { MaturityMarker } from './MaturityMarker';
import { ProgressBar } from './ProgressBar';
import { useSeriesText } from './useSeriesText';

export const CONTINUE_CARD_WIDTH = 264;
const COVER_WIDTH = 72;

/** An episode to pick up again: cover, series, which episode and how far in. Opens the player (a link on the web). */
export function ContinueCard({ entry, width = CONTINUE_CARD_WIDTH }: { entry: HistoryEntry; width?: number }) {
  const { t } = useTranslation();
  const { labels } = useSeriesText()(entry.series);
  const episodeLabel = t('common:episode.number', { number: entry.episode.number });
  const progress = t('home:home.progress', { percent: entry.percent });
  const ai = isAiSeries(entry.series);
  const mature = entry.series.maturity === 'mature';
  return (
    <CardLink
      href={routes.watch(entry.episode.id)}
      // The badges inside are hidden behind this label, so it names them too.
      accessibilityLabel={[
        t('home:home.continueA11y', { title: entry.series.title, episode: episodeLabel, progress }),
        ...labels,
      ].join(', ')}
      cardStyle={(s) => [
        styles.card,
        { width },
        s.hovered && styles.hovered,
        s.pressed && styles.pressed,
        s.focusVisible && focusRing,
      ]}
      render={(s) => (
        <>
          <Cover series={entry.series} width={COVER_WIDTH} />
          <View style={styles.body}>
            <Text numberOfLines={2} style={[styles.title, s.hovered && styles.titleHover]}>
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
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    // Fills its slot, so every card in a row is as tall as the tallest (one with labels is taller).
    flexGrow: 1,
    flexDirection: 'row',
    gap: space.md,
    padding: space.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  hovered: { borderColor: colors.inkMuted },
  pressed: { opacity: 0.7 },
  body: { flex: 1, justifyContent: 'center', gap: space.xs },
  title: { fontFamily: fonts.sansMedium },
  titleHover: { textDecorationLine: 'underline' },
  labels: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs },
});
