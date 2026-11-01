import Ionicons from '@expo/vector-icons/Ionicons';
import type { StoryManifest } from '@reeltale/shared';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Button, Text } from '../../../components/ui';
import { orderedPanels, panelIndexAt, planComic, revealPlan } from '../../../core/comic';
import { colors, fonts, radius, space } from '../../../theme/tokens';
import { TextLink } from '../../auth';
import { readingPaced, skipTarget, withLoadFailures } from '../logic';
import { usePanelSources } from '../usePanelSources';
import { useSceneClock } from '../useSceneClock';
import { ComicStage, STAGE_RATIO } from './ComicStage';

// Plays one finished scene: the stage, play/pause and replay, the narration text, and (once the scene has
// played through, the reader skipped to the end, or it is a scene they have chosen from before) whatever
// comes after: the choices or the ending.
export interface ComicPlayerProps {
  sceneId: string;
  manifest: StoryManifest;
  /** Shown once the scene has played to the end, and kept after that. */
  after?: ReactNode;
  /** Show `after` from the start (a scene the reader has already chosen from). */
  showAfterAtOnce?: boolean;
}

/** The stage never takes more than this share of the window height, so the controls stay in view. */
const MAX_STAGE_SHARE = 0.62;
/** Start anyway if the first picture hasn't answered by then. */
const START_TIMEOUT_MS = 8000;
const ICON = 18;
const NONE: readonly number[] = [];

export function ComicPlayer({ sceneId, manifest, after, showAfterAtOnce = false }: ComicPlayerProps) {
  const { t } = useTranslation();
  const { height: windowHeight } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [boxWidth, setBoxWidth] = useState(0);
  const [attempt, setAttempt] = useState(0);
  // Panels whose picture the image view couldn't show, for the current attempt (a retry starts clean).
  const [loadFailures, setLoadFailures] = useState<{ attempt: number; panels: readonly number[] }>({ attempt: 0, panels: NONE });
  const [seenEnd, setSeenEnd] = useState(false);
  const started = useRef(false);

  const paced = useMemo(() => readingPaced(manifest), [manifest]);
  const plan = useMemo(() => planComic(paced), [paced]);
  const steps = useMemo(() => revealPlan(paced), [paced]);
  const keys = useMemo(() => orderedPanels(manifest).map((p) => p.image), [manifest]);
  const fetched = usePanelSources(sceneId, keys, attempt);
  const failedNow = loadFailures.attempt === attempt ? loadFailures.panels : NONE;
  const sources = useMemo(() => withLoadFailures(fetched, failedNow), [fetched, failedNow]);
  const clock = useSceneClock(plan.timeline.totalMs);
  const { play } = clock;

  const start = () => {
    if (started.current) return;
    started.current = true;
    play();
  };

  // The first picture decides when the scene starts; a slow network doesn't hold it forever.
  useEffect(() => {
    const id = setTimeout(() => {
      if (!started.current) {
        started.current = true;
        play();
      }
    }, START_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [play]);
  useEffect(() => {
    if (sources[0]?.failed && !started.current) {
      started.current = true;
      play();
    }
  }, [sources, play]);

  useEffect(() => {
    if (clock.ended) setSeenEnd(true);
  }, [clock.ended]);

  const stageWidth = Math.max(0, Math.min(boxWidth, Math.floor((windowHeight * MAX_STAGE_SHARE) / STAGE_RATIO)));
  const index = panelIndexAt(plan.timeline, clock.positionMs);
  const anyFailed = sources.some((s) => s.failed);

  const onLayout = (e: LayoutChangeEvent) => setBoxWidth(Math.floor(e.nativeEvent.layout.width));

  return (
    <View style={styles.root}>
      <View style={styles.titles}>
        <Text variant="heading" accessibilityRole="header">
          {manifest.title}
        </Text>
      </View>

      <View onLayout={onLayout} style={styles.stageBox}>
        {stageWidth > 0 ? (
          <ComicStage
            manifest={manifest}
            plan={plan}
            steps={steps}
            sources={sources}
            positionMs={clock.positionMs}
            playing={clock.playing}
            epoch={clock.epoch}
            width={stageWidth}
            reducedMotion={reducedMotion}
            onSkip={() => clock.seek(skipTarget(plan.timeline, clock.positionMs))}
            onImageSettled={(i, ok) => {
              if (!ok) {
                setLoadFailures((prev) => {
                  const panels = prev.attempt === attempt ? prev.panels : NONE;
                  return panels.includes(i) ? prev : { attempt, panels: [...panels, i] };
                });
              }
              if (i === 0) start();
            }}
          />
        ) : null}
      </View>

      <View style={styles.controls}>
        {clock.ended ? (
          <Button
            label={t('story:player.replay')}
            onPress={clock.replay}
            variant="secondary"
            size="sm"
            icon={<Ionicons name="refresh" size={ICON} color={colors.ink} />}
            testID="story-replay"
          />
        ) : (
          <Button
            label={t(clock.playing ? 'story:player.pause' : 'story:player.play')}
            onPress={clock.playing ? clock.pause : clock.play}
            variant="secondary"
            size="sm"
            icon={<Ionicons name={clock.playing ? 'pause' : 'play'} size={ICON} color={colors.ink} />}
            testID="story-play-pause"
          />
        )}
        <Text variant="bodySmall" color="inkMuted" style={styles.panelCount}>
          {t('story:player.panel', { current: index + 1, total: plan.panels.length })}
        </Text>
      </View>
      {anyFailed ? (
        <View style={styles.retry}>
          <Text variant="bodySmall" color="inkMuted">
            {t('story:player.imageFailed')}
          </Text>
          <TextLink label={t('common:actions.retry')} onPress={() => setAttempt((a) => a + 1)} testID="story-image-retry" />
        </View>
      ) : null}

      {manifest.narration.text.trim() !== '' ? (
        <View style={styles.narration}>
          <Text variant="caption" color="inkMuted" style={styles.narrationLabel}>
            {t('story:player.narration')}
          </Text>
          <Text variant="body" style={styles.narrationText}>
            {manifest.narration.text}
          </Text>
        </View>
      ) : null}

      {seenEnd || showAfterAtOnce ? <View style={styles.after}>{after}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%' },
  titles: { marginBottom: space.md },
  stageBox: { width: '100%', alignItems: 'center' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.md,
  },
  panelCount: { marginLeft: space.md },
  retry: { flexDirection: 'row', alignItems: 'center', marginTop: space.sm, gap: space.sm },
  narration: {
    marginTop: space.lg,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceAlt,
  },
  narrationLabel: { marginBottom: space.xs },
  narrationText: { fontFamily: fonts.serif },
  after: { marginTop: space.xl },
});
