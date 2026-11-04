import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { focusRing, useInteraction, useLayout, type LayoutSize } from '../../../../components/layout';
import { AIBadge, Button, Skeleton, Text } from '../../../../components/ui';
import type { TagRow } from '../../../../lib/types';
import { colors, fonts, radius, space } from '../../../../theme/tokens';
import { useEpisodeSummary, useSeries } from '../../hooks';
import { isAiSeries, type SeriesCard } from '../../logic';
import { routes } from '../../routes';
import {
  applyCarouselAction, CAROUSEL_INTERVAL_MS, carouselKeyAction, shouldAutoAdvance, wrapIndex,
} from '../../storefront';
import { headingLevel } from '../a11y';
import { Cover, POSTER_RATIO } from '../Cover';
import { DecorativeIcon } from '../DecorativeIcon';
import { MaturityMarker } from '../MaturityMarker';
import { ComingSoonArt, hiddenFromScreenReaders } from './ComingSoon';
import { SectionHeader } from './SectionHeader';
import { useStoreText } from './useStoreText';

const POSTER_WIDTH: Record<LayoutSize, number> = { compact: 112, medium: 168, wide: 200 };
const SYNOPSIS_LINES = { compact: 3, wide: 4 } as const;
const PLAY_ICON = 16;
const CONTROL_ICON = 14;
/** The dots and the pause button: 28 px targets (WCAG 2.5.8 asks for 24). */
const CONTROL_SIZE = 28;
const DOT = 8;
const DOT_ACTIVE = 24;
/** Sprocket holes along the film strip's top and bottom edge. */
const SPROCKETS = 6;
const SPROCKET_W = 8;
const SPROCKET_H = 5;
const STRIP_EDGE = space.md;
const STRIP_SIDE = space.sm;

type KeyEventLike = { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void };

/**
 * "Weekly pick": a carousel of three or four featured series (Editor's Picks first). Each slide is a 9:16
 * poster in a film strip, the title, format and episode count, the start of the summary, Watch now (the first
 * episode) and Details. It moves on every few seconds by itself, except under the mouse, while the keyboard
 * focus is inside, after Pause, or when the system asks for reduced motion. Arrow keys (and Home / End) move
 * it while the focus is inside.
 */
export function WeeklyPick({ series, tags }: { series: readonly SeriesCard[]; tags: readonly TagRow[] }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [screenFocused, setScreenFocused] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, []),
  );

  const count = series.length;
  const current = wrapIndex(index, count);
  const auto = shouldAutoAdvance({ count, paused, hovered, focused, reduceMotion, screenFocused });

  // A fresh timer after every change, so a slide picked by hand stays up for the whole interval.
  useEffect(() => {
    if (!auto) return undefined;
    const id = setTimeout(() => setIndex((i) => wrapIndex(i + 1, count)), CAROUSEL_INTERVAL_MS);
    return () => clearTimeout(id);
  }, [auto, count, current]);

  const slide = series[current];
  if (!slide) return null;

  const onKeyDown = (event: KeyEventLike) => {
    const action = carouselKeyAction(event.key ?? event.nativeEvent?.key ?? '');
    if (!action) return;
    event.preventDefault?.();
    setIndex(applyCarouselAction(current, action, count));
  };
  // Web: hover, focus-within and the keyboard (react-native-web passes these through to the element).
  const web =
    Platform.OS === 'web'
      ? ({
        role: 'region',
        'aria-roledescription': 'carousel',
        'aria-label': t('home:home.store.carouselA11y', { total: count }),
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
        onKeyDown,
      } as object)
      : null;

  return (
    <View testID="home-weekly-pick">
      <SectionHeader title={t('home:home.store.weeklyPick')} />
      <View {...web} style={styles.carousel}>
        {/* Screen readers hear the new slide when someone changed it, not every few seconds by itself. The
            slide is not re-created per series (no key), so the keyboard focus stays on Watch now / Details
            when the arrow keys change the slide instead of falling back to the page. */}
        <View {...(Platform.OS === 'web' ? ({ 'aria-live': auto ? 'off' : 'polite' } as object) : null)}>
          <Slide series={slide} tags={tags} index={current} count={count} />
        </View>
        {count > 1 ? (
          <View style={styles.controls}>
            {series.map((s, i) => (
              <Dot
                key={s.id}
                active={i === current}
                label={t('home:home.store.showSlideA11y', { title: s.title, index: i + 1, total: count })}
                onPress={() => setIndex(i)}
              />
            ))}
            {reduceMotion ? null : (
              <ControlButton
                icon={paused ? 'play' : 'pause'}
                label={t(paused ? 'home:home.store.playA11y' : 'home:home.store.pauseA11y')}
                onPress={() => setPaused((p) => !p)}
              />
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Slide({ series, tags, index, count }: { series: SeriesCard; tags: readonly TagRow[]; index: number; count: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { size, isCompact } = useLayout();
  const text = useStoreText(tags)(series);
  const detail = useSeries(series.slug);
  const episodes = useEpisodeSummary(series.id);

  const ai = isAiSeries(series);
  const mature = series.maturity === 'mature';
  const synopsis = detail.data?.synopsis?.trim() ?? '';
  const openSeries = () => router.push(routes.series(series.slug));
  const watch = () => router.push(episodes.firstId ? routes.watch(episodes.firstId) : routes.series(series.slug));
  const metaLine = episodes.count > 0
    ? t('series:metaLine', { meta: text.meta, episodes: t('common:episode.count', { count: episodes.count }) })
    : text.meta;
  const web = Platform.OS === 'web'
    ? ({ role: 'group', 'aria-roledescription': 'slide', 'aria-label': t('home:home.store.slideA11y', { index: index + 1, total: count }) } as object)
    : null;

  const actions = (
    <View style={styles.actions}>
      <Button
        label={t('home:home.store.watchNow')}
        accessibilityLabel={episodes.firstId ? t('home:home.store.watchNowA11y', { title: series.title }) : t('home:home.store.openA11y', { title: series.title })}
        size={isCompact ? 'sm' : 'md'}
        onPress={watch}
        icon={<DecorativeIcon name="play" size={PLAY_ICON} color="onAccent" />}
      />
      <Button
        label={t('home:home.hero.details')}
        accessibilityLabel={t('home:home.hero.detailsA11y', { title: series.title })}
        variant="secondary"
        size={isCompact ? 'sm' : 'md'}
        onPress={openSeries}
      />
    </View>
  );

  return (
    <View {...web} style={styles.slideWrap}>
      <View style={[styles.slide, isCompact && styles.slideCompact]}>
        {/* The poster repeats "Details" for the mouse; screen readers and the keyboard use the buttons. */}
        <Pressable
          onPress={openSeries}
          accessible={false}
          focusable={false}
          importantForAccessibility="no-hide-descendants"
          {...(Platform.OS === 'web' ? ({ 'aria-hidden': true, tabIndex: -1 } as object) : null)}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <FilmStrip>
            <Cover series={series} width={POSTER_WIDTH[size]} ratio={POSTER_RATIO} style={styles.poster}>
              {ai ? (
                <View style={styles.coverBadge}>
                  <AIBadge size="sm" />
                </View>
              ) : null}
            </Cover>
          </FilmStrip>
        </Pressable>

        <View style={styles.body}>
          {series.editors_pick ? (
            <Text variant="caption" color="accentStrong" style={styles.eyebrow}>
              {t('home:home.store.editorsPick')}
            </Text>
          ) : null}
          <Text
            variant={isCompact ? 'heading' : 'display'}
            accessibilityRole="header"
            {...headingLevel(3)}
            numberOfLines={2}
          >
            {series.title}
          </Text>
          <Text variant="bodySmall" color="inkMuted">
            {metaLine}
          </Text>
          {ai || mature ? (
            <View style={styles.labels}>
              {ai ? <AIBadge size="md" /> : null}
              {mature ? <MaturityMarker /> : null}
            </View>
          ) : null}
          {synopsis ? (
            <Text numberOfLines={isCompact ? SYNOPSIS_LINES.compact : SYNOPSIS_LINES.wide} style={styles.synopsis}>
              {synopsis}
            </Text>
          ) : detail.isPending ? (
            <View style={styles.synopsisSkeleton}>
              <Skeleton width="90%" />
              <Skeleton width="60%" />
            </View>
          ) : null}
          {isCompact ? null : actions}
        </View>
      </View>
      {isCompact ? actions : null}
    </View>
  );
}

/**
 * The Weekly pick's place while the catalog has no series at all: a "Coming soon" poster in the film strip and
 * an invitation to post a series (Become a creator). Never shown when there is a series to feature, and never
 * a slide among real ones (heroMode).
 */
export function WeeklyPickInvite() {
  const { t } = useTranslation();
  const router = useRouter();
  const { size, isCompact } = useLayout();
  const action = (
    <View style={styles.actions}>
      <Button
        label={t('home:home.store.comingSoon.invite.cta')}
        size={isCompact ? 'sm' : 'md'}
        onPress={() => router.push('/create' as Href)}
      />
    </View>
  );
  return (
    <View testID="home-weekly-pick-invite">
      <SectionHeader title={t('home:home.store.weeklyPick')} />
      <View style={styles.slideWrap}>
        <View style={[styles.slide, isCompact && styles.slideCompact]}>
          {/* The heading beside it says the same: the poster is decoration. */}
          <View {...hiddenFromScreenReaders}>
            <FilmStrip>
              <ComingSoonArt width={POSTER_WIDTH[size]} ratio={POSTER_RATIO} words="title" sprockets={false} style={styles.poster} />
            </FilmStrip>
          </View>
          <View style={styles.body}>
            <Text variant={isCompact ? 'heading' : 'display'} accessibilityRole="header" {...headingLevel(3)}>
              {t('home:home.store.comingSoon.invite.title')}
            </Text>
            <Text style={styles.synopsis}>{t('home:home.store.comingSoon.invite.body')}</Text>
            {isCompact ? null : action}
          </View>
        </View>
        {isCompact ? action : null}
      </View>
    </View>
  );
}

/** A strip of film around the poster: a dark frame with sprocket holes along the top and bottom edges. */
function FilmStrip({ children }: { children: ReactNode }) {
  const holes = (
    <View style={styles.sprockets}>
      {Array.from({ length: SPROCKETS }, (_, i) => (
        <View key={i} style={styles.sprocket} />
      ))}
    </View>
  );
  return (
    <View style={styles.strip}>
      {holes}
      {children}
      {holes}
    </View>
  );
}

function Dot({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const { hovered, focusVisible, handlers } = useInteraction();
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      {...(Platform.OS === 'web' ? ({ 'aria-current': active ? 'true' : undefined } as object) : null)}
      style={[styles.control, focusVisible && focusRing]}
    >
      <View style={[styles.dot, active && styles.dotActive, hovered && !active && styles.dotHover]} />
    </Pressable>
  );
}

function ControlButton({ icon, label, onPress }: { icon: 'play' | 'pause'; label: string; onPress: () => void }) {
  const { hovered, focusVisible, handlers } = useInteraction();
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.control, styles.pause, hovered && styles.pauseHover, focusVisible && focusRing]}
    >
      <DecorativeIcon name={icon} size={CONTROL_ICON} color="ink" />
    </Pressable>
  );
}

/** Holds the carousel's place while the catalog loads. */
export function WeeklyPickSkeleton() {
  const { size } = useLayout();
  const width = POSTER_WIDTH[size];
  return (
    <View>
      <Skeleton width={160} height={space.xl} />
      <View style={[styles.slide, styles.skeleton]}>
        <Skeleton width={width + 2 * STRIP_SIDE} height={Math.ceil(width / POSTER_RATIO) + 2 * STRIP_EDGE + 2 * SPROCKET_H} />
        <View style={styles.body}>
          <Skeleton width="70%" height={space.xxl} />
          <Skeleton width="40%" />
          <Skeleton width="90%" />
          <Skeleton width="80%" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  carousel: { gap: space.md },
  slideWrap: { gap: space.lg },
  slide: { flexDirection: 'row', alignItems: 'center', gap: space.xl },
  slideCompact: { alignItems: 'flex-start', gap: space.lg },
  skeleton: { marginTop: space.lg },
  pressed: { opacity: 0.85 },
  strip: {
    paddingHorizontal: STRIP_SIDE,
    gap: space.xs,
    paddingVertical: space.xs,
    borderRadius: radius.chip,
    backgroundColor: colors.film,
  },
  sprockets: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.xs, height: SPROCKET_H + space.xs, alignItems: 'center' },
  sprocket: { width: SPROCKET_W, height: SPROCKET_H, borderRadius: 1, backgroundColor: colors.bg },
  poster: { borderRadius: space.xs },
  coverBadge: { position: 'absolute', top: space.sm, left: space.sm },
  body: { flex: 1, minWidth: 0, gap: space.sm },
  eyebrow: { fontFamily: fonts.sansBold },
  labels: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  synopsis: { marginTop: space.xs, maxWidth: 560 },
  synopsisSkeleton: { gap: space.sm, marginTop: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.md },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  control: {
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  // Idle dots in inkMuted: a control needs 3:1 against the page (line, the old colour, is 1.2:1).
  dot: { width: DOT, height: DOT, borderRadius: radius.pill, backgroundColor: colors.inkMuted },
  dotHover: { backgroundColor: colors.ink },
  dotActive: { width: DOT_ACTIVE, backgroundColor: colors.accentStrong },
  pause: { marginLeft: space.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pauseHover: { borderColor: colors.inkMuted },
});
