import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { focusRing, ResponsiveGrid, useInteraction, useLayout } from '../../../../components/layout';
import { AIBadge, Button, Text } from '../../../../components/ui';
import type { TagRow } from '../../../../lib/types';
import { colors, fonts, layout, radius, space } from '../../../../theme/tokens';
import { useEpisodeSummary } from '../../hooks';
import { isAiSeries, type SeriesCard } from '../../logic';
import { routes } from '../../routes';
import { wrapIndex } from '../../storefront';
import { headingLevel } from '../a11y';
import { CardLink } from '../CardLink';
import { Cover, POSTER_RATIO } from '../Cover';
import { DecorativeIcon } from '../DecorativeIcon';
import { MaturityMarker } from '../MaturityMarker';
import { SectionHeader } from './SectionHeader';
import { useStoreText } from './useStoreText';

/** Strip thumbnails are 3:4 and wide enough to carry the AI badge (about 104 px) on the picture. */
const THUMB_WIDTH = 112;
const PREVIEW_WIDTH = 140;
const PREVIEW_WIDTH_COMPACT = 112;
const SELECTED_BORDER = 3;
const PLAY_ICON = 16;
const EDITOR_COVER = 64;
/** Room around the thumbnails for the selection border and the focus ring (a scroll view clips what sticks out). */
const RING_ROOM = layout.focusRingWidth + layout.focusRingOffset + SELECTED_BORDER;

/**
 * "New arrivals": the newest series as a strip of small posters; the one picked shows large underneath with
 * its title, genre and Watch now.
 */
export function NewArrivals({ items, tags }: { items: readonly SeriesCard[]; tags: readonly TagRow[] }) {
  const { t } = useTranslation();
  const { isCompact } = useLayout();
  const [selected, setSelected] = useState(0);
  const current = items[wrapIndex(selected, items.length)];
  if (!current) return null;
  const title = t('home:home.store.newArrivals');
  const web = Platform.OS === 'web';

  return (
    <View testID="home-new-arrivals">
      <SectionHeader title={title} />
      <View style={[styles.panel, isCompact && styles.panelCompact]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.stripScroll}
          contentContainerStyle={styles.strip}
        >
          <View role={web ? 'list' : undefined} aria-label={title} style={styles.stripList}>
            {items.map((s, i) => (
              <View key={s.id} role={web ? 'listitem' : undefined}>
                <Thumb
                  series={s}
                  selected={s.id === current.id}
                  width={THUMB_WIDTH}
                  onPress={() => setSelected(i)}
                />
              </View>
            ))}
          </View>
        </ScrollView>
        <Preview key={current.id} series={current} tags={tags} />
      </View>
    </View>
  );
}

function Thumb({ series, selected, width, onPress }: { series: SeriesCard; selected: boolean; width: number; onPress: () => void }) {
  const { t } = useTranslation();
  const { hovered, focusVisible, handlers } = useInteraction();
  const ai = isAiSeries(series);
  const label = [t('home:home.store.arrivalsPickA11y', { title: series.title }), ai ? t('common:a11y.madeWithAi') : null]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      {...(Platform.OS === 'web' ? ({ 'aria-pressed': selected } as object) : null)}
      style={[styles.thumb, selected && styles.thumbSelected, hovered && !selected && styles.thumbHover, focusVisible && focusRing]}
    >
      <Cover series={series} width={width} initialVariant="heading" style={styles.thumbCover}>
        {ai ? (
          <View style={styles.thumbBadge}>
            <AIBadge size="sm" />
          </View>
        ) : null}
      </Cover>
    </Pressable>
  );
}

function Preview({ series, tags }: { series: SeriesCard; tags: readonly TagRow[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { isCompact } = useLayout();
  const text = useStoreText(tags)(series);
  const episodes = useEpisodeSummary(series.id);
  const ai = isAiSeries(series);
  const openSeries = () => router.push(routes.series(series.slug));
  const info = [
    episodes.count > 0 ? t('common:episode.count', { count: episodes.count }) : null,
    series.completed ? t('home:home.store.completedLabel') : null,
  ].filter((x): x is string => !!x).join(' · ');

  return (
    <View style={styles.preview}>
      {/* The poster repeats "Details" for the mouse; screen readers and the keyboard use the buttons. */}
      <Pressable
        onPress={openSeries}
        accessible={false}
        focusable={false}
        importantForAccessibility="no-hide-descendants"
        {...(Platform.OS === 'web' ? ({ 'aria-hidden': true, tabIndex: -1 } as object) : null)}
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        <Cover series={series} width={isCompact ? PREVIEW_WIDTH_COMPACT : PREVIEW_WIDTH} ratio={POSTER_RATIO}>
          {ai ? (
            <View style={styles.badge}>
              <AIBadge size="sm" />
            </View>
          ) : null}
        </Cover>
      </Pressable>
      <View style={styles.previewText}>
        <Text variant="heading" accessibilityRole="header" {...headingLevel(3)} numberOfLines={2}>
          {series.title}
        </Text>
        <Text variant="bodySmall" color="inkMuted">
          {text.meta}
        </Text>
        {info ? (
          <Text variant="caption" color="inkMuted">
            {info}
          </Text>
        ) : null}
        {ai || series.maturity === 'mature' ? (
          <View style={styles.labels}>
            {ai ? <AIBadge size="md" /> : null}
            {series.maturity === 'mature' ? <MaturityMarker /> : null}
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button
            label={t('home:home.store.watchNow')}
            accessibilityLabel={episodes.firstId ? t('home:home.store.watchNowA11y', { title: series.title }) : t('home:home.store.openA11y', { title: series.title })}
            size="sm"
            loading={episodes.isPending}
            onPress={() => router.push(episodes.firstId ? routes.watch(episodes.firstId) : routes.series(series.slug))}
            icon={<DecorativeIcon name="play" size={PLAY_ICON} color="onAccent" />}
          />
          <Button
            label={t('home:home.hero.details')}
            accessibilityLabel={t('home:home.hero.detailsA11y', { title: series.title })}
            variant="secondary"
            size="sm"
            onPress={openSeries}
          />
        </View>
      </View>
    </View>
  );
}

/** "Editors' choice": the Editor's Picks as a two-column list of cover, title and genre. */
export function EditorsChoice({ items, tags }: { items: readonly SeriesCard[]; tags: readonly TagRow[] }) {
  const { t } = useTranslation();
  const title = t('home:home.store.editorsChoice');
  return (
    <View testID="home-editors-choice">
      <SectionHeader title={title} />
      <ResponsiveGrid
        items={items}
        keyExtractor={(s) => s.id}
        columns={{ compact: 1, medium: 2, wide: 2 }}
        gap={space.lg}
        accessibilityLabel={title}
        renderItem={(s) => <EditorItem series={s} tags={tags} />}
      />
    </View>
  );
}

function EditorItem({ series, tags }: { series: SeriesCard; tags: readonly TagRow[] }) {
  const text = useStoreText(tags)(series);
  return (
    <CardLink
      href={routes.series(series.slug)}
      accessibilityLabel={text.a11y}
      cardStyle={(s) => [styles.editor, s.hovered && styles.editorHover, s.pressed && styles.pressed, s.focusVisible && focusRing]}
      render={(s) => (
        <>
          <Cover series={series} width={EDITOR_COVER} ratio={POSTER_RATIO} initialVariant="heading" style={styles.editorCover} />
          <View style={styles.editorText}>
            <Text variant="body" numberOfLines={2} style={[styles.editorTitle, s.hovered && styles.underline]}>
              {series.title}
            </Text>
            <Text variant="caption" color="inkMuted" numberOfLines={1}>
              {text.meta}
            </Text>
            {isAiSeries(series) ? <AIBadge size="sm" /> : null}
          </View>
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.xl, padding: space.xl, borderRadius: radius.sheet, backgroundColor: colors.surfaceAlt },
  panelCompact: { padding: space.lg, gap: space.lg, borderRadius: radius.card },
  stripScroll: { margin: -RING_ROOM },
  strip: { padding: RING_ROOM },
  stripList: { flexDirection: 'row', gap: space.md },
  thumb: { borderRadius: radius.chip, borderWidth: SELECTED_BORDER, borderColor: colors.surfaceAlt },
  thumbSelected: { borderColor: colors.accentStrong },
  thumbHover: { borderColor: colors.inkMuted },
  thumbCover: { borderRadius: space.xs },
  thumbBadge: { position: 'absolute', top: space.xs, left: space.xs },
  pressed: { opacity: 0.8 },
  preview: { flexDirection: 'row', gap: space.xl, alignItems: 'flex-start' },
  badge: { position: 'absolute', top: space.sm, left: space.sm },
  previewText: { flex: 1, minWidth: 0, gap: space.sm },
  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.sm },
  editor: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.sm,
    margin: -space.sm,
    borderRadius: radius.card,
    alignItems: 'flex-start',
  },
  editorHover: { backgroundColor: colors.surfaceAlt },
  editorCover: { borderRadius: radius.chip },
  editorText: { flex: 1, minWidth: 0, gap: space.xs, paddingTop: space.xs },
  editorTitle: { fontFamily: fonts.sansMedium },
  underline: { textDecorationLine: 'underline' },
});
