import Ionicons from '@expo/vector-icons/Ionicons';
import type { StoryManifest } from '@reeltale/shared';
import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, FadeIn, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';

import { Text } from '../../../components/ui';
import { orderedPanels, panelIndexAt, type ComicPlan, type KenBurns, type RevealStep } from '../../../core/comic';
import { colors, fonts, motion, radius, space } from '../../../theme/tokens';
import { visibleText } from '../logic';
import type { PanelImageSource, PanelSource } from '../panelSource';

// The living-comic stage: the four panels stacked and cross-faded, each with a gentle Ken Burns zoom on
// its subject (core/comic.ts; runs on the UI thread), the caption in the band that keeps the subject
// clear, and the dialogue as speech bubbles with the speaker's name. Text appears on the scene clock
// (revealPlan). Tapping skips to the next panel. With reduced motion the pictures stay still.

export interface ComicStageProps {
  manifest: StoryManifest;
  plan: ComicPlan;
  steps: readonly RevealStep[];
  sources: readonly PanelSource[];
  positionMs: number;
  playing: boolean;
  /** Changes when the clock jumps or starts/stops (useSceneClock). */
  epoch: number;
  /** Stage width in px; the stage is 9:16. */
  width: number;
  reducedMotion: boolean;
  onSkip: () => void;
  onImageSettled: (index: number, ok: boolean) => void;
}

/** 9:16, like the panels. */
export const STAGE_RATIO = 16 / 9;
const ICON = 32;

export function ComicStage(props: ComicStageProps) {
  const { manifest, plan, steps, sources, positionMs, playing, epoch, width, reducedMotion, onSkip, onImageSettled } = props;
  const { t } = useTranslation();
  const height = Math.round(width * STAGE_RATIO);
  const panels = orderedPanels(manifest);
  const index = panelIndexAt(plan.timeline, positionMs);
  const panel = panels[index];
  const panelPlan = plan.panels[index];
  const shown = panel ? visibleText(steps, panel.n, positionMs) : { caption: false, lines: [] };

  // What a screen reader hears for the stage: the current panel's words, in reading order.
  const spoken = panel
    ? [panel.caption, ...panel.dialogue.map((d) => t('story:player.speakerLine', { name: d.name, line: d.line }))]
      .filter((s) => s.trim() !== '').join(' ')
    : '';

  return (
    <Pressable
      onPress={onSkip}
      accessibilityRole="button"
      accessibilityLabel={spoken || t('story:player.tapToSkip')}
      accessibilityHint={t('story:player.tapToSkip')}
      style={[styles.stage, { width, height }]}
      testID="story-stage"
    >
      {panels.map((p, i) => (
        <PanelLayer
          key={p.n}
          source={sources[i]?.source ?? null}
          failed={sources[i]?.failed ?? false}
          kenBurns={plan.panels[i]?.kenBurns ?? null}
          active={i === index}
          startMs={plan.panels[i]?.startMs ?? 0}
          durationMs={plan.panels[i]?.durationMs ?? 0}
          positionMs={positionMs}
          playing={playing}
          epoch={epoch}
          width={width}
          height={height}
          still={reducedMotion}
          onSettled={(ok) => onImageSettled(i, ok)}
        />
      ))}

      {panel && panelPlan ? (
        <View
          pointerEvents="none"
          style={[styles.band, panelPlan.caption === 'top' ? styles.bandTop : styles.bandBottom]}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {shown.caption && panel.caption.trim() !== '' ? (
            <Animated.View key={`c${panel.n}`} entering={FadeIn.duration(motion.base)} style={styles.caption}>
              <Text variant="bodySmall" color="surface">
                {panel.caption}
              </Text>
            </Animated.View>
          ) : null}
          {shown.lines.map((line) => {
            const d = panel.dialogue[line];
            if (!d || d.line.trim() === '') return null;
            return (
              <Animated.View key={`d${panel.n}-${line}`} entering={FadeIn.duration(motion.base)} style={[styles.bubble, line % 2 === 1 && styles.bubbleRight]}>
                {d.name.trim() !== '' ? (
                  <Text variant="caption" color="ai" style={styles.speaker}>
                    {d.name}
                  </Text>
                ) : null}
                <Text variant="bodySmall">{d.line}</Text>
              </Animated.View>
            );
          })}
        </View>
      ) : null}
      {sources[index]?.failed ? (
        <View style={styles.center} pointerEvents="none">
          <Ionicons name="image-outline" size={ICON} color={colors.surface} />
          <Text variant="bodySmall" color="surface" style={styles.centerText}>
            {t('story:player.imageFailed')}
          </Text>
        </View>
      ) : !sources[index]?.source ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={colors.surface} accessibilityLabel={t('story:player.loading')} />
        </View>
      ) : null}
    </Pressable>
  );
}

interface PanelLayerProps {
  source: PanelImageSource | null;
  failed: boolean;
  kenBurns: KenBurns | null;
  active: boolean;
  startMs: number;
  durationMs: number;
  positionMs: number;
  playing: boolean;
  epoch: number;
  width: number;
  height: number;
  still: boolean;
  onSettled: (ok: boolean) => void;
}

const IDENTITY = { scale: 1, translateX: 0, translateY: 0 };

function PanelLayer({
  source, failed, kenBurns, active, startMs, durationMs, positionMs, playing, epoch, width, height, still, onSettled,
}: PanelLayerProps) {
  const progress = useSharedValue(0);
  const opacity = useSharedValue(active ? 1 : 0);
  // Read when the animation (re)starts, not on every tick of the clock.
  const position = useRef(positionMs);
  position.current = positionMs;

  useEffect(() => {
    opacity.value = still ? (active ? 1 : 0) : withTiming(active ? 1 : 0, { duration: motion.slow });
  }, [active, still, opacity]);

  useEffect(() => {
    cancelAnimation(progress);
    if (!active) {
      progress.value = 0;
      return;
    }
    const at = durationMs > 0 ? Math.min(1, Math.max(0, (position.current - startMs) / durationMs)) : 1;
    progress.value = at;
    if (playing && !still && at < 1) {
      progress.value = withTiming(1, { duration: (1 - at) * durationMs, easing: Easing.linear });
    }
  }, [active, playing, epoch, still, startMs, durationMs, progress]);

  const from = still || !kenBurns ? IDENTITY : kenBurns.from;
  const to = still || !kenBurns ? IDENTITY : kenBurns.to;
  const animated = useAnimatedStyle(() => {
    const p = progress.value;
    const scale = from.scale + (to.scale - from.scale) * p;
    const x = from.translateX + (to.translateX - from.translateX) * p;
    const y = from.translateY + (to.translateY - from.translateY) * p;
    // Translation first, in stage pixels, then the scale about the centre (core/comic.ts toPixelTransform).
    return { opacity: opacity.value, transform: [{ translateX: x * width }, { translateY: y * height }, { scale }] };
  });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, animated]} pointerEvents="none">
      {source && !failed ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          // Private pictures stay in memory only: never written to the device's disk, where they would outlast sign-out.
          cachePolicy="memory"
          transition={0}
          accessible={false}
          onLoad={() => onSettled(true)}
          onError={() => onSettled(false)}
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: radius.card,
    backgroundColor: colors.playerBg,
  },
  band: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    gap: space.sm,
  },
  bandTop: { top: space.md },
  bandBottom: { bottom: space.md },
  caption: {
    alignSelf: 'stretch',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.chip,
    backgroundColor: colors.scrim,
  },
  bubble: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  bubbleRight: { alignSelf: 'flex-end' },
  speaker: { fontFamily: fonts.sansBold },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  centerText: { marginTop: space.sm, textAlign: 'center' },
});
