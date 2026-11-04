import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { legalUrl, type LegalPageSlug } from '../../features/me/logic/legal';
import { colors, fonts, layout, radius, space } from '../../theme/tokens';
import { Text } from '../ui';
import { focusRing, ShellLink } from './ShellLink';
import { useLayout } from './useLayout';

// The site footer: a dark band at the end of every web page, phones included, so the imprint, the legal pages
// and the notice form are always one scroll away (the native apps render nothing: Settings carries the legal
// links there). PageContainer ends every page with it;
// a screen that scrolls on its own (a FlashList) puts <SiteFooter /> as the last thing in its scroll content.
//
//   ReelTale   About -> /about (public page), Report illegal content -> /notice
//   Legal      Terms, Privacy, Community guidelines, AI policy -> the hosted legal pages on eurastudios.com,
//              in a new tab
//   Creators   Become a creator -> /create
//   and the imprint ("made by Euragnos B.V.") and "For adults 18+".

const LEGAL: { slug: LegalPageSlug; labelKey: string }[] = [
  { slug: 'terms', labelKey: 'common:footer.terms' },
  { slug: 'privacy', labelKey: 'common:footer.privacy' },
  { slug: 'community', labelKey: 'common:footer.community' },
  { slug: 'ai-policy', labelKey: 'common:footer.aiPolicy' },
];

const ABOUT_PATH = '/about';
const NOTICE_PATH = '/notice';
const CREATE_PATH = '/create';

/** The keyboard focus ring in the footer: light, so it shows on the dark band. */
const FOOTER_FOCUS: ViewStyle = { ...focusRing, outlineColor: colors.footerInk };
const COLUMN_WIDTH = 200;
/** Two columns side by side on a 360 px phone. */
const COLUMN_WIDTH_COMPACT = 150;
const EXTERNAL_ICON = 12;

export function SiteFooter() {
  const { t } = useTranslation();
  const { isCompact, isWide, gutter } = useLayout();
  if (Platform.OS !== 'web') return null;
  const frame = { paddingHorizontal: gutter, maxWidth: layout.contentMaxWidth + 2 * gutter };

  return (
    <View role="contentinfo" style={styles.footer} testID="site-footer">
      <View style={[styles.inner, isWide && styles.innerWide, frame]}>
        <View style={[styles.brand, isWide && styles.brandWide]}>
          <Text variant="title" color="footerInk" style={styles.wordmark}>
            {t('common:appName')}
          </Text>
          <Text variant="bodySmall" color="footerInkMuted">
            {t('common:footer.tagline')}
          </Text>
        </View>

        <View role="navigation" aria-label={t('common:footer.a11y')} style={[styles.columns, isCompact && styles.columnsCompact]}>
          <FooterColumn compact={isCompact} title={t('common:footer.columns.site')}>
            <FooterLink href={ABOUT_PATH} label={t('common:footer.about')} />
            <FooterLink href={NOTICE_PATH} label={t('common:footer.notice')} />
          </FooterColumn>
          <FooterColumn compact={isCompact} title={t('common:footer.columns.legal')}>
            {LEGAL.map((doc) => (
              <FooterLink key={doc.slug} href={legalUrl(doc.slug)} label={t(doc.labelKey)} external />
            ))}
          </FooterColumn>
          <FooterColumn compact={isCompact} title={t('common:footer.columns.creators')}>
            <FooterLink href={CREATE_PATH} label={t('common:footer.becomeCreator')} />
          </FooterColumn>
        </View>
      </View>

      <View style={styles.rule} />
      <View style={[styles.inner, styles.imprint, frame]}>
        <Text variant="bodySmall" color="footerInkMuted">
          {t('common:footer.imprint')}
        </Text>
        <Text variant="bodySmall" color="footerInkMuted">
          {t('common:footer.adultsOnly')}
        </Text>
      </View>
    </View>
  );
}

function FooterColumn({ title, compact, children }: { title: string; compact: boolean; children: ReactNode }) {
  // Each column is a small list under its own heading (web: an <h2>).
  const level = Platform.OS === 'web' ? ({ 'aria-level': 2 } as object) : null;
  return (
    <View style={[styles.column, compact && styles.columnCompact]}>
      <Text variant="bodySmall" color="footerInk" accessibilityRole="header" {...level} style={styles.columnTitle}>
        {title}
      </Text>
      <View style={styles.columnLinks}>{children}</View>
    </View>
  );
}

function FooterLink({ href, label, external = false }: { href: string; label: string; external?: boolean }) {
  const { t } = useTranslation();
  return (
    <ShellLink
      href={href}
      external={external}
      accessibilityLabel={external ? t('common:footer.newTab', { label }) : label}
      linkStyle={(s) => [styles.link, s.focusVisible && FOOTER_FOCUS]}
      render={(s) => (
        <>
          <Text
            variant="bodySmall"
            color={s.hovered || s.pressed ? 'footerInk' : 'footerInkMuted'}
            style={[styles.linkText, (s.hovered || s.pressed) && styles.linkHover]}
          >
            {label}
          </Text>
          {external ? (
            <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Ionicons name="open-outline" size={EXTERNAL_ICON} color={colors.footerInkMuted} />
            </View>
          ) : null}
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
  footer: {
    width: '100%',
    marginTop: space.xxxl,
    backgroundColor: colors.footerBg,
  },
  inner: {
    width: '100%',
    alignSelf: 'center',
    paddingVertical: space.xxl,
    gap: space.xl,
  },
  innerWide: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  brand: { gap: space.sm, flexShrink: 1 },
  brandWide: { maxWidth: COLUMN_WIDTH * 2 },
  wordmark: { fontFamily: fonts.serifBold },
  columns: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.xxl, rowGap: space.xl },
  columnsCompact: { columnGap: space.lg },
  column: { width: COLUMN_WIDTH, gap: space.sm },
  columnCompact: { width: COLUMN_WIDTH_COMPACT },
  columnTitle: { fontFamily: fonts.sansBold },
  columnLinks: { gap: 0 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    minHeight: layout.minTarget,
    borderRadius: radius.chip,
  },
  linkText: { fontFamily: fonts.sans },
  linkHover: { textDecorationLine: 'underline' },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.footerInkMuted, opacity: 0.3 },
  imprint: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingVertical: space.lg, gap: space.sm },
});
