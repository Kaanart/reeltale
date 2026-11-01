import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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

const MAX_WIDTH = 560;
const ROW_MIN_HEIGHT = 56;
const ICON = 22;
const SKELETON_ROWS = 2;
// About the height of the two price lines, so the card doesn't jump when they arrive.
const PRICE_SKELETON_HEIGHT = space.xxl + space.md;

type IconName = ComponentProps<typeof Ionicons>['name'];

export function CreateScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const prices = useAiPrices();
  const stories = useMyStories();
  const [refreshing, setRefreshing] = useState(false);

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

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={Platform.OS === 'web' ? undefined : (
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.inkMuted} />
        )}
      >
        <View style={styles.column}>
          <Text variant="title" accessibilityRole="header">
            {t('create:title')}
          </Text>
          <Text color="inkMuted" style={styles.subtitle}>
            {t('create:subtitle')}
          </Text>

          {/* Write an AI story */}
          <View style={styles.aiCard} testID="create-ai-card">
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
            <Button
              label={t('create:ai.cta')}
              onPress={() => router.push('/story/new')}
              fullWidth
              testID="create-ai-start"
            />
          </View>

          {/* The reader's stories */}
          {stories.isPending || listError || (stories.data && stories.data.length > 0) ? (
            <View style={styles.section}>
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
          ) : null}

          {/* Not built yet: shown, but nothing to tap */}
          <View style={styles.section}>
            <Text variant="subheading" accessibilityRole="header" style={styles.sectionTitle}>
              {t('create:more.title')}
            </Text>
            <SoonCard icon="cloud-upload-outline" title={t('create:upload.title')} body={t('create:upload.body')} testID="create-upload-soon" />
            <SoonCard icon="camera-outline" title={t('create:stopMotion.title')} body={t('create:stopMotion.body')} testID="create-stop-motion-soon" />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StoryRow({ story, first, onPress }: { story: AiStoryRow; first: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const title = storyListTitle(story) ?? t('create:stories.untitled');
  const status = t(storyStatusKey(story.status));
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('create:stories.rowA11y', { title, status })}
      style={({ pressed }) => [styles.row, !first && styles.rowLine, pressed && styles.pressed]}
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
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, paddingHorizontal: space.lg, paddingVertical: space.lg },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  subtitle: { marginTop: space.xs },
  gapSm: { marginTop: space.sm },
  aiCard: {
    marginTop: space.xl,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.ai,
    backgroundColor: colors.surface,
  },
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
  rowTexts: { flex: 1, gap: space.xs },
  rowTitle: { fontFamily: fonts.sansMedium },
  pressed: { opacity: 0.6 },
  soon: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: space.sm,
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
