// One page of the pager: one episode, full screen. What it renders depends on its role (logic/pager.ts):
// the visible page and its neighbours check the price and, only if the episode may be watched, ask for a
// playback URL and mount a player (the neighbours paused); further pages show the poster or nothing.
// A locked episode never asks for playback: it shows the poster and the way to the unlock sheet.
//
// Pausing is held by the screen (one paused episode at most), so a keyboard shortcut can pause too. On a wide
// browser window (`theater`) the sound and caption buttons live in the side panel instead of on the video,
// and the video keeps only the AI label and the progress bar; the page reports what it can control upward.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { Image, type ImageSource } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';

import { AIBadge, Text } from '../../../components/ui';
import { describeError, errorCodeOf } from '../../../core/errors';
import { demoCover } from '../../../demo';
import { isDemo } from '../../../lib/data';
import { MEDIA_ORIGIN } from '../../../lib/env';
import type { EpisodeRow, SeriesRow } from '../../../lib/types';
import { colors, motion, radius, space } from '../../../theme/tokens';
import { useUserId } from '../../auth';
import { useEpisodePrice, usePlayback, watchKeys } from '../hooks';
import { isAiContent, mayRequestPlayback, pageAccess, watchAccessView } from '../logic/access';
import { mediaUrl } from '../logic/media';
import { holdsPlayer, type PageRole } from '../logic/pager';
import { useProgressSaver } from '../useProgressSaver';
import { IconButton } from './IconButton';
import { DemoNotice, LoadingPanel, LockedPanel, MessagePanel } from './PagePanels';
import { ProgressBar } from './ProgressBar';
import { VideoSurface } from './VideoSurface';
import type { ActiveControls } from './WatchPanel';

const PLAY_ICON_SIZE = 64;
const SETTINGS_ROUTE = '/settings' as string as Href;

export interface EpisodePageProps {
  episode: EpisodeRow;
  series: SeriesRow;
  role: PageRole;
  height: number;
  /** The width of the player column (the whole width on a phone; a 9:16 column on a wide window). */
  columnWidth: number;
  /** The player screen is in front and the app is active (not behind the wallet, not in the background). */
  inFront: boolean;
  muted: boolean;
  captions: boolean;
  /** The viewer paused this episode (the screen forgets it when another page becomes visible). */
  paused: boolean;
  /** Seconds to resume from (logic/progress.ts resumePosition). */
  startAt: number;
  /** The episode the screen was opened on: offer the unlock sheet once if it's locked. */
  offerUnlock: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  /** Room the screen's top bar takes, so the demo notice sits below it. */
  topInset: number;
  bottomInset: number;
  /** A wide browser window: controls are in the side panel, the video carries less. */
  theater?: boolean;
  onToggleMute: () => void;
  onToggleCaptions: () => void;
  onSetPaused: (episodeId: string, paused: boolean) => void;
  /** The visible page says what can be controlled now (the side panel's buttons follow it). */
  onActiveControls?: (episodeId: string, controls: ActiveControls) => void;
  onAutoplayMuted: () => void;
  onUnlock: (episode: EpisodeRow) => void;
  onEnded: (episode: EpisodeRow) => void;
  onStep: (delta: 1 | -1) => void;
}

type LoadState = 'ok' | 'retrying' | 'failed';

export function EpisodePage(props: EpisodePageProps) {
  if (props.role === 'idle') return <View style={[styles.page, { height: props.height }]} />;
  return <LivePage {...props} />;
}

function posterOf(episode: EpisodeRow, series: SeriesRow): ImageSource | number | null {
  if (isDemo) return (demoCover(series.id) as ImageSource | number | null) ?? null;
  const uri = mediaUrl(episode.poster_key, MEDIA_ORIGIN) ?? mediaUrl(series.cover_key, MEDIA_ORIGIN);
  return uri ? { uri } : null;
}

function LivePage({
  episode, series, role, height, columnWidth, inFront, muted, captions, paused, startAt, offerUnlock, hasNext, hasPrevious,
  topInset, bottomInset, theater = false, onToggleMute, onToggleCaptions, onSetPaused, onActiveControls, onAutoplayMuted,
  onUnlock, onEnded, onStep,
}: EpisodePageProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const active = role === 'active';
  const near = holdsPlayer(role);

  const priceQ = useEpisodePrice(episode.id, near);
  const view = watchAccessView(priceQ.data, episode);
  const access = pageAccess(view);
  // The one gate in front of the Worker: only an episode the price check says is watchable asks for a URL.
  const playbackQ = usePlayback(episode.id, near && mayRequestPlayback(view));
  const source = playbackQ.data ?? null;

  const [ready, setReady] = useState(false);
  const [load, setLoad] = useState<LoadState>('ok');
  const [captionsAvailable, setCaptionsAvailable] = useState(false);
  const [time, setTime] = useState({ position: 0, duration: episode.duration_s ?? 0 });
  const saver = useProgressSaver(episode.id, series.id, episode.duration_s);

  const playing = active && inFront && !paused && load !== 'failed';

  // In a browser only the visible page can be reached. Tab onto a neighbour's Unlock button would scroll the
  // pager to it and change the episode; `inert` (a DOM property) takes it out of the tab order and hides it
  // from screen readers until it is the visible page.
  const pageRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = pageRef.current as unknown as { inert?: boolean } | null;
    if (node) node.inert = !active;
  }, [active]);

  // Pausing (by the user, a swipe, or the screen going behind another) saves the position at once.
  const wasPlaying = useRef(false);
  const { flush, onProgress: saveProgress } = saver;
  useEffect(() => {
    if (wasPlaying.current && !playing) flush();
    wasPlaying.current = playing;
  }, [playing, flush]);

  // The Worker said locked although the price said otherwise (it changed meanwhile): ask for the price again.
  const playbackError = playbackQ.error;
  useEffect(() => {
    if (playbackError && errorCodeOf(playbackError).code === 'locked') {
      void queryClient.invalidateQueries({ queryKey: watchKeys.price(userId, episode.id) });
    }
  }, [playbackError, queryClient, userId, episode.id]);

  // Opened straight on a locked episode: show the sheet once. Unlocking is still the user's tap.
  const offered = useRef(false);
  useEffect(() => {
    if (offerUnlock && active && access === 'locked' && !offered.current) {
      offered.current = true;
      onUnlock(episode);
    }
  }, [offerUnlock, active, access, onUnlock, episode]);

  const onProgress = useCallback((position: number, duration: number) => {
    saveProgress(position, duration);
    if (active) setTime({ position, duration: duration > 0 ? duration : (episode.duration_s ?? 0) });
  }, [saveProgress, active, episode.duration_s]);

  const onReady = useCallback(() => {
    setReady(true);
    setLoad('ok');
  }, []);

  // The end: save, show the play button (a tap replays), and let the screen offer the next episode.
  const onEnd = useCallback(() => {
    flush();
    onSetPaused(episode.id, true);
    onEnded(episode);
  }, [flush, onSetPaused, onEnded, episode]);

  // A stream that fails is usually an expired link: fetch a new one once, then give up with a retry button.
  const onError = useCallback(() => {
    setReady(false);
    if (source?.kind === 'stream' && load === 'ok') {
      setLoad('retrying');
      void playbackQ.refetch();
    } else {
      setLoad('failed');
    }
  }, [source?.kind, load, playbackQ]);

  const retry = useCallback(() => {
    setLoad('ok');
    void playbackQ.refetch();
  }, [playbackQ]);

  const onAccessibilityAction = useCallback((e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'next') onStep(1);
    if (e.nativeEvent.actionName === 'previous') onStep(-1);
  }, [onStep]);

  const poster = posterOf(episode, series);
  const showPlayer = near && access === 'play' && source !== null && load !== 'failed';
  const demoFailed = source?.kind === 'demo' && load === 'failed';
  const streamFailed = source?.kind === 'stream' && load === 'failed';
  const ai = isAiContent(series, episode);

  let panel: ReactNode = null;
  if (access === 'locked') {
    panel = <LockedPanel view={view} onUnlock={() => onUnlock(episode)} />;
  } else if (access === 'mature') {
    panel = (
      <MessagePanel
        message={t('errors:mature_opt_in_required')}
        action={{ label: t('watch:openSettings'), onPress: () => router.push(SETTINGS_ROUTE) }}
      />
    );
  } else if (access === 'unavailable') {
    panel = <MessagePanel message={t('errors:not_available')} />;
  } else if (priceQ.error && near && !priceQ.data) {
    // Only when there is no answer at all: a failed refetch keeps the last one (and the video keeps playing).
    const info = describeError(priceQ.error);
    panel = <MessagePanel message={t(info.key, info.params)} action={{ label: t('common:actions.retry'), onPress: () => void priceQ.refetch() }} />;
  } else if (playbackError && near && errorCodeOf(playbackError).code !== 'locked') {
    const info = describeError(playbackError);
    panel = <MessagePanel message={t(info.key, info.params)} action={info.retryable ? { label: t('common:actions.retry'), onPress: retry } : undefined} />;
  } else if (demoFailed) {
    panel = <MessagePanel message={t('watch:demo.unavailable')} />;
  } else if (streamFailed) {
    panel = <MessagePanel message={t('watch:loadFailed')} action={{ label: t('common:actions.retry'), onPress: retry }} />;
  } else if (near && (access === 'loading' || (!ready && active))) {
    panel = <LoadingPanel label={load === 'retrying' ? t('watch:expired') : t('common:state.loading')} />;
  }

  const canControl = access === 'play' && source !== null && load !== 'failed';
  const controls = canControl && active;

  // The visible page tells the screen what its side panel can offer.
  useEffect(() => {
    if (active) onActiveControls?.(episode.id, { canControl, captionsAvailable: canControl && captionsAvailable });
  }, [active, canControl, captionsAvailable, episode.id, onActiveControls]);

  const actions = [
    ...(hasNext ? [{ name: 'next', label: t('watch:next.label') }] : []),
    ...(hasPrevious ? [{ name: 'previous', label: t('watch:previous') }] : []),
  ];

  return (
    <View ref={pageRef} style={[styles.page, { height }]}>
      <View style={[styles.column, { width: columnWidth }]}>
        {showPlayer && source ? (
          <VideoSurface
            key={source.kind === 'stream' ? source.uri : `demo:${episode.id}`}
            source={source}
            playing={playing}
            muted={muted}
            captions={captions}
            startAt={startAt}
            onProgress={onProgress}
            onReady={onReady}
            onEnd={onEnd}
            onError={onError}
            onCaptionsAvailable={setCaptionsAvailable}
            onAutoplayMuted={onAutoplayMuted}
          />
        ) : null}
        {/* The poster covers the player until its first frame is on screen. */}
        {poster ? (
          <Image
            source={poster}
            style={[styles.fill, ready && showPlayer && styles.hidden]}
            contentFit="cover"
            transition={motion.fast}
            accessible={false}
            pointerEvents="none"
          />
        ) : null}

        {controls ? (
          <Pressable
            style={styles.fill}
            onPress={() => onSetPaused(episode.id, !paused)}
            accessibilityRole="button"
            accessibilityLabel={paused ? t('watch:play') : t('watch:pause')}
            accessibilityActions={actions}
            onAccessibilityAction={onAccessibilityAction}
            testID="watch-toggle-play"
          >
            {paused ? (
              <View style={styles.playIcon} pointerEvents="none">
                <Ionicons name="play" size={PLAY_ICON_SIZE} color={colors.surface} />
              </View>
            ) : null}
          </Pressable>
        ) : null}

        {panel}

        {source?.kind === 'demo' && source.placeholder && active ? (
          <View style={[styles.noticeRow, { top: topInset }]} pointerEvents="none">
            <DemoNotice label={t('watch:demo.notice')} />
          </View>
        ) : null}

        <View style={[styles.bottom, { paddingBottom: bottomInset + space.md }]} pointerEvents="box-none">
          {/* In the theatre the panel names the episode: the video keeps its AI label and the progress. */}
          {!theater || ai || controls ? (
            <View style={[styles.infoCard, theater && controls && styles.infoCardTheater]} pointerEvents="none">
              {ai ? (
                <View style={[styles.aiBadge, theater && !controls && styles.aiBadgeAlone]}>
                  <AIBadge size="sm" />
                </View>
              ) : null}
              {theater ? null : (
                <>
                  <Text variant="subheading" color="surface" numberOfLines={2}>
                    {episode.title}
                  </Text>
                  <Text variant="bodySmall" color="surface">
                    {t('common:episode.number', { number: episode.number })}
                  </Text>
                </>
              )}
              {controls ? (
                <View style={[styles.progress, theater && styles.progressTheater]}>
                  <ProgressBar position={time.position} duration={time.duration} label={t('watch:scrubber')} />
                </View>
              ) : null}
            </View>
          ) : null}
          {controls && !theater ? (
            <View style={styles.rail}>
              <IconButton
                icon={muted ? 'volume-mute' : 'volume-high'}
                label={muted ? t('watch:unmute') : t('watch:mute')}
                onPress={onToggleMute}
                testID="watch-mute"
              />
              <View style={styles.railGap} />
              <IconButton
                icon="logo-closed-captioning"
                label={t('watch:captions.label')}
                checked={captions && captionsAvailable}
                disabled={!captionsAvailable}
                accessibilityHint={captionsAvailable ? undefined : t('watch:captions.none')}
                onPress={onToggleCaptions}
                testID="watch-captions"
              />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const PROGRESS_MIN_WIDTH = 160;

const styles = StyleSheet.create({
  page: { width: '100%', alignItems: 'center', overflow: 'hidden', backgroundColor: colors.playerBg },
  column: { flex: 1, overflow: 'hidden' },
  fill: { ...StyleSheet.absoluteFill },
  hidden: { opacity: 0 },
  playIcon: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  noticeRow: { position: 'absolute', left: space.lg, right: space.lg },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: space.lg,
  },
  infoCard: {
    flexShrink: 1,
    marginRight: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.card,
    backgroundColor: colors.scrim,
  },
  infoCardTheater: { flexGrow: 1, marginRight: 0 },
  aiBadge: { marginBottom: space.xs },
  aiBadgeAlone: { marginBottom: 0 },
  progress: { marginTop: space.sm, minWidth: PROGRESS_MIN_WIDTH },
  progressTheater: { marginTop: 0 },
  rail: { marginLeft: 'auto', alignItems: 'center' },
  railGap: { height: space.md },
});
