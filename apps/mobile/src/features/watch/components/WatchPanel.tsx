// The side panel beside the player on a wide browser window (logic/desktop.ts theaterLayout): the series
// (title linking to its page, format, the Mature and AI labels, follow), what is playing with the sound and
// caption controls, every episode with its free / unlocked / price state, the keyboard shortcuts, and the
// report link. Choosing an episode moves the player there; a locked one also opens the unlock dialog
// (nothing unlocks without the dialog's own button).

import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Platform, Pressable, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';

import { focusRing, ShellLink, useInteraction } from '../../../components/layout';
import { AIBadge, Button, CoinPrice, LockBadge, Skeleton, Text } from '../../../components/ui';
import { describeError } from '../../../core/errors';
import type { EpisodeRow, SeriesRow } from '../../../lib/types';
import { colors, fonts, layout, radius, space } from '../../../theme/tokens';
import { useUserId } from '../../auth';
import { useIsFollowing, useToggleFollow } from '../../catalog/hooks';
import { MaturityMarker } from '../../catalog/components/MaturityMarker';
import { reportHref } from '../../me';
import { useEpisodePrice } from '../hooks';
import { isAiContent } from '../logic/access';
import { listNeedsPrice, listState, SHORTCUT_HINTS, SHORTCUT_KEYS, type ListState } from '../logic/desktop';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** What the visible page can do (it reports this up: the panel holds its controls). */
export interface ActiveControls {
  canControl: boolean;
  captionsAvailable: boolean;
}

export interface WatchPanelProps {
  series: SeriesRow;
  episodes: readonly EpisodeRow[];
  activeIndex: number;
  width: number;
  height: number;
  muted: boolean;
  captions: boolean;
  /** The visible page's controls; null while it hasn't reported (loading, locked). */
  controls: ActiveControls | null;
  onToggleMute: () => void;
  onToggleCaptions: () => void;
  /** Move the player to an episode; `locked` when the list shows it locked (the screen offers the unlock). */
  onSelect: (index: number, locked: boolean) => void;
}

const ICON = 20;
const ROW_NUMBER_WIDTH = 28;
const PRICE_SKELETON_WIDTH = 56;
const SYNOPSIS_LINES = 3;
const ACTIVE_EDGE = 3;
const web = Platform.OS === 'web';

export function WatchPanel({
  series, episodes, activeIndex, width, height, muted, captions, controls, onToggleMute, onToggleCaptions, onSelect,
}: WatchPanelProps) {
  const { t } = useTranslation();
  const userId = useUserId();
  const current = episodes[activeIndex] ?? episodes[0];
  const own = !!userId && series.creator_id === userId;
  const ai = isAiContent(series, current);
  const captionsAvailable = controls?.captionsAvailable ?? false;
  const seriesHref = { pathname: '/series/[slug]', params: { slug: series.slug } } as Href;
  const scrollRef = useRef<ScrollView>(null);

  // Keep the visible episode's row in view (web; only the panel scrolls, focus stays put). The list follows
  // the player until the viewer scrolls it themselves, and again from the next episode on; a late change of
  // size (prices arriving, a resized window) checks again.
  const rows = useRef(new Map<number, View>());
  const follow = useRef({ on: true, top: 0 });
  const registerRow = useCallback((index: number, node: View | null) => {
    if (node) rows.current.set(index, node);
    else rows.current.delete(index);
  }, []);
  const reveal = useCallback(() => {
    if (!web || !follow.current.on) return;
    const top = revealInPanel(rows.current.get(activeIndex) ?? null, scrollRef.current);
    if (top !== null) follow.current.top = top;
  }, [activeIndex]);
  useEffect(() => {
    follow.current.on = true;
    reveal();
  }, [reveal]);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (Math.abs(e.nativeEvent.contentOffset.y - follow.current.top) > 2) follow.current.on = false;
  }, []);

  return (
    <View
      role={web ? 'complementary' : undefined}
      aria-label={t('watch:panel.a11y')}
      style={[styles.panel, { width, height }]}
      testID="watch-panel"
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        onLayout={reveal}
        onContentSizeChange={reveal}
      >
        {/* The series */}
        <Text variant="title" accessibilityRole="header" aria-level={1} numberOfLines={3}>
          <Link href={seriesHref} style={styles.seriesLink}>
            {series.title}
          </Link>
        </Text>
        <View style={styles.meta}>
          <Text variant="bodySmall" color="inkMuted">
            {t('watch:panel.meta', {
              format: t(`common:format.${series.format}`),
              episodes: t('common:episode.count', { count: episodes.length }),
            })}
          </Text>
        </View>
        {ai || series.maturity === 'mature' ? (
          <View style={styles.labels}>
            {ai ? <AIBadge size="sm" /> : null}
            {series.maturity === 'mature' ? <MaturityMarker /> : null}
          </View>
        ) : null}
        {series.synopsis.trim() ? (
          <Text variant="bodySmall" numberOfLines={SYNOPSIS_LINES} style={styles.synopsis}>
            {series.synopsis.trim()}
          </Text>
        ) : null}
        {own ? null : <FollowButton seriesId={series.id} />}

        {/* What is playing, and its controls */}
        {current ? (
          <View style={styles.section}>
            <Text variant="caption" color="inkMuted" accessibilityRole="header" aria-level={2} style={styles.sectionLabel}>
              {t('watch:panel.nowPlaying')}
            </Text>
            <Text variant="subheading" numberOfLines={2}>
              {t('watch:next.episode', { number: current.number, title: current.title.trim() || t('common:episode.number', { number: current.number }) })}
            </Text>
            <View style={styles.toggles}>
              <PanelToggle
                icon={muted ? 'volume-mute' : 'volume-high'}
                label={muted ? t('watch:unmute') : t('watch:mute')}
                onPress={onToggleMute}
                shortcut={SHORTCUT_KEYS.mute}
                testID="watch-panel-mute"
              />
              <PanelToggle
                icon="logo-closed-captioning"
                label={t('watch:captions.label')}
                checked={captions && captionsAvailable}
                disabled={!captionsAvailable}
                onPress={onToggleCaptions}
                shortcut={SHORTCUT_KEYS.captions}
                testID="watch-panel-captions"
              />
            </View>
            {controls && !captionsAvailable ? (
              <Text variant="caption" color="inkMuted" style={styles.note}>
                {t('watch:captions.none')}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Every episode */}
        <View style={styles.section}>
          <Text variant="caption" color="inkMuted" accessibilityRole="header" aria-level={2} style={styles.sectionLabel}>
            {t('watch:panel.episodes')}
          </Text>
          <View role={web ? 'list' : undefined}>
            {episodes.map((episode, index) => (
              <View key={episode.id} role={web ? 'listitem' : undefined}>
                <EpisodeListRow
                  series={series}
                  episode={episode}
                  index={index}
                  active={index === activeIndex}
                  register={registerRow}
                  onSelect={onSelect}
                />
              </View>
            ))}
          </View>
        </View>

        <ShortcutHint />

        {own || !current ? null : (
          <View style={styles.report}>
            <ReportLink episodeId={current.id} creatorId={series.creator_id} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ---- Follow ------------------------------------------------------------------------------------------------

function FollowButton({ seriesId }: { seriesId: string }) {
  const { t } = useTranslation();
  const following = useIsFollowing(seriesId);
  const toggle = useToggleFollow(seriesId);
  const on = following.data === true;
  const error = toggle.error ? describeError(toggle.error) : null;
  return (
    <View style={styles.follow}>
      <Button
        label={on ? t('watch:panel.following') : t('watch:panel.follow')}
        onPress={() => toggle.mutate(!on)}
        variant="secondary"
        size="sm"
        disabled={following.isPending}
        icon={<Ionicons name={on ? 'checkmark' : 'add'} size={ICON} color={colors.ink} />}
        testID="watch-panel-follow"
      />
      {error ? (
        <Text variant="caption" color="danger" accessibilityRole="alert" style={styles.note}>
          {t(error.key, error.params)}
        </Text>
      ) : null}
    </View>
  );
}

// ---- Sound and captions ------------------------------------------------------------------------------------

function PanelToggle({ icon, label, onPress, checked, disabled = false, shortcut, testID }: {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** A switch (captions); a plain button without it (mute: the label says what a press does). */
  checked?: boolean;
  disabled?: boolean;
  /** The letter key that does the same (aria-keyshortcuts). */
  shortcut: string;
  testID: string;
}) {
  const { hovered, focusVisible, handlers } = useInteraction();
  const toggle = checked !== undefined;
  const on = checked === true;
  const webProps = web ? ({ 'aria-keyshortcuts': shortcut.toUpperCase() } as object) : {};
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={toggle ? 'switch' : 'button'}
      accessibilityLabel={label}
      accessibilityState={toggle ? { checked: on, disabled } : { disabled }}
      testID={testID}
      {...webProps}
      {...handlers}
      style={({ pressed }) => [
        styles.toggle,
        on && styles.toggleOn,
        hovered && !disabled && !on && styles.toggleHover,
        pressed && styles.pressed,
        disabled && styles.disabled,
        focusVisible && focusRing,
      ]}
    >
      <Ionicons name={icon} size={ICON} color={on ? colors.surface : colors.ink} />
      <Text variant="bodySmall" color={on ? 'surface' : 'ink'} style={styles.toggleLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---- The episode list --------------------------------------------------------------------------------------

function stateText(t: (key: string, options?: Record<string, unknown>) => string, state: ListState): string | null {
  switch (state.kind) {
    case 'free':
      return t('common:episode.free');
    case 'unlocked':
      return t('common:episode.unlocked');
    case 'own':
      return t('watch:panel.own');
    case 'locked':
      return `${t('common:episode.locked')}, ${t('common:coins.count', { count: state.price })}`;
    case 'unavailable':
      return t('watch:panel.unavailable');
    default:
      return null;
  }
}

/** Scrolls the panel (and only the panel) so a row is in view; returns where the panel is now (web only). */
function revealInPanel(row: View | null, scroller: ScrollView | null): number | null {
  const node = row as unknown as HTMLElement | null;
  const box = (scroller as unknown as { getScrollableNode?: () => HTMLElement | null } | null)?.getScrollableNode?.();
  if (!node?.getBoundingClientRect || !box) return null;
  const r = node.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  // Instant, and on the panel's own box: element.scrollIntoView would also scroll the player's pager (and in
  // some browsers stop its smooth page change half way).
  if (r.top < b.top) box.scrollTop += r.top - b.top - space.lg;
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + space.lg;
  return box.scrollTop;
}

function EpisodeListRow({ series, episode, index, active, register, onSelect }: {
  series: SeriesRow;
  episode: EpisodeRow;
  index: number;
  active: boolean;
  /** The panel keeps the visible episode's row in view. */
  register: (index: number, node: View | null) => void;
  onSelect: (index: number, locked: boolean) => void;
}) {
  const { t } = useTranslation();
  const { hovered, focusVisible, handlers } = useInteraction();
  // The same price check (and cache entry) the player's own page uses for this episode.
  const priceQ = useEpisodePrice(episode.id, listNeedsPrice(series, episode));
  const state = listState(series, episode, priceQ.data);
  const title = episode.title.trim();
  // The visible row: "Playing", or "On screen" while it shows a poster (locked, not available).
  const here = state.kind === 'locked' || state.kind === 'unavailable' ? t('watch:panel.onScreen') : t('watch:panel.playing');
  const label = [
    t('common:episode.number', { number: episode.number }),
    title,
    stateText(t, state),
    active ? here : null,
  ].filter((part): part is string => !!part).join(', ');
  const webProps = web && active ? ({ 'aria-current': 'true' } as object) : {};

  const ref = useCallback((node: View | null) => register(index, node), [register, index]);

  return (
    <Pressable
      ref={ref}
      onPress={() => onSelect(index, state.kind === 'locked')}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`watch-panel-episode-${episode.number}`}
      {...webProps}
      {...handlers}
      style={({ pressed }) => [
        styles.row,
        active && styles.rowActive,
        hovered && !active && styles.rowHover,
        pressed && styles.pressed,
        focusVisible && focusRing,
      ]}
    >
      <View style={[styles.rowEdge, active && styles.rowEdgeActive]} />
      <Text variant="bodySmall" color="inkMuted" align="center" style={styles.rowNumber}>
        {episode.number}
      </Text>
      <View style={styles.rowMain}>
        <Text variant="bodySmall" numberOfLines={2} style={styles.rowTitle}>
          {title || t('common:episode.number', { number: episode.number })}
        </Text>
        {active ? (
          <View style={styles.playing}>
            <Ionicons name={state.kind === 'locked' || state.kind === 'unavailable' ? 'eye' : 'play'} size={space.md} color={colors.accentStrong} />
            <Text variant="caption" color="accentStrong" style={styles.playingText}>
              {here}
            </Text>
          </View>
        ) : episode.duration_s ? (
          <Text variant="caption" color="inkMuted">
            {t('common:episode.duration', { seconds: episode.duration_s })}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowState}>
        <RowState state={state} pending={priceQ.isPending && priceQ.fetchStatus === 'fetching'} />
      </View>
    </Pressable>
  );
}

function RowState({ state, pending }: { state: ListState; pending: boolean }) {
  const { t } = useTranslation();
  switch (state.kind) {
    case 'locked':
      return (
        <View style={styles.priced}>
          <LockBadge size="sm" />
          <CoinPrice coins={state.price} approx={null} size="sm" strikethroughBase={state.discounted ? state.basePrice : null} />
        </View>
      );
    case 'loading':
      // A failed price check shows nothing rather than a guess; choosing the row still works.
      return pending ? <Skeleton width={PRICE_SKELETON_WIDTH} height={space.lg} /> : null;
    default:
      return (
        <Text variant="caption" color="inkMuted">
          {stateText(t, state)}
        </Text>
      );
  }
}

// ---- Keyboard hint and report ------------------------------------------------------------------------------

function ShortcutHint() {
  const { t } = useTranslation();
  if (!web) return null;
  return (
    <View style={styles.section} testID="watch-shortcuts">
      <Text variant="caption" color="inkMuted" accessibilityRole="header" aria-level={2} style={styles.sectionLabel}>
        {t('watch:shortcuts.title')}
      </Text>
      {SHORTCUT_HINTS.map((hint) => (
        <View key={hint.id} style={styles.hintRow}>
          <View style={styles.keys}>
            {hint.keys.map((key) => (
              <View key={key} style={styles.key}>
                <Text variant="caption" style={styles.keyText}>
                  {key === 'space' ? t('watch:shortcuts.space') : key}
                </Text>
              </View>
            ))}
          </View>
          <Text variant="caption" color="inkMuted" style={styles.hintText}>
            {t(`watch:shortcuts.${hint.id}`)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ReportLink({ episodeId, creatorId }: { episodeId: string; creatorId: string | null }) {
  const { t } = useTranslation();
  return (
    <ShellLink
      href={reportHref('episode', episodeId, creatorId) as Href}
      testID="watch-panel-report"
      linkStyle={({ hovered, focusVisible }) => [styles.reportLink, hovered && styles.reportHover, focusVisible && focusRing]}
      render={() => (
        <>
          <Ionicons name="flag-outline" size={ICON - space.xs} color={colors.inkMuted} />
          <Text variant="bodySmall" color="inkMuted" style={styles.reportText}>
            {t('watch:panel.report')}
          </Text>
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  content: { padding: space.xl },
  seriesLink: { color: colors.ink, fontFamily: fonts.serifBold },
  meta: { marginTop: space.xs },
  labels: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  synopsis: { marginTop: space.md },
  follow: { alignItems: 'flex-start', marginTop: space.lg },
  section: {
    marginTop: space.xl,
    paddingTop: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  sectionLabel: { fontFamily: fonts.sansMedium, marginBottom: space.sm },
  note: { marginTop: space.sm },
  toggles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: layout.minTarget,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  toggleOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  toggleHover: { backgroundColor: colors.surfaceAlt },
  toggleLabel: { fontFamily: fonts.sansMedium },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: layout.minTarget + space.md,
    paddingVertical: space.sm,
    paddingRight: space.sm,
    borderRadius: radius.chip,
  },
  rowActive: { backgroundColor: colors.surfaceAlt },
  rowHover: { backgroundColor: colors.bg },
  rowEdge: { alignSelf: 'stretch', width: ACTIVE_EDGE, borderRadius: radius.pill },
  rowEdgeActive: { backgroundColor: colors.accent },
  rowNumber: { width: ROW_NUMBER_WIDTH, fontFamily: fonts.sansMedium },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: fonts.sansMedium },
  playing: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  playingText: { fontFamily: fonts.sansMedium },
  rowState: { alignItems: 'flex-end', justifyContent: 'center' },
  priced: { alignItems: 'flex-end', gap: space.xs },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xs },
  keys: { flexDirection: 'row', gap: space.xs, minWidth: layout.minTarget * 2 },
  key: {
    minWidth: space.xl,
    paddingHorizontal: space.sm,
    alignItems: 'center',
    borderRadius: radius.chip,
    borderWidth: 1,
    borderBottomWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  keyText: { fontFamily: fonts.sansMedium, color: colors.ink },
  hintText: { flexShrink: 1 },
  report: { marginTop: space.xl },
  reportLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.sm,
    minHeight: layout.minTarget,
    paddingHorizontal: space.sm,
    marginLeft: -space.sm,
    borderRadius: radius.chip,
  },
  reportHover: { backgroundColor: colors.surfaceAlt },
  reportText: { textDecorationLine: 'underline' },
});
