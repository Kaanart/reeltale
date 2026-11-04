import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { focusRing, PageContainer, TwoColumn, useInteraction, useLayout, usePageTitle } from '../../../components/layout';
import { AIBadge, Button, TagChip, Text } from '../../../components/ui';
import { describeError } from '../../../core/errors';
import { colors, fonts, layout, radius, space, type as typeScale } from '../../../theme/tokens';
import { ErrorText, TextLink, useUserId } from '../../auth';
import { CoinAmount } from '../components/CoinAmount';
import { ConsentCard } from '../components/ConsentCard';
import { PageHead } from '../components/PageHead';
import { ScreenHeader } from '../components/ScreenHeader';
import {
  storyKeys, useAiPrices, useCoinWallet, useStartRequestIds, useStartStory, useStory, useStoryConsent, useStoryTags,
} from '../hooks';
import {
  affordability, AI_MAX_TAGS, AI_PREMISE_MAX, AI_PREMISE_MIN, asUuid, checkPremise, errorWithoutData, startFingerprint, storyTags, TAG_SLUG, tagName, toggleTag,
} from '../logic';

// story/new: write the opening (20–1000 characters), pick up to 10 tags, see the price, allow AI once, and
// begin. Begin sends one request id per tap; tapping again after a failure, with the same opening, sends
// the same id, so a retry never charges twice (the server returns the story it already started). The ids
// outlive this screen (useStartRequestIds), so leaving and coming back is still a retry.
// story/new?from=<storyId> fills in an earlier opening (after it was blocked or failed).
//
// Phones and the apps: one column under the story header bar. A laptop-sized browser window: a page under the
// site's top bar, and on a wide window two columns: the opening, ideas and tags on the left; the consent, the
// price and Begin on the right, kept in view while the left column scrolls.

const MAX_WIDTH = 560;
const TARGET = 44;
const INPUT_MIN_HEIGHT = 140;
const TROPES_SHOWN = 12;
const IDEAS = ['lighthouse', 'market', 'train'] as const;
const SUMMARY_ICON = 18;

export function NewStoryScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ from?: string }>();
  const fromId = asUuid(params.from);

  const [premise, setPremise] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [allTropes, setAllTropes] = useState(false);
  const ids = useStartRequestIds();
  const { hasTopNav, isWide } = useLayout();
  usePageTitle(t('story:new.title'));

  const from = useStory(fromId);
  const tagList = useStoryTags();
  const prices = useAiPrices();
  const wallet = useCoinWallet();
  const consent = useStoryConsent();
  const start = useStartStory();

  // Fill in the earlier opening once.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !from.data) return;
    prefilled.current = true;
    setPremise(from.data.story.premise);
    setTags(from.data.story.tags.filter((s) => TAG_SLUG.test(s)).slice(0, AI_MAX_TAGS));
  }, [from.data]);

  const check = checkPremise(premise);
  // The price from pricing_config, never a guess: until it has loaded nothing is shown and Begin waits.
  const price = prices.data?.storyStart ?? null;
  const can = price === null ? 'unknown' : affordability(wallet.data, price);
  const consented = consent.data === true;
  const ready = check.ok && consented && price !== null && can !== 'short' && can !== 'debt';
  const consentError = errorWithoutData(consent);
  const priceError = errorWithoutData(prices);
  const groups = storyTags(tagList.data ?? []);
  const tropes = allTropes ? groups.tropes : groups.tropes.slice(0, TROPES_SHOWN);

  let premiseError: string | null = null;
  if (!check.ok && check.problem === 'too_long') premiseError = t('story:new.opening.tooLong', { max: AI_PREMISE_MAX });
  else if (!check.ok && touched) premiseError = t('story:new.opening.tooShort', { min: AI_PREMISE_MIN });

  const begin = () => {
    setTouched(true);
    // One request at a time: a second tap while the first is on its way would only wait for the same answer.
    if (!check.ok || !consented || price === null || !ids || start.isPending) return;
    const requestId = ids.idFor(startFingerprint(check.premise, tags));
    start.mutate(
      { premise: check.premise, tags, requestId, price },
      {
        onSuccess: (started) => {
          router.replace({ pathname: '/story/[id]', params: { id: started.story_id, scene: started.scene_id } });
        },
        onError: (err) => {
          if (describeError(err).action === 'ai_consent') void queryClient.invalidateQueries({ queryKey: storyKeys.consent(userId) });
        },
      },
    );
  };

  const startError = start.error ? describeError(start.error) : null;
  const blockedHint = !consented
    ? t('story:new.confirm.consentFirst')
    : !check.ok ? t('story:new.confirm.fixOpening') : null;
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/create'));

  const opening = (
    <>
      <Text variant="heading" accessibilityRole="header">
        {t('story:new.opening.title')}
      </Text>
      {fromId && from.data ? (
        <Text variant="bodySmall" color="inkMuted" style={styles.gapSm}>
          {t('story:new.editing')}
        </Text>
      ) : null}
      <TextInput
        value={premise}
        onChangeText={setPremise}
        onBlur={() => setTouched(true)}
        multiline
        maxLength={AI_PREMISE_MAX + 20}
        placeholder={t('story:new.opening.placeholder')}
        placeholderTextColor={colors.inkMuted}
        accessibilityLabel={t('story:new.opening.title')}
        accessibilityHint={premiseError ?? t('story:new.opening.hint', { min: AI_PREMISE_MIN, max: AI_PREMISE_MAX })}
        maxFontSizeMultiplier={1.6}
        textAlignVertical="top"
        style={[styles.input, hasTopNav && styles.inputWide, !!premiseError && styles.inputInvalid]}
        testID="story-premise"
      />
      <View style={styles.below}>
        <Text variant="caption" color={premiseError ? 'danger' : 'inkMuted'} accessibilityLiveRegion="polite" style={styles.flex}>
          {premiseError ?? t('story:new.opening.hint', { min: AI_PREMISE_MIN, max: AI_PREMISE_MAX })}
        </Text>
        <Text variant="caption" color={check.ok || premise.trim().length < AI_PREMISE_MAX ? 'inkMuted' : 'danger'}>
          {t('story:new.opening.counter', { length: premise.trim().length, max: AI_PREMISE_MAX })}
        </Text>
      </View>

      {premise.trim() === '' ? (
        <View style={styles.section}>
          <Text variant="bodySmall" color="inkMuted" style={styles.label}>
            {t('story:new.opening.ideasTitle')}
          </Text>
          <View style={hasTopNav ? styles.ideasWide : null}>
            {IDEAS.map((idea) => (
              <IdeaCard key={idea} text={t(`story:new.opening.ideas.${idea}`)} wide={hasTopNav} onPress={() => setPremise(t(`story:new.opening.ideas.${idea}`))} />
            ))}
          </View>
        </View>
      ) : null}
    </>
  );

  const tagsSection = (
    <View style={styles.section}>
      <View style={styles.row}>
        <Text variant="subheading" accessibilityRole="header" style={styles.flex}>
          {t('story:new.tags.title')}
        </Text>
        <Text variant="caption" color="inkMuted" accessibilityLiveRegion="polite">
          {t('story:new.tags.picked', { selected: tags.length, max: AI_MAX_TAGS })}
        </Text>
      </View>
      <Text variant="bodySmall" color="inkMuted" style={styles.gapXs}>
        {t('story:new.tags.hint', { max: AI_MAX_TAGS })}
      </Text>
      {errorWithoutData(tagList) ? (
        <Text variant="bodySmall" color="inkMuted" style={styles.gapSm}>
          {t('story:new.tags.loadFailed')}
        </Text>
      ) : null}
      {groups.genres.length > 0 ? (
        <>
          <Text variant="bodySmall" style={styles.groupLabel}>
            {t('story:new.tags.genres')}
          </Text>
          <View style={styles.chips}>
            {groups.genres.map((tag) => (
              <TagChip key={tag.slug} label={tagName(tag, i18n.language)} selected={tags.includes(tag.slug)} onPress={() => setTags((s) => toggleTag(s, tag.slug))} />
            ))}
          </View>
        </>
      ) : null}
      {groups.tropes.length > 0 ? (
        <>
          <Text variant="bodySmall" style={styles.groupLabel}>
            {t('story:new.tags.tropes')}
          </Text>
          <View style={styles.chips}>
            {tropes.map((tag) => (
              <TagChip key={tag.slug} label={tagName(tag, i18n.language)} selected={tags.includes(tag.slug)} onPress={() => setTags((s) => toggleTag(s, tag.slug))} />
            ))}
          </View>
          {groups.tropes.length > TROPES_SHOWN ? (
            <View style={styles.linkRow}>
              <TextLink
                label={t(allTropes ? 'story:new.tags.showFewer' : 'story:new.tags.showAll')}
                onPress={() => setAllTropes((v) => !v)}
              />
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );

  // Format: comics only for now.
  const formatSection = (
    <View style={styles.section}>
      <Text variant="subheading" accessibilityRole="header">
        {t('story:new.look.format')}
      </Text>
      <View style={hasTopNav ? styles.formatsWide : null}>
        <View style={[styles.format, styles.formatOn, hasTopNav && styles.formatWide]} accessible accessibilityState={{ selected: true }}>
          <Text variant="body" style={styles.bold}>{t('story:new.look.comic')}</Text>
          <Text variant="bodySmall" color="inkMuted">{t('story:new.look.comicHint')}</Text>
        </View>
        <View style={[styles.format, styles.formatOff, hasTopNav && styles.formatWide]} accessible accessibilityState={{ disabled: true }}>
          <Text variant="body" color="inkMuted" style={styles.bold}>{t('story:new.look.video')}</Text>
          <Text variant="bodySmall" color="inkMuted">{t('story:new.look.videoSoon')}</Text>
        </View>
      </View>
    </View>
  );

  // Consent, once.
  const consentSection = (
    <>
      {consent.data === false ? (
        <View style={styles.section}>
          <ConsentCard />
        </View>
      ) : null}
      {consentError ? (
        <View style={styles.gapSm}>
          <ErrorText error={{ key: describeError(consentError).key, params: describeError(consentError).params }} />
          <View style={styles.linkRow}>
            <TextLink label={t('common:actions.retry')} onPress={() => void consent.refetch()} testID="story-consent-reload" />
          </View>
        </View>
      ) : null}
    </>
  );

  const beginButton = (
    <>
      <Button
        label={t('story:new.confirm.begin')}
        accessibilityLabel={price !== null ? `${t('story:new.confirm.begin')}, ${t('common:coins.count', { count: price })}` : t('story:new.confirm.begin')}
        onPress={begin}
        disabled={!ready}
        loading={start.isPending}
        fullWidth
        testID="story-begin"
      />
      {blockedHint && !start.isPending ? (
        <Text variant="caption" color="inkMuted" style={[styles.gapSm, styles.center]}>
          {blockedHint}
        </Text>
      ) : null}
      <ErrorText error={startError ? { key: startError.key, params: startError.params } : null} />
    </>
  );

  // The price, before anything is spent. On a wide window Begin sits in the same card, under a short summary.
  const costCard = (withBegin: boolean) => (
    <View style={[styles.section, styles.cost]} testID="story-cost">
      {withBegin ? (
        <>
          <Text variant="heading" accessibilityRole="header">
            {t('story:new.confirm.title')}
          </Text>
          <View style={styles.summary}>
            <SummaryLine done={check.ok} label={t('story:new.summary.opening')} value={t('story:new.opening.counter', { length: premise.trim().length, max: AI_PREMISE_MAX })} />
            <SummaryLine done={tags.length > 0} optional label={t('story:new.tags.title')} value={t('story:new.tags.picked', { selected: tags.length, max: AI_MAX_TAGS })} />
            <SummaryLine done={consented} label={t('story:new.summary.ai')} value={t(consented ? 'story:new.summary.allowed' : 'story:new.summary.notYet')} />
          </View>
        </>
      ) : null}
      <View style={[styles.row, withBegin && styles.gapMd]}>
        <Text variant="subheading" style={styles.flex}>{t('story:new.confirm.cost')}</Text>
        {price !== null ? <CoinAmount coins={price} variant="subheading" /> : null}
      </View>
      {priceError ? (
        <View style={styles.gapSm}>
          <ErrorText error={{ key: describeError(priceError).key, params: describeError(priceError).params }} />
          <View style={styles.linkRow}>
            <TextLink label={t('common:actions.retry')} onPress={() => void prices.refetch()} testID="story-price-reload" />
          </View>
        </View>
      ) : null}
      <Text variant="bodySmall" color="inkMuted" style={styles.gapXs}>
        {t('story:new.confirm.costIncludes')}
      </Text>
      {wallet.data ? (
        <View style={[styles.row, styles.gapMd]}>
          <Text variant="bodySmall" style={styles.flex}>{t('story:new.confirm.balance')}</Text>
          <CoinAmount coins={wallet.data.balance} variant="bodySmall" />
        </View>
      ) : null}
      {can === 'short' ? (
        <Text variant="bodySmall" color="danger" style={styles.gapSm} accessibilityLiveRegion="polite">
          {t('story:new.confirm.notEnough')}
        </Text>
      ) : null}
      {can === 'debt' && wallet.data ? (
        <Text variant="bodySmall" color="danger" style={styles.gapSm}>
          {t('errors:refund_debt_outstanding_count', { count: wallet.data.refund_debt })}
        </Text>
      ) : null}
      {withBegin ? <View style={styles.gapLg}>{beginButton}</View> : null}
      <Text variant="caption" color="inkMuted" style={styles.gapMd}>
        {t('story:new.confirm.sendNote')}
      </Text>
      <Text variant="caption" color="inkMuted" style={styles.gapXs}>
        {t('story:new.confirm.refundNote')}
      </Text>
    </View>
  );

  if (hasTopNav) {
    const main = (
      <View>
        {opening}
        {tagsSection}
        {formatSection}
      </View>
    );
    const side = (
      <View>
        {consentSection}
        {costCard(true)}
      </View>
    );
    return (
      <PageContainer width={isWide ? 'content' : 'reading'} testID="story-new-page">
        <Stack.Screen options={{ title: t('story:new.title') }} />
        <PageHead title={t('story:new.title')} onBack={goBack} right={<AIBadge />} />
        <View style={styles.deskBody}>
          <TwoColumn main={main} side={side} stickySide sideLabel={t('story:new.confirm.title')} gap={space.xxl} />
        </View>
      </PageContainer>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: t('story:new.title') }} />
      <ScreenHeader
        title={t('story:new.title')}
        onBack={goBack}
        right={(
          <View style={styles.badge}>
            <AIBadge />
          </View>
        )}
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.column}>
            {opening}
            {tagsSection}
            {formatSection}
            {consentSection}
            {costCard(false)}
            <View style={styles.section}>{beginButton}</View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function IdeaCard({ text, wide, onPress }: { text: string; wide: boolean; onPress: () => void }) {
  const { hovered, focusVisible, handlers } = useInteraction();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      {...handlers}
      style={({ pressed }) => [
        styles.idea,
        wide && styles.ideaWide,
        hovered && styles.ideaHover,
        pressed && styles.pressed,
        focusVisible && focusRing,
      ]}
    >
      <Text variant="bodySmall">{text}</Text>
    </Pressable>
  );
}

function SummaryLine({ done, optional = false, label, value }: { done: boolean; optional?: boolean; label: string; value: string }) {
  return (
    <View style={styles.summaryLine} accessible accessibilityLabel={`${label}: ${value}`}>
      <Ionicons
        name={done ? 'checkmark-circle' : optional ? 'ellipse-outline' : 'alert-circle-outline'}
        size={SUMMARY_ICON}
        color={done ? colors.success : colors.inkMuted}
      />
      <Text variant="bodySmall" style={styles.flex}>{label}</Text>
      <Text variant="bodySmall" color="inkMuted">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  // AIBadge aligns itself to the start; this centres it on the header line.
  badge: { minHeight: TARGET, justifyContent: 'center', paddingRight: space.sm },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: space.lg, paddingVertical: space.lg },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  section: { marginTop: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  gapXs: { marginTop: space.xs },
  gapSm: { marginTop: space.sm },
  gapMd: { marginTop: space.md },
  gapLg: { marginTop: space.lg },
  deskBody: { marginTop: space.xl },
  summary: { marginTop: space.md, gap: space.sm },
  summaryLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { marginBottom: space.sm },
  groupLabel: { marginTop: space.md, marginBottom: space.sm, fontFamily: fonts.sansMedium },
  input: {
    minHeight: INPUT_MIN_HEIGHT,
    marginTop: space.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontFamily: fonts.serif,
    fontSize: typeScale.body.fontSize,
    lineHeight: typeScale.body.lineHeight,
  },
  inputWide: { minHeight: INPUT_MIN_HEIGHT + space.xxxl * 2 },
  inputInvalid: { borderColor: colors.danger },
  below: { flexDirection: 'row', alignItems: 'flex-start', marginTop: space.xs, gap: space.sm },
  idea: {
    minHeight: TARGET,
    justifyContent: 'center',
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  ideasWide: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  ideaWide: { flexGrow: 1, flexBasis: 0, minWidth: layout.sidePanelWidth / 2, marginBottom: 0 },
  ideaHover: { borderColor: colors.ink },
  pressed: { opacity: 0.6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  linkRow: { alignItems: 'flex-start', marginTop: space.xs, marginLeft: -space.sm },
  format: { marginTop: space.sm, padding: space.md, borderRadius: radius.card, borderWidth: 1 },
  formatOn: { borderColor: colors.ink, backgroundColor: colors.surface },
  formatOff: { borderColor: colors.line, backgroundColor: colors.surfaceAlt },
  formatsWide: { flexDirection: 'row', gap: space.sm },
  formatWide: { flex: 1 },
  bold: { fontFamily: fonts.sansBold },
  cost: {
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  center: { textAlign: 'center' },
});
