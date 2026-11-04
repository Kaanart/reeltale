import Ionicons from '@expo/vector-icons/Ionicons';
import type { StoryManifest } from '@reeltale/shared';
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { focusRing, useInteraction, useLayout } from '../../../components/layout';
import { Button, Text } from '../../../components/ui';
import { orderedPanels, panelIndexAt, planComic, revealPlan } from '../../../core/comic';
import { colors, fonts, layout, radius, space } from '../../../theme/tokens';
import { TextLink } from '../../auth';
import { panelStartMs, previousTarget, readingPaced, skipTarget, withLoadFailures, type PlayerShortcut } from '../logic';
import { usePanelSources } from '../usePanelSources';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import { useSceneClock } from '../useSceneClock';
import { ComicStage, STAGE_RATIO } from './ComicStage';
import { SceneTranscript } from './SceneTranscript';

// Plays one finished scene: the stage, play/pause and replay, the narration text, and (once the scene has
// played through, the reader skipped to the end, or it is a scene they have chosen from before) whatever
// comes after: the choices or the ending.
//
// Two layouts. 'stacked' (phones, the apps): everything in one column, the stage at most 62% of the window
// high. 'split' (a laptop-sized browser window): the stage as large as the window allows on the left, kept in
// view while the page scrolls, and beside it the title, the controls, the narration, the choices and a
// transcript of the panels so far. On the web the keys work in both: Space plays or pauses, the arrows step
// through the panels (logic.ts playerShortcut).
export interface ComicPlayerProps {
  sceneId: string;
  manifest: StoryManifest;
  /** Shown once the scene has played to the end, and kept after that. */
  after?: ReactNode;
  /** Show `after` from the start (a scene the reader has already chosen from). */
  showAfterAtOnce?: boolean;
  layout?: 'stacked' | 'split';
  /** At the top of the side column when split (the page head: back, story title, AI label, "How this was made"); above the scene title when stacked. */
  header?: ReactNode;
  /** At the bottom of the side column when split (report link); after everything when stacked. */
  footer?: ReactNode;
}

/** The stage never takes more than this share of the window height, so the controls stay in view. */
const MAX_STAGE_SHARE = 0.62;
/** Split: the side column never gets narrower than this; below it, or with a stage under MIN_SPLIT_STAGE, stack. */
const SPLIT_SIDE_MIN = layout.sidePanelWidth;
const MIN_SPLIT_STAGE = 240;
/** Start anyway if the first picture hasn't answered by then. */
const START_TIMEOUT_MS = 8000;
const ICON = 18;
const NAV_ICON = 22;
const NONE: readonly number[] = [];
// position: sticky is web-only, so React Native's style types don't list it.
const STICKY = { position: 'sticky', top: space.lg } as unknown as ViewStyle;

export function ComicPlayer({
  sceneId, manifest, after, showAfterAtOnce = false, layout: requested = 'stacked', header, footer,
}: ComicPlayerProps) {
  const { t } = useTranslation();
  const { height: windowHeight, hasTopNav } = useLayout();
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

  const toggle = () => {
    if (!started.current) start();
    else if (clock.ended) clock.replay();
    else if (clock.playing) clock.pause();
    else clock.play();
  };
  const next = () => clock.seek(skipTarget(plan.timeline, clock.positionMs));
  const previous = () => {
    started.current = true;
    clock.seek(previousTarget(plan.timeline, clock.positionMs));
  };
  const seekPanel = (i: number) => {
    started.current = true;
    clock.seek(panelStartMs(plan.timeline, i));
  };

  useKeyboardShortcuts((shortcut: PlayerShortcut) => {
    if (shortcut.action === 'toggle') toggle();
    else if (shortcut.action === 'previous') previous();
    else if (shortcut.action === 'next') next();
    else return false;
    return true;
  });

  // Split: as tall as the window allows below the top bar, leaving the side column its room.
  const splitStage = Math.floor(Math.min(
    (windowHeight - (hasTopNav ? layout.navHeight : 0) - space.xl * 2) / STAGE_RATIO,
    boxWidth - SPLIT_SIDE_MIN - space.xxl,
  ));
  // Until measured, assume the split fits (no flash of the stacked layout); the stage waits for the width.
  const split = requested === 'split' && (boxWidth === 0 || splitStage >= MIN_SPLIT_STAGE);
  const stageWidth = split
    ? Math.max(0, splitStage)
    : Math.max(0, Math.min(boxWidth, Math.floor((windowHeight * MAX_STAGE_SHARE) / STAGE_RATIO)));
  const index = panelIndexAt(plan.timeline, clock.positionMs);
  const anyFailed = sources.some((s) => s.failed);
  const showAfter = seenEnd || showAfterAtOnce;

  const onLayout = (e: LayoutChangeEvent) => setBoxWidth(Math.floor(e.nativeEvent.layout.width));

  const stage = stageWidth > 0 ? (
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
      onSkip={next}
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
  ) : null;

  const playButton = clock.ended ? (
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
      onPress={clock.playing ? clock.pause : toggle}
      variant="secondary"
      size="sm"
      icon={<Ionicons name={clock.playing ? 'pause' : 'play'} size={ICON} color={colors.ink} />}
      testID="story-play-pause"
    />
  );
  const panelCount = (
    <Text variant="bodySmall" color="inkMuted" style={styles.panelCount}>
      {t('story:player.panel', { current: index + 1, total: plan.panels.length })}
    </Text>
  );
  const retry = anyFailed ? (
    <View style={styles.retry}>
      <Text variant="bodySmall" color="inkMuted">
        {t('story:player.imageFailed')}
      </Text>
      <TextLink label={t('common:actions.retry')} onPress={() => setAttempt((a) => a + 1)} testID="story-image-retry" />
    </View>
  ) : null;
  const narration = manifest.narration.text.trim() !== '' ? (
    <View style={styles.narration}>
      <Text variant="caption" color="inkMuted" style={styles.narrationLabel}>
        {t('story:player.narration')}
      </Text>
      <Text variant="body" style={styles.narrationText}>
        {manifest.narration.text}
      </Text>
    </View>
  ) : null;

  if (split) {
    return (
      <View onLayout={onLayout} style={styles.split} testID="story-player-split">
        <View style={[{ width: stageWidth }, Platform.OS === 'web' && STICKY]}>{stage}</View>
        <View style={styles.side}>
          {header}
          <Text variant="title" accessibilityRole="header" style={styles.splitTitle}>
            {manifest.title}
          </Text>
          <View style={styles.splitControls}>
            <NavButton icon="chevron-back" label={t('story:player.previousPanel')} onPress={previous} testID="story-previous" />
            {playButton}
            <NavButton icon="chevron-forward" label={t('story:player.nextPanel')} onPress={next} disabled={clock.ended} testID="story-next" />
            {panelCount}
          </View>
          <Text variant="caption" color="inkMuted" style={styles.keys}>
            {t('story:player.keysHint')}
          </Text>
          {retry}
          {narration}
          <View style={styles.after}>
            {showAfter ? after : (
              <View style={styles.wait}>
                <Text variant="bodySmall" color="inkMuted">
                  {t('story:player.choicesAfter')}
                </Text>
                <TextLink label={t('story:player.skipToChoices')} onPress={() => clock.seek(plan.timeline.totalMs)} testID="story-skip-to-choices" />
              </View>
            )}
          </View>
          <View style={styles.transcript}>
            <SceneTranscript
              manifest={manifest}
              steps={steps}
              positionMs={clock.positionMs}
              current={index}
              showAll={showAfter}
              onSeek={seekPanel}
            />
          </View>
          {footer}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root} onLayout={onLayout}>
      {header ? <View style={styles.stackedHeader}>{header}</View> : null}
      <View style={styles.titles}>
        <Text variant="heading" accessibilityRole="header">
          {manifest.title}
        </Text>
      </View>

      <View style={styles.stageBox}>{stage}</View>

      <View style={styles.controls}>
        {playButton}
        {panelCount}
      </View>
      {retry}
      {narration}

      {showAfter ? <View style={styles.after}>{after}</View> : null}
      {footer}
    </View>
  );
}

function NavButton({ icon, label, onPress, disabled = false, testID }: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  const { hovered, focusVisible, handlers } = useInteraction();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      {...handlers}
      style={({ pressed }) => [
        styles.nav,
        (hovered || pressed) && !disabled && styles.navHover,
        disabled && styles.navDisabled,
        focusVisible && focusRing,
      ]}
      testID={testID}
    >
      <Ionicons name={icon} size={NAV_ICON} color={colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%' },
  titles: { marginBottom: space.md },
  stackedHeader: { marginBottom: space.lg },
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
  split: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xxl, width: '100%' },
  side: { flex: 1, minWidth: 0 },
  splitTitle: { marginTop: space.sm },
  splitControls: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  keys: { marginTop: space.sm },
  nav: {
    width: layout.minTarget,
    height: layout.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  navHover: { backgroundColor: colors.surfaceAlt },
  navDisabled: { opacity: 0.4 },
  wait: {
    padding: space.lg,
    gap: space.xs,
    alignItems: 'flex-start',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
  },
  transcript: { marginTop: space.xl },
});
