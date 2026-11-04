import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { legalUrl, type LegalPageSlug } from '../../features/me/logic/legal';
import { colors, fonts, layout, radius, space } from '../../theme/tokens';
import { Text } from '../ui';
import { focusRing, ShellLink } from './ShellLink';
import { useLayout } from './useLayout';

// The site footer: on the web at medium and wide widths only (renders nothing in the native apps and on
// phone-sized windows, where Settings carries the legal links). PageContainer ends every page with it; a
// screen that scrolls on its own (a FlashList) puts <SiteFooter /> as the last thing in its scroll content.
//
//   About -> /about (public page)        Terms, Privacy, Community guidelines, AI policy -> the hosted
//   Report illegal content -> /notice     legal pages on eurastudios.com, in a new tab

const LEGAL: { slug: LegalPageSlug; labelKey: string }[] = [
  { slug: 'terms', labelKey: 'common:footer.terms' },
  { slug: 'privacy', labelKey: 'common:footer.privacy' },
  { slug: 'community', labelKey: 'common:footer.community' },
  { slug: 'ai-policy', labelKey: 'common:footer.aiPolicy' },
];

const ABOUT_PATH = '/about';
const NOTICE_PATH = '/notice';

export function SiteFooter() {
  const { t } = useTranslation();
  const { hasTopNav, isWide, gutter } = useLayout();
  if (!hasTopNav) return null;

  return (
    <View role="contentinfo" style={styles.footer} testID="site-footer">
      <View
        style={[
          styles.inner,
          isWide && styles.innerWide,
          { paddingHorizontal: gutter, maxWidth: layout.contentMaxWidth + 2 * gutter },
        ]}
      >
        <View style={styles.brand}>
          <Text variant="heading" style={styles.wordmark}>
            {t('common:appName')}
          </Text>
          <Text variant="bodySmall" color="inkMuted">
            {t('common:footer.imprint')}
          </Text>
          <Text variant="bodySmall" color="inkMuted">
            {t('common:footer.adultsOnly')}
          </Text>
        </View>

        <View role="navigation" aria-label={t('common:footer.a11y')} style={[styles.links, isWide && styles.linksWide]}>
          <FooterLink href={ABOUT_PATH} label={t('common:footer.about')} />
          {LEGAL.map((doc) => (
            <FooterLink key={doc.slug} href={legalUrl(doc.slug)} label={t(doc.labelKey)} external />
          ))}
          <FooterLink href={NOTICE_PATH} label={t('common:footer.notice')} />
        </View>
      </View>
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
      linkStyle={(s) => [styles.link, s.focusVisible && focusRing]}
      render={(s) => (
        <>
          <Text variant="bodySmall" style={[styles.linkText, (s.hovered || s.pressed) && styles.linkHover]}>
            {label}
          </Text>
          {external ? (
            <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Ionicons name="open-outline" size={EXTERNAL_ICON} color={colors.inkMuted} />
            </View>
          ) : null}
        </>
      )}
    />
  );
}

const EXTERNAL_ICON = 12;

const styles = StyleSheet.create({
  footer: {
    width: '100%',
    marginTop: space.xxxl,
    backgroundColor: colors.surfaceAlt,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  inner: {
    width: '100%',
    alignSelf: 'center',
    paddingVertical: space.xxl,
    gap: space.xl,
  },
  innerWide: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  brand: { gap: space.xs, flexShrink: 1 },
  wordmark: { fontFamily: fonts.serifBold, marginBottom: space.xs },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.xs },
  linksWide: { maxWidth: layout.contentMaxWidth / 2, justifyContent: 'flex-end' },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: layout.minTarget,
    borderRadius: radius.chip,
  },
  linkText: { fontFamily: fonts.sansMedium },
  linkHover: { textDecorationLine: 'underline' },
});
