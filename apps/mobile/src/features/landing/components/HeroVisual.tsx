import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, View } from 'react-native';

import { AIBadge, Text } from '../../../components/ui';
import { DEMO_PANEL_KEYS, demoCover, demoPanelImage } from '../../../demo';
import { colors, fonts, radius, space } from '../../../theme/tokens';

// The hero's picture, made from the bundled demo art (no network, no external images): two series covers
// (live action, and The Clockmaker's Mice, an animated series made with AI; each is labelled at the top, clear of the
// overlap) and a phone showing a living comic panel that ends with a choice. The AI cover and the AI panel
// carry the AI badge like every AI picture in the app. Screen readers get one description of the whole
// picture instead of its pieces.
//
// It is drawn at BASE_W x BASE_H and scaled to `width`, so the composition keeps its shape on any screen.

export const BASE_W = 460;
export const BASE_H = 520;

// Geometry of the composition at scale 1 (an illustration, so its own fixed measurements).
const COVER_A = { x: 0, y: 36, w: 190, h: 253, rotate: '-6deg' };
const COVER_B = { x: 34, y: 262, w: 172, h: 229, rotate: '5deg' };
const PHONE = { x: 196, y: 18, w: 264, h: 484 };
const BEZEL = 6;

export function HeroVisual({ width }: { width: number }) {
  const { t } = useTranslation();
  const s = Math.max(0.5, Math.min(1.2, width / BASE_W));
  const live = demoCover('salt-and-static');
  const animated = demoCover('the-clockmakers-mice');
  const panel = demoPanelImage(DEMO_PANEL_KEYS[3] ?? '');

  const box = (g: { x: number; y: number; w: number; h: number }) => ({
    left: g.x * s,
    top: g.y * s,
    width: g.w * s,
    height: g.h * s,
  });

  return (
    <View
      role="img"
      aria-label={t('landing:hero.visualA11y')}
      style={[styles.stage, { width: BASE_W * s, height: BASE_H * s }]}
      testID="hero-visual"
    >
      <View style={[styles.cover, box(COVER_A), { transform: [{ rotate: COVER_A.rotate }] }]}>
        {live ? <Image source={live} style={styles.fill} resizeMode="cover" /> : null}
        <FormatChip label={t('common:format.live_action')} />
      </View>
      <View style={[styles.cover, box(COVER_B), { transform: [{ rotate: COVER_B.rotate }] }]}>
        {animated ? <Image source={animated} style={styles.fill} resizeMode="cover" /> : null}
        <View style={[styles.badge, { top: space.sm, left: space.sm }]}>
          <AIBadge size="sm" />
        </View>
      </View>

      <View style={[styles.phone, box(PHONE), { borderRadius: radius.sheet * 1.5 * s, borderWidth: BEZEL * s }]}>
        <View style={[styles.screen, { borderRadius: (radius.sheet * 1.5 - BEZEL) * s }]}>
          {panel ? <Image source={panel} style={styles.fill} resizeMode="cover" /> : null}
          <View style={[styles.badge, { top: space.md * s, left: space.md * s }]}>
            <AIBadge size="sm" />
          </View>
          <View style={[styles.overlay, { padding: space.md * s }]}>
            <Text variant="caption" color="surface" style={styles.caption}>
              {t('landing:sample.caption')}
            </Text>
            <Text variant="caption" color="surface" style={styles.question}>
              {t('landing:sample.question')}
            </Text>
            <Choice label={t('landing:sample.choiceA')} />
            <Choice label={t('landing:sample.choiceB')} />
          </View>
        </View>
      </View>
    </View>
  );
}

function FormatChip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text variant="caption" style={styles.chipText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Choice({ label }: { label: string }) {
  return (
    <View style={styles.choice}>
      <Text variant="caption" style={styles.choiceText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { position: 'relative', alignSelf: 'center' },
  fill: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  cover: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: radius.card,
    backgroundColor: colors.surfaceAlt,
    borderWidth: BEZEL / 2,
    borderColor: colors.surface,
    shadowColor: colors.ink,
    shadowOpacity: 0.16,
    shadowRadius: space.lg,
    shadowOffset: { width: 0, height: space.sm },
  },
  chip: {
    position: 'absolute',
    left: space.sm,
    top: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs / 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  chipText: { fontFamily: fonts.sansMedium },
  phone: {
    position: 'absolute',
    backgroundColor: colors.ink,
    borderColor: colors.ink,
    shadowColor: colors.ink,
    shadowOpacity: 0.22,
    shadowRadius: space.xl,
    shadowOffset: { width: 0, height: space.md },
  },
  screen: { flex: 1, overflow: 'hidden', backgroundColor: colors.playerBg },
  badge: { position: 'absolute' },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.scrim,
    gap: space.xs,
  },
  caption: { fontFamily: fonts.serif },
  question: { fontFamily: fonts.sansBold, marginTop: space.xs },
  choice: {
    alignSelf: 'stretch',
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  choiceText: { fontFamily: fonts.sansMedium, textAlign: 'center' },
});
