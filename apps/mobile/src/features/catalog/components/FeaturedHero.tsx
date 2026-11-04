import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { useLayout } from '../../../components/layout';
import { AIBadge, Button, Skeleton, Text } from '../../../components/ui';
import { colors, fonts, radius, space } from '../../../theme/tokens';
import { useEpisodes, useSeries, useSeriesProgress } from '../hooks';
import { heroCoverWidth } from '../layout';
import { isAiSeries, pickResume, type SeriesCard } from '../logic';
import { routes } from '../routes';
import { headingLevel } from './a11y';
import { Cover } from './Cover';
import { DecorativeIcon } from './DecorativeIcon';
import { MaturityMarker } from './MaturityMarker';
import { useSeriesText } from './useSeriesText';

const SYNOPSIS_LINES = 3;
const PLAY_ICON = 16;
const SYNOPSIS_SKELETON_LINES = 2;

/**
 * Home's featured Editor's Pick on wider screens: a big cover, the title, what it is, the start of the
 * summary, and Play / Continue (the same episode the series page would start) next to Details. The summary
 * and the episodes come from the same queries the series page uses, so opening it afterwards is instant.
 */
export function FeaturedHero({ series }: { series: SeriesCard }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { size } = useLayout();
  const text = useSeriesText()(series);

  const detail = useSeries(series.slug);
  const episodes = useEpisodes(series.id);
  const episodeIds = useMemo(() => (episodes.data ?? []).map((e) => e.id), [episodes.data]);
  const progress = useSeriesProgress(series.id, episodeIds);
  const resume = useMemo(() => pickResume(episodes.data ?? [], progress.data ?? []), [episodes.data, progress.data]);

  const ai = isAiSeries(series);
  const mature = series.maturity === 'mature';
  const synopsis = detail.data?.synopsis?.trim() ?? '';
  const openSeries = () => router.push(routes.series(series.slug));
  const coverWidth = heroCoverWidth(size);

  return (
    <View style={styles.card} testID="home-featured">
      {/* The cover repeats "Details" for the mouse; screen readers and the keyboard use the buttons. */}
      <Pressable
        onPress={openSeries}
        accessible={false}
        focusable={false}
        importantForAccessibility="no-hide-descendants"
        {...(Platform.OS === 'web' ? ({ 'aria-hidden': true, tabIndex: -1 } as object) : null)}
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        <Cover series={series} width={coverWidth}>
          {ai ? (
            <View style={styles.coverBadge}>
              <AIBadge size="sm" />
            </View>
          ) : null}
        </Cover>
      </Pressable>

      <View style={styles.body}>
        <Text variant="caption" color="accentStrong" style={styles.eyebrow}>
          {t('series:editorsPick')}
        </Text>
        <Text variant="display" accessibilityRole="header" {...headingLevel(2)} numberOfLines={2}>
          {series.title}
        </Text>
        <Text variant="bodySmall" color="inkMuted">
          {episodes.data && episodes.data.length > 0
            ? t('series:metaLine', { meta: text.meta, episodes: t('common:episode.count', { count: episodes.data.length }) })
            : text.meta}
        </Text>
        {ai || mature ? (
          <View style={styles.labels}>
            {ai ? <AIBadge size="md" /> : null}
            {mature ? <MaturityMarker /> : null}
          </View>
        ) : null}

        {synopsis ? (
          <Text numberOfLines={SYNOPSIS_LINES} style={styles.synopsis}>
            {synopsis}
          </Text>
        ) : detail.isPending ? (
          <View style={styles.synopsisSkeleton}>
            {Array.from({ length: SYNOPSIS_SKELETON_LINES }, (_, i) => (
              <Skeleton key={i} width={i === 0 ? '90%' : '60%'} />
            ))}
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            label={resume?.resumed ? t('series:continue') : t('series:play')}
            accessibilityLabel={
              resume
                ? resume.resumed
                  ? t('home:home.hero.continueA11y', { title: series.title, number: resume.number })
                  : t('home:home.hero.playA11y', { title: series.title, number: resume.number })
                : undefined
            }
            disabled={!resume}
            loading={episodes.isPending}
            onPress={() => resume && router.push(routes.watch(resume.episodeId))}
            icon={resume ? <DecorativeIcon name="play" size={PLAY_ICON} color="onAccent" /> : undefined}
          />
          <Button
            label={t('home:home.hero.details')}
            accessibilityLabel={t('home:home.hero.detailsA11y', { title: series.title })}
            variant="secondary"
            onPress={openSeries}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xl,
    padding: space.xl,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.8 },
  coverBadge: { position: 'absolute', top: space.sm, left: space.sm },
  body: { flex: 1, minWidth: 0, gap: space.sm },
  eyebrow: { fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1 },
  labels: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  synopsis: { marginTop: space.xs },
  synopsisSkeleton: { gap: space.sm, marginTop: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.md },
});
