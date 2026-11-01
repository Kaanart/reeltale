// The vertical episode player for one series: a full-screen pager opened on the requested episode, one
// page per episode (components/EpisodePage.tsx). Only the visible page and its two neighbours hold a
// player (logic/pager.ts), the visible one plays, and a locked episode shows its poster and the unlock
// sheet instead of asking for playback. Sound and captions carry over between episodes (prefs.ts).
//
// Route: /watch/[episodeId]. Swiping keeps the URL on the visible episode, so a reload or a shared link on
// the web opens where the viewer was.

import { useIsFocused, useLocalSearchParams, useRouter, Stack, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, AppState, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Text } from '../../../components/ui';
import { describeError } from '../../../core/errors';
import { isDemo } from '../../../lib/data';
import type { EpisodeRow, SeriesRow } from '../../../lib/types';
import { colors, radius, space } from '../../../theme/tokens';
import { EndOverlay } from '../components/EndOverlay';
import { EpisodePage } from '../components/EpisodePage';
import { EpisodePager, type EpisodePagerHandle } from '../components/EpisodePager';
import { TopBar } from '../components/TopBar';
import { UnlockSheet } from '../components/UnlockSheet';
import { isEpisodeId, useRefreshCatalogProgress, useSeriesProgress, useWatchSeries } from '../hooks';
import { clampIndex, pageRole, startIndex } from '../logic/pager';
import { resumePosition, type SavedProgress } from '../logic/progress';
import { useWatchPrefs } from '../prefs';

/** Episodes are vertical: on a wide window the player is a 9:16 column in the middle. */
const PLAYER_ASPECT = 9 / 16;
const CARD_MAX_WIDTH = 340;
const HOME = '/' as Href;
const SETTINGS = '/settings' as Href;
const EMPTY_PROGRESS: ReadonlyMap<string, SavedProgress> = new Map();

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function useGoBack() {
  const router = useRouter();
  // A link opened straight into the player has nothing to go back to: Home is the way out.
  return useCallback(() => (router.canGoBack() ? router.back() : router.replace(HOME)), [router]);
}

/** The app is in the foreground (on the web: the tab is visible). */
function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

export function WatchScreen() {
  const params = useLocalSearchParams<{ episodeId?: string | string[] }>();
  // The episode the screen opened on. Swiping changes the URL (below) but never reloads the series.
  // Ids are compared as the database writes them (lower case), whatever case the link used.
  const [openedOn] = useState(() => firstParam(params.episodeId).toLowerCase());
  const valid = isEpisodeId(openedOn);
  const seriesQ = useWatchSeries(openedOn);
  const data = seriesQ.data;
  const episodeIds = useMemo(() => data?.episodes.map((e) => e.id) ?? [], [data]);
  const progressQ = useSeriesProgress(data?.series.id ?? '', episodeIds);

  if (!valid) return <Shell kind="message" error={null} />;
  // Only a first load that failed shows the error: a failed background refetch (the app coming back to the
  // foreground on a bad connection) keeps the series it has, and the player keeps playing.
  if (!data && seriesQ.isError) return <Shell kind="message" error={seriesQ.error} onRetry={() => void seriesQ.refetch()} />;
  // Wait for the saved progress too (a failed read just starts from the beginning), so a player never starts
  // at 0 a moment before its resume point arrives.
  if (!data || (progressQ.isPending && progressQ.fetchStatus === 'fetching')) return <Shell kind="loading" />;
  if (data.episodes.length === 0) return <Shell kind="message" error={null} />;

  return <Player series={data.series} episodes={data.episodes} openedOn={openedOn} progress={progressQ.data ?? EMPTY_PROGRESS} />;
}

// ---- Loading, not found, failed -----------------------------------------------------------------------

function Shell({ kind, error, onRetry }: { kind: 'loading' | 'message'; error?: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useGoBack();

  let body: ReactNode;
  if (kind === 'loading') {
    body = <ActivityIndicator size="large" color={colors.surface} accessibilityLabel={t('common:state.loading')} />;
  } else {
    const info = error ? describeError(error) : null;
    const message = info ? t(info.key, info.params) : t('errors:not_found');
    let action: { label: string; onPress: () => void };
    if (info?.action === 'mature_opt_in') action = { label: t('watch:openSettings'), onPress: () => router.push(SETTINGS) };
    else if (info?.retryable && onRetry) action = { label: t('common:actions.retry'), onPress: onRetry };
    else action = { label: t('common:link.goHome'), onPress: () => router.replace(HOME) };
    body = (
      <View style={styles.card}>
        <Text variant="body" align="center" accessibilityRole="alert">
          {message}
        </Text>
        <View style={styles.cardAction}>
          <Button label={action.label} onPress={action.onPress} variant="secondary" fullWidth />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenChrome title={null} />
      <View style={styles.center}>{body}</View>
      <TopBar title={null} topInset={insets.top} onBack={goBack} />
    </View>
  );
}

/** Stack options, the status bar and the page title, shared by every state of the screen. */
function ScreenChrome({ title }: { title: string | null }) {
  const { t } = useTranslation();
  return (
    <>
      <Stack.Screen options={{ title: title ?? t('watch:screenTitle'), contentStyle: { backgroundColor: colors.playerBg } }} />
      {/* Light text over the black player; the demo ribbon above it is light, so dark text there. */}
      <StatusBar style={isDemo ? 'dark' : 'light'} />
    </>
  );
}

// ---- The player ---------------------------------------------------------------------------------------

function Player({ series, episodes, openedOn, progress }: {
  series: SeriesRow;
  episodes: EpisodeRow[];
  openedOn: string;
  progress: ReadonlyMap<string, SavedProgress>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const goBack = useGoBack();
  const focused = useIsFocused();
  const appActive = useAppActive();
  const { muted, captions, setMuted, toggleMuted, toggleCaptions } = useWatchPrefs();
  const refreshCatalogProgress = useRefreshCatalogProgress();

  const [initial] = useState(() => startIndex(episodes, openedOn));
  const [active, setActive] = useState(initial);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [pageHeight, setPageHeight] = useState(0);
  const [topBarHeight, setTopBarHeight] = useState(0);
  const [sheetEpisode, setSheetEpisode] = useState<EpisodeRow | null>(null);
  const [endedId, setEndedId] = useState<string | null>(null);
  // The sheet opens by itself once, for the episode the screen was opened on, if it's locked.
  const [offerPending, setOfferPending] = useState(true);
  const pager = useRef<EpisodePagerHandle>(null);

  const inFront = focused && appActive && sheetEpisode === null;
  const columnWidth = pageHeight > 0 ? Math.min(width, Math.round(pageHeight * PLAYER_ASPECT)) : width;
  const current = episodes[clampIndex(active, episodes.length)];

  // Leaving the player: the catalog's progress marks and "continue watching" refresh once.
  useEffect(() => () => refreshCatalogProgress(), [refreshCatalogProgress]);

  // Keep the URL on the visible episode (setParams replaces it; nothing is reloaded: see openedOn).
  const currentId = current?.id;
  const shownParam = firstParam(useLocalSearchParams<{ episodeId?: string | string[] }>().episodeId).toLowerCase();
  useEffect(() => {
    if (currentId && currentId !== shownParam) router.setParams({ episodeId: currentId });
  }, [currentId, shownParam, router]);

  const settleOn = useCallback((index: number) => {
    if (index !== activeRef.current) setEndedId(null);
    if (index !== initial) setOfferPending(false);
    setActive(index);
  }, [initial]);

  const goTo = useCallback((index: number) => {
    const next = clampIndex(index, episodes.length);
    settleOn(next);
    pager.current?.scrollTo(next);
  }, [episodes.length, settleOn]);

  const onStep = useCallback((delta: 1 | -1) => goTo(activeRef.current + delta), [goTo]);

  const openUnlock = useCallback((episode: EpisodeRow) => {
    setOfferPending(false);
    setSheetEpisode(episode);
  }, []);
  const closeUnlock = useCallback(() => setSheetEpisode(null), []);

  const onEnded = useCallback((episode: EpisodeRow) => {
    if (episodes[activeRef.current]?.id === episode.id) setEndedId(episode.id);
  }, [episodes]);

  const onAutoplayMuted = useCallback(() => setMuted(true), [setMuted]);

  const backToSeries = useCallback(() => {
    router.dismissTo({ pathname: '/series/[slug]', params: { slug: series.slug } } as Href);
  }, [router, series.slug]);

  const onPagerLayout = useCallback((e: LayoutChangeEvent) => setPageHeight(e.nativeEvent.layout.height), []);

  const renderPage = useCallback((episode: EpisodeRow, index: number) => (
    <EpisodePage
      key={episode.id}
      episode={episode}
      series={series}
      role={pageRole(index, active)}
      height={pageHeight}
      columnWidth={columnWidth}
      inFront={inFront}
      muted={muted}
      captions={captions}
      startAt={resumePosition(progress.get(episode.id), episode.duration_s)}
      offerUnlock={offerPending && index === initial}
      hasNext={index < episodes.length - 1}
      hasPrevious={index > 0}
      topInset={topBarHeight}
      bottomInset={insets.bottom}
      onToggleMute={toggleMuted}
      onToggleCaptions={toggleCaptions}
      onAutoplayMuted={onAutoplayMuted}
      onUnlock={openUnlock}
      onEnded={onEnded}
      onStep={onStep}
    />
  ), [
    series, active, pageHeight, columnWidth, inFront, muted, captions, progress, offerPending, initial, episodes.length,
    topBarHeight, insets.bottom, toggleMuted, toggleCaptions, onAutoplayMuted, openUnlock, onEnded, onStep,
  ]);

  const title = current ? t('watch:title', { series: series.title, number: current.number }) : series.title;

  return (
    <View style={styles.screen}>
      <ScreenChrome title={title} />
      <View style={styles.fill} onLayout={onPagerLayout}>
        {pageHeight > 0 ? (
          <EpisodePager
            ref={pager}
            episodes={episodes}
            initialIndex={initial}
            activeIndex={active}
            pageHeight={pageHeight}
            onIndexChange={settleOn}
            renderPage={renderPage}
            // Off behind a screen pushed on top (the web stack keeps this one mounted, just hidden): the
            // arrow keys belong to the wallet or settings page then.
            keyboardEnabled={focused && sheetEpisode === null && endedId === null}
          />
        ) : null}
        {endedId !== null && endedId === current?.id ? (
          <EndOverlay
            index={active}
            episodes={episodes}
            inFront={inFront}
            onNext={goTo}
            onStay={() => setEndedId(null)}
            onBackToSeries={backToSeries}
          />
        ) : null}
      </View>
      <TopBar title={title} topInset={insets.top} onBack={goBack} onHeight={setTopBarHeight} />
      <UnlockSheet episode={sheetEpisode} series={series} onClose={closeUnlock} onUnlocked={closeUnlock} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.playerBg },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  card: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    padding: space.xl,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  cardAction: { marginTop: space.lg },
});
