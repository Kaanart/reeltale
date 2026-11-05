import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Image, ScrollView, StyleSheet, View, type ImageSourcePropType, type TextStyle } from 'react-native';

import { focusRing, ResponsiveGrid, ShellLink, usePageTitle, useLayout, type LayoutSize } from '../../components/layout';
import { AIBadge, Text } from '../../components/ui';
import { DEMO_PANEL_KEYS, demoCover, demoPanelImage } from '../../demo';
import { colors, fonts, layout, radius, space, type as typeScale } from '../../theme/tokens';
import { useAuth } from '../auth';
import { useStickyGate } from '../auth/useStickyGate';
import { Band } from './components/Band';
import { CtaButton, CtaLink } from './components/Cta';
import { Heading } from './components/Heading';
import { BASE_W, HeroVisual } from './components/HeroVisual';
import { PublicPageEnd } from './components/PublicLinks';
import { useMetaDescription } from './components/useMetaDescription';
import { enterWebDemo } from '../../lib/env';
import { aiSteps, heroActions, landingRedirect, MODEL_NAMES, type AiStep, type HeroAction } from './logic/landing';

// The landing page at '/' (web only; LandingScreen.tsx is the native stand-in that opens sign-in). Visitors
// who are signed out see it; an account part-way through the gate goes back to its step; adults never get
// here (the root layout shows Home at '/'). It shows nothing personal and works without an account.
//
// Sections: hero (two columns from medium up) · the three kinds of stories · how it works · AI, labelled,
// and how a scene is made (accurate to the Worker: logic/landing.ts) · 18+ · closing call to action ·
// footer (site footer on wide windows, compact links on phones).

export function LandingScreen() {
  const { t } = useTranslation();
  const { gate, isDemo, actions } = useAuth();
  const settled = useStickyGate(gate);
  usePageTitle(t('landing:meta.title'));
  useMetaDescription(t('landing:meta.description'));

  const redirect = landingRedirect(settled);
  if (redirect) return <Redirect href={redirect as Href} />;
  return <Landing isDemo={isDemo} onDemo={actions.enterDemo} />;
}

function Landing({ isDemo, onDemo }: { isDemo: boolean; onDemo: () => void }) {
  const { t } = useTranslation();
  const { size, width, gutter, isCompact } = useLayout();
  const ctas = heroActions(isDemo);
  const steps = aiSteps();
  const inner = Math.max(0, Math.min(width - 2 * gutter, layout.contentMaxWidth));
  const split = !isCompact;
  const visualWidth = split ? Math.min(BASE_W, Math.round(inner * (size === 'wide' ? 0.42 : 0.44))) : Math.min(inner, BASE_W * 0.85);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll} testID="landing">
      <View role="main" style={styles.main}>
        {/* Hero */}
        <Band spacing="roomy" labelledBy="landing-hero" testID="landing-hero">
          <View style={[styles.hero, split && styles.heroSplit]}>
            <View style={[styles.heroText, split && styles.heroTextSplit]}>
              <View style={styles.eyebrow}>
                <Text variant="caption" color="inkMuted" style={styles.eyebrowText}>
                  {t('landing:hero.eyebrow')}
                </Text>
              </View>
              <Heading level={1} nativeID="landing-hero" style={heroTitle(size)}>
                {t('landing:hero.title')}
              </Heading>
              <Text variant="subheading" color="inkMuted" style={styles.lead}>
                {t('landing:hero.lead')}
              </Text>
              <Actions primary={ctas.primary} secondary={ctas.secondary} onDemo={onDemo} testPrefix="hero" />
              <View style={styles.adultsNote}>
                <AdultsMark />
                <Text variant="bodySmall" color="inkMuted" style={styles.adultsNoteText}>
                  {t('landing:hero.adults')}
                </Text>
              </View>
            </View>
            <View style={split ? styles.heroVisual : styles.heroVisualStacked}>
              <HeroVisual width={visualWidth} />
            </View>
          </View>
        </Band>

        {/* The three kinds of stories */}
        <Band tone="surface" labelledBy="landing-formats" testID="landing-formats">
          <Heading level={2} nativeID="landing-formats" style={styles.h2}>
            {t('landing:formats.title')}
          </Heading>
          <ResponsiveGrid columns={{ compact: 1, medium: 3, wide: 3 }} gap={space.xl} accessibilityLabel={t('landing:formats.a11y')}>
            <FormatCard image={demoCover('salt-and-static')} titleKey="landing:formats.liveAction.title" bodyKey="landing:formats.liveAction.body" />
            <FormatCard image={demoCover('paper-moons')} titleKey="landing:formats.stopMotion.title" bodyKey="landing:formats.stopMotion.body" />
            <FormatCard image={demoPanelImage(DEMO_PANEL_KEYS[1] ?? '')} titleKey="landing:formats.aiComics.title" bodyKey="landing:formats.aiComics.body" ai />
          </ResponsiveGrid>
        </Band>

        {/* How it works */}
        <Band labelledBy="landing-how" testID="landing-how">
          <Heading level={2} nativeID="landing-how" style={styles.h2}>
            {t('landing:how.title')}
          </Heading>
          <ResponsiveGrid columns={{ compact: 1, medium: 3, wide: 3 }} gap={space.xl} accessibilityLabel={t('landing:how.a11y')}>
            {(['watch', 'unlock', 'create'] as const).map((key, i) => (
              <View key={key} style={styles.howStep}>
                <View style={styles.howNumber} aria-hidden>
                  <Text variant="body" color="onAccent" style={styles.howNumberText}>
                    {String(i + 1)}
                  </Text>
                </View>
                <Heading level={3} variant="subheading" style={styles.h3}>
                  {t(`landing:how.steps.${key}.title`)}
                </Heading>
                <Text variant="body" color="inkMuted">
                  {t(`landing:how.steps.${key}.body`)}
                </Text>
              </View>
            ))}
          </ResponsiveGrid>
        </Band>

        {/* AI, labelled, and how a scene is made */}
        <Band tone="surfaceAlt" labelledBy="landing-ai" testID="landing-ai">
          <View style={[styles.ai, split && styles.aiSplit]}>
            <View style={[styles.aiIntro, split && styles.aiIntroSplit]}>
              <Heading level={2} nativeID="landing-ai" style={styles.h2}>
                {t('landing:ai.title')}
              </Heading>
              <View style={styles.badgeRow}>
                <AIBadge size="md" />
              </View>
              <Text variant="body" style={styles.para}>
                {t('landing:ai.body')}
              </Text>
              <View style={styles.safety}>
                <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <Ionicons name="shield-checkmark-outline" size={ICON} color={colors.ink} />
                </View>
                <Text variant="body" style={styles.safetyText}>
                  {t('landing:ai.safety')}
                </Text>
              </View>
            </View>
            <View style={styles.aiSteps}>
              <Heading level={3} variant="heading" style={styles.h3}>
                {t('landing:ai.stepsTitle')}
              </Heading>
              <View role="list" aria-label={t('landing:ai.stepsA11y')} style={styles.stepList}>
                {steps.map((s, i) => (
                  <AiStepRow
                    key={s.key}
                    step={s}
                    // Saying a choice isn't part of making the scene: it's the reader's turn, which starts the next one.
                    label={s.key === 'voice' ? t('landing:ai.yourTurn') : t('landing:ai.stepNumber', { number: i + 1 })}
                    last={i === steps.length - 1}
                  />
                ))}
              </View>
            </View>
          </View>
        </Band>

        {/* 18+ */}
        <Band tone="surface" labelledBy="landing-adults" testID="landing-adults">
          <View style={[styles.adults, split && styles.adultsSplit]}>
            <AdultsMark large />
            <View style={styles.adultsText}>
              <Heading level={2} nativeID="landing-adults" variant="heading">
                {t('landing:adults.title')}
              </Heading>
              <Text variant="body" color="inkMuted" style={styles.para}>
                {t('landing:adults.body')}
              </Text>
            </View>
          </View>
        </Band>

        {/* Closing */}
        <Band labelledBy="landing-closing" testID="landing-closing" innerStyle={styles.closing}>
          <Heading level={2} nativeID="landing-closing" style={styles.closingTitle}>
            {t('landing:closing.title')}
          </Heading>
          <Text variant="body" color="inkMuted" style={styles.closingBody}>
            {t('landing:closing.body')}
          </Text>
          <Actions primary={ctas.primary} secondary={ctas.secondary} onDemo={onDemo} centered testPrefix="closing" />
        </Band>
      </View>
      <PublicPageEnd />
    </ScrollView>
  );
}

// ---- Pieces ---------------------------------------------------------------------------------------------

function Actions({ primary, secondary, onDemo, centered = false, testPrefix }: {
  primary: HeroAction;
  secondary: HeroAction;
  onDemo: () => void;
  centered?: boolean;
  testPrefix: string;
}) {
  const { t } = useTranslation();
  const { isCompact } = useLayout();
  const render = (action: HeroAction, variant: 'primary' | 'secondary') =>
    action.kind === 'demo' || action.kind === 'demoSite' ? (
      <CtaButton
        label={t('landing:cta.demo')}
        onPress={action.kind === 'demo' ? onDemo : enterWebDemo}
        variant={variant}
        block={isCompact}
        testID={`${testPrefix}-demo`}
      />
    ) : (
      <CtaLink href={action.href} label={t(action.labelKey)} variant={variant} block={isCompact} testID={`${testPrefix}-${variant}`} />
    );

  return (
    <View role="group" aria-label={t('landing:cta.a11y')} style={[styles.actions, centered && styles.centered]}>
      <View style={[styles.ctaRow, isCompact && styles.ctaColumn, centered && styles.ctaRowCentered]}>
        {render(primary, 'primary')}
        {render(secondary, 'secondary')}
      </View>
      {primary.kind === 'demo' || secondary.kind === 'demoSite' ? (
        <Text variant="caption" color="inkMuted" align={centered ? 'center' : undefined}>
          {t('landing:cta.demoHint')}
        </Text>
      ) : null}
      <View style={[styles.code, centered && styles.centered]}>
        <ShellLink
          href="/welcome"
          accessibilityLabel={t('landing:cta.code')}
          testID={`${testPrefix}-code`}
          linkStyle={(s) => [styles.codeLink, centered && styles.codeLinkCentered, s.focusVisible && focusRing]}
          render={(s) => (
            <Text variant="body" style={[styles.codeLinkText, (s.hovered || s.pressed) && styles.codeLinkHover]}>
              {t('landing:cta.code')}
            </Text>
          )}
        />
        <Text variant="bodySmall" color="inkMuted" align={centered ? 'center' : undefined}>
          {t('landing:cta.codeHint')}
        </Text>
      </View>
    </View>
  );
}

function FormatCard({ image, titleKey, bodyKey, ai = false }: {
  image: ImageSourcePropType | null;
  titleKey: string;
  bodyKey: string;
  ai?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.card}>
      <View style={styles.cardImage}>
        {image ? <Image source={image} style={styles.fill} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
        {ai ? (
          <View style={styles.cardBadge}>
            <AIBadge size="sm" />
          </View>
        ) : null}
      </View>
      <View style={styles.cardBody}>
        <Heading level={3} variant="subheading" style={styles.h3}>
          {t(titleKey)}
        </Heading>
        <Text variant="body" color="inkMuted">
          {t(bodyKey)}
        </Text>
      </View>
    </View>
  );
}

function AiStepRow({ step, label, last }: { step: AiStep; label: string; last: boolean }) {
  const { t } = useTranslation();
  const model = MODEL_NAMES[step.model];
  return (
    <View role="listitem" style={[styles.stepRow, !last && styles.stepRowLine]}>
      <Text variant="caption" color="inkMuted" style={styles.stepNumber}>
        {label}
      </Text>
      <View style={styles.stepMain}>
        <View style={styles.stepHead}>
          <Text variant="body" style={styles.stepTitle}>
            {t(step.titleKey)}
          </Text>
          <View style={styles.modelChip} accessibilityLabel={t('landing:ai.modelA11y', { model })}>
            <Text variant="caption" style={styles.modelText}>
              {model}
            </Text>
          </View>
        </View>
        <Text variant="bodySmall" color="inkMuted">
          {t(step.bodyKey)}
        </Text>
      </View>
    </View>
  );
}

function AdultsMark({ large = false }: { large?: boolean }) {
  const { t } = useTranslation();
  const size = large ? MARK_LARGE : MARK;
  return (
    <View style={[styles.mark, { width: size, height: size, borderRadius: size / 2 }]} aria-hidden>
      <Text variant={large ? 'body' : 'caption'} style={styles.markText}>
        {t('landing:adults.mark')}
      </Text>
    </View>
  );
}

/** The hero headline: the display size on phones, larger on wider windows (scaled from the display token). */
function heroTitle(size: LayoutSize): TextStyle {
  const scale = size === 'wide' ? 1.5 : size === 'medium' ? 1.25 : 1;
  return {
    fontSize: Math.round(typeScale.display.fontSize * scale),
    lineHeight: Math.round(typeScale.display.lineHeight * scale),
    marginTop: space.lg,
  };
}

const ICON = 22;
const MARK = 28;
const MARK_LARGE = 56;
/** The cards' picture strip. */
const CARD_IMAGE = 180;
/** The hero's text column at its widest. */
const HERO_TEXT_MAX = 560;
const STEP_NUMBER_WIDTH = 64;
const HOW_NUMBER = layout.minTarget - space.sm;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1 },
  main: { width: '100%' },
  fill: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },

  hero: { gap: space.xxl },
  heroSplit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroText: { width: '100%' },
  heroTextSplit: { flex: 1, maxWidth: HERO_TEXT_MAX },
  heroVisual: { flexShrink: 0 },
  heroVisualStacked: { alignItems: 'center' },
  eyebrow: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  eyebrowText: { fontFamily: fonts.sansMedium },
  lead: { fontFamily: fonts.sans, marginTop: space.lg },
  adultsNote: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xl },
  adultsNoteText: { flexShrink: 1 },

  actions: { marginTop: space.xl, gap: space.md },
  centered: { alignItems: 'center' },
  ctaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  ctaColumn: { flexDirection: 'column', flexWrap: 'nowrap', alignSelf: 'stretch' },
  ctaRowCentered: { justifyContent: 'center' },
  code: { marginTop: space.xs, gap: space.xs / 2 },
  codeLink: { alignSelf: 'flex-start', minHeight: layout.minTarget, justifyContent: 'center', borderRadius: radius.chip },
  codeLinkCentered: { alignSelf: 'center' },
  codeLinkText: { fontFamily: fonts.sansBold, textDecorationLine: 'underline' },
  codeLinkHover: { color: colors.accentStrong },

  h2: { marginBottom: space.xl },
  h3: { marginBottom: space.xs },
  para: { marginTop: space.md },

  card: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  cardImage: { height: CARD_IMAGE, backgroundColor: colors.surfaceAlt },
  cardBadge: { position: 'absolute', top: space.md, left: space.md },
  cardBody: { padding: space.lg, gap: space.xs },

  howStep: { gap: space.sm },
  howNumber: {
    width: HOW_NUMBER,
    height: HOW_NUMBER,
    borderRadius: HOW_NUMBER / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentStrong,
    marginBottom: space.xs,
  },
  howNumberText: { fontFamily: fonts.sansBold },

  ai: { gap: space.xxl },
  aiSplit: { flexDirection: 'row', alignItems: 'flex-start' },
  aiIntro: { width: '100%' },
  aiIntroSplit: { flex: 1, maxWidth: HERO_TEXT_MAX - space.xxxl * 2 },
  aiSteps: {
    flex: 1,
    padding: space.xl,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  badgeRow: { flexDirection: 'row' },
  safety: { flexDirection: 'row', gap: space.md, marginTop: space.lg, alignItems: 'flex-start' },
  safetyText: { flex: 1 },
  stepList: { marginTop: space.sm },
  stepRow: { flexDirection: 'row', gap: space.md, paddingVertical: space.md },
  stepRowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  stepNumber: { width: STEP_NUMBER_WIDTH, paddingTop: space.xs / 2, fontFamily: fonts.sansMedium },
  stepMain: { flex: 1, gap: space.xs },
  stepHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.sm, rowGap: space.xs },
  stepTitle: { fontFamily: fonts.sansBold },
  modelChip: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs / 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  modelText: { fontFamily: fonts.sansMedium },

  adults: { gap: space.lg },
  adultsSplit: { flexDirection: 'row', alignItems: 'center', maxWidth: layout.readingMaxWidth + space.xxxl * 2 },
  adultsText: { flex: 1 },
  mark: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.ink, flexShrink: 0 },
  markText: { fontFamily: fonts.sansBold },

  closing: { alignItems: 'center' },
  closingTitle: { textAlign: 'center' },
  closingBody: { textAlign: 'center', marginTop: space.sm, maxWidth: layout.narrowMaxWidth },
});
