import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { focusRing, PageContainer, ResponsiveGrid, TwoColumn, useInteraction, useLayout } from '../../../components/layout';
import { AIBadge, Button, Skeleton, Text } from '../../../components/ui';
import { describeError } from '../../../core/errors';
import { colors, fonts, radius, space } from '../../../theme/tokens';
import { ErrorText } from '../../auth';
import { CoinAmount } from '../components/CoinAmount';
import { useAiPrices, useMyStories } from '../hooks';
import { errorWithoutData, storyListTitle, storyStatusKey } from '../logic';
import type { AiStoryRow } from '../types';

// The Create tab: write an AI story (the price shown up front), go back to one of your stories, and the
// two ways to create that aren't built yet (upload, stop-motion), shown as "coming soon" cards that
// don't pretend to open anything.
//
// One column on phones and in the apps. In a browser window with the site's top bar: a page with the footer;
// on a wide window the AI card and "Your stories" sit side by side, and the coming-soon cards share a row.

const ROW_MIN_HEIGHT = 56;
const ICON = 22;
const SKELETON_ROWS = 2;
// About the height of the two price lines, so the card doesn't jump when they arrive.
const PRICE_SKELETON_HEIGHT = space.xxl + space.md;

type IconName = ComponentProps<typeof Ionicons>['name'];

/** "How it works" on a laptop-sized window: the steps and the Meta models each one uses (server: ai/scene.ts). */
const HOW_STEPS = ['write', 'plan', 'scene', 'choose'] as const;
const HOW_NUMBER = 28;

export function CreateScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const prices = useAiPrices();
  const stories = useMyStories();
  const [refreshing, setRefreshing] = useState(false);
  const { hasTopNav } = useLayout();

  // The prices pricing_config gives, never a guess: nothing while they load, and story/new shows them (or the error) before Begin.
  const aiPrices = prices.data ?? null;
  // A failed refresh keeps the list it had; the error shows only when there is nothing to list.
  const listFailure = errorWithoutData(stories);
  const listError = listFailure ? describeError(listFailure) : null;

  const refresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([stories.refetch(), prices.refetch()]);
    setRefreshing(false);
  };

  const aiCard = (
    <View style={[styles.aiCard, hasTopNav && styles.aiCardWide]} testID="create-ai-card">
      <View style={styles.badge}>
        <AIBadge size="sm" />
      </View>
      <Text variant="heading" accessibilityRole="header">
        {t('create:ai.title')}
      </Text>
      <Text style={styles.gapSm}>{t('create:ai.body')}</Text>
      <View style={styles.price}>
        {aiPrices ? (
          <>
            <CoinAmount coins={aiPrices.storyStart} variant="body" />
            <Text variant="bodySmall" color="inkMuted" style={styles.priceDetail}>
              {t('create:ai.priceDetail', { scene: t('common:coins.count', { count: aiPrices.comicScene }) })}
            </Text>
          </>
        ) : prices.isPending ? (
          <Skeleton height={PRICE_SKELETON_HEIGHT} width="60%" />
        ) : null}
      </View>
      <View style={hasTopNav ? styles.ctaWide : null}>
        <Button
          label={t('create:ai.cta')}
          onPress={() => router.push('/story/new')}
          fullWidth={!hasTopNav}
          testID="create-ai-start"
        />
      </View>
    </View>
  );

  // The reader's stories (nothing at all when there are none yet).
  const storiesSection = stories.isPending || listError || (stories.data && stories.data.length > 0) ? (
    <View style={hasTopNav ? null : styles.section}>
      {/* The titles were written by AI: the list carries the label too. */}
      <View style={[styles.sectionHead, styles.sectionTitle]}>
        <Text variant="subheading" accessibilityRole="header" style={styles.flex}>
          {t('create:stories.title')}
        </Text>
        <AIBadge size="sm" />
      </View>
      {stories.isPending ? (
        <View style={styles.list} accessible accessibilityLabel={t('common:state.loading')}>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <Skeleton key={i} height={ROW_MIN_HEIGHT} />
          ))}
        </View>
      ) : listError ? (
        <View style={styles.listError}>
          <ErrorText error={{ key: listError.key, params: listError.params }} />
          <Button label={t('common:actions.retry')} onPress={() => void stories.refetch()} variant="secondary" size="sm" />
        </View>
      ) : (
        <View style={[styles.list, styles.listCard]}>
          {(stories.data ?? []).map((story, i) => (
            <StoryRow
              key={story.id}
              story={story}
              first={i === 0}
              onPress={() => router.push({ pathname: '/story/[id]', params: { id: story.id } })}
            />
          ))}
        </View>
      )}
    </View>
  ) : null;

  return (
    <PageContainer
      width={hasTopNav ? 'content' : 'narrow'}
      scrollViewProps={Platform.OS === 'web' ? undefined : {
        refreshControl: <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.inkMuted} />,
      }}
      testID="create-page"
    >
      <Text variant="title" accessibilityRole="header">
        {t('create:title')}
      </Text>
      <Text color="inkMuted" style={styles.subtitle}>
        {t('create:subtitle')}
      </Text>

      <View style={styles.top}>
        {storiesSection && hasTopNav ? (
          <TwoColumn main={aiCard} side={storiesSection} stickySide sideLabel={t('create:stories.title')} />
        ) : (
          <>
            {aiCard}
            {storiesSection}
          </>
        )}
      </View>

      {hasTopNav ? (
        <View style={styles.section} testID="create-how">
          <Text variant="subheading" accessibilityRole="header" style={styles.sectionTitle}>
            {t('create:how.title')}
          </Text>
          <ResponsiveGrid columns={{ compact: 1, medium: 2, wide: 4 }} gap={space.md}>
            {HOW_STEPS.map((step, i) => (
              <HowStep key={step} number={i + 1} text={t(`create:how.${step}`)} />
            ))}
          </ResponsiveGrid>
          <Text variant="caption" color="inkMuted" style={styles.gapSm}>
            {t('create:how.models')}
          </Text>
        </View>
      ) : null}

      {/* Not built yet: shown, but nothing to tap */}
      <View style={styles.section}>
        <Text variant="subheading" accessibilityRole="header" style={styles.sectionTitle}>
          {t('create:more.title')}
        </Text>
        <ResponsiveGrid columns={{ compact: 1, medium: 2, wide: 2 }}>
          <SoonCard icon="cloud-upload-outline" title={t('create:upload.title')} body={t('create:upload.body')} testID="create-upload-soon" />
          <SoonCard icon="camera-outline" title={t('create:stopMotion.title')} body={t('create:stopMotion.body')} testID="create-stop-motion-soon" />
        </ResponsiveGrid>
      </View>
    </PageContainer>
  );
}

function StoryRow({ story, first, onPress }: { story: AiStoryRow; first: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const { hovered, focusVisible, handlers } = useInteraction();
  const title = storyListTitle(story) ?? t('create:stories.untitled');
  const status = t(storyStatusKey(story.status));
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('create:stories.rowA11y', { title, status })}
      {...handlers}
      style={({ pressed }) => [
        styles.row,
        !first && styles.rowLine,
        hovered && styles.rowHover,
        pressed && styles.pressed,
        focusVisible && focusRing,
      ]}
      testID={`create-story-${story.id}`}
    >
      <View style={styles.rowTexts}>
        <Text variant="body" numberOfLines={2} style={styles.rowTitle}>
          {title}
        </Text>
        <Text variant="caption" color="inkMuted">
          {status}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={ICON} color={colors.inkMuted} />
    </Pressable>
  );
}

function HowStep({ number, text }: { number: number; text: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.how} accessible accessibilityLabel={t('create:how.stepA11y', { number, text })}>
      <View style={styles.howNumber}>
        <Text variant="bodySmall" color="surface" style={styles.howNumberText}>
          {number}
        </Text>
      </View>
      <Text variant="bodySmall" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

function SoonCard({ icon, title, body, testID }: { icon: IconName; title: string; body: string; testID: string }) {
  const { t } = useTranslation();
  const soon = t('create:comingSoon');
  return (
    <View
      style={styles.soon}
      accessible
      accessibilityLabel={`${title}. ${soon}. ${body}`}
      accessibilityState={{ disabled: true }}
      testID={testID}
    >
      <View style={styles.soonIcon}>
        <Ionicons name={icon} size={ICON} color={colors.inkMuted} />
      </View>
      <View style={styles.rowTexts}>
        <View style={styles.soonHead}>
          <Text variant="body" style={styles.rowTitle}>
            {title}
          </Text>
          <View style={styles.pill}>
            <Text variant="caption" style={styles.pillText}>
              {soon}
            </Text>
          </View>
        </View>
        <Text variant="bodySmall" color="inkMuted">
          {body}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: space.xs },
  top: { marginTop: space.xl },
  gapSm: { marginTop: space.sm },
  aiCard: {
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.ai,
    backgroundColor: colors.surface,
  },
  aiCardWide: { padding: space.xl },
  ctaWide: { alignItems: 'flex-start' },
  badge: { alignItems: 'flex-start', marginBottom: space.sm },
  price: { marginTop: space.md, marginBottom: space.lg, gap: space.xs },
  priceDetail: { flexShrink: 1 },
  section: { marginTop: space.xl },
  sectionTitle: { marginBottom: space.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  list: { gap: space.sm },
  listCard: {
    gap: 0,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  listError: { gap: space.sm, alignItems: 'flex-start' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ROW_MIN_HEIGHT,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.md,
  },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  rowHover: { backgroundColor: colors.surfaceAlt },
  rowTexts: { flex: 1, gap: space.xs },
  rowTitle: { fontFamily: fonts.sansMedium },
  pressed: { opacity: 0.6 },
  how: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexGrow: 1,
  },
  howNumber: {
    width: HOW_NUMBER,
    height: HOW_NUMBER,
    borderRadius: HOW_NUMBER / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ai,
  },
  howNumberText: { fontFamily: fonts.sansBold },
  soon: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: space.lg,
    gap: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceAlt,
  },
  soonIcon: { paddingTop: space.xs },
  soonHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  pill: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs / 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pillText: { fontFamily: fonts.sansMedium },
});
