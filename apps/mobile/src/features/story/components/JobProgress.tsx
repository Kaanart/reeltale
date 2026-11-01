import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Text } from '../../../components/ui';
import { stepsFor } from '../../../core/jobs';
import { colors, radius, space } from '../../../theme/tokens';
import type { SceneView } from '../logic';

// While a scene is made: the steps of the job (planning and casting only for a story's first scene),
// a bar that never goes backwards, and the step announced to screen readers as it changes.
export interface JobProgressProps {
  view: SceneView;
}

const BAR = 6;
const ICON = 20;

export function JobProgress({ view }: JobProgressProps) {
  const { t } = useTranslation();
  const steps = stepsFor(view.kind).filter((s) => s !== 'ready');
  const current = view.job.step ? steps.indexOf(view.job.step as (typeof steps)[number]) : -1;
  const label = t(view.job.key);
  const announce = current >= 0
    ? t('ai:stepsA11y', { current: current + 1, total: steps.length, label })
    : label;

  return (
    <View style={styles.card} testID="story-progress">
      <Text variant="heading" accessibilityRole="header">
        {t(view.kind === 'story_start' ? 'story:new.starting.title' : 'story:player.makingScene')}
      </Text>
      <Text color="inkMuted" style={styles.body}>
        {t('story:new.starting.body')}
      </Text>

      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityLabel={announce}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(view.job.fraction * 100) }}
      >
        <View style={[styles.fill, { width: `${Math.round(view.job.fraction * 100)}%` }]} />
      </View>
      <Text variant="bodySmall" accessibilityLiveRegion="polite" style={styles.now}>
        {announce}
      </Text>

      <View style={styles.steps}>
        {steps.map((step, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <View key={step} style={styles.step} accessible accessibilityLabel={t(`ai:progress.${step}`)} accessibilityState={{ selected: active }}>
              <View style={styles.icon}>
                {done ? (
                  <Ionicons name="checkmark-circle" size={ICON} color={colors.success} />
                ) : active ? (
                  <ActivityIndicator size="small" color={colors.ai} />
                ) : (
                  <Ionicons name="ellipse-outline" size={ICON} color={colors.line} />
                )}
              </View>
              <Text variant="bodySmall" color={done || active ? 'ink' : 'inkMuted'}>
                {t(`ai:progress.${step}`)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  body: { marginTop: space.sm },
  track: {
    height: BAR,
    marginTop: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  fill: { height: BAR, borderRadius: radius.pill, backgroundColor: colors.ai },
  now: { marginTop: space.sm },
  steps: { marginTop: space.md, gap: space.sm },
  step: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: ICON + space.sm, alignItems: 'flex-start' },
});
