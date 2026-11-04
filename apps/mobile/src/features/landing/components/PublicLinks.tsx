import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { focusRing, ShellLink, SiteFooter, useLayout } from '../../../components/layout';
import { Text } from '../../../components/ui';
import { colors, fonts, layout, radius, space } from '../../../theme/tokens';
import { legalUrl, type LegalPageSlug } from '../../me/logic/legal';

// The end of a public page. On wide windows that is the site footer; on phone-sized windows (where the
// shell shows no footer, and a visitor has no Settings screen) a compact list of the same links, the
// imprint and the 18+ line, so the legal pages and the notice form are always one tap away.

const LEGAL: { slug: LegalPageSlug; labelKey: string }[] = [
  { slug: 'terms', labelKey: 'common:footer.terms' },
  { slug: 'privacy', labelKey: 'common:footer.privacy' },
  { slug: 'community', labelKey: 'common:footer.community' },
  { slug: 'ai-policy', labelKey: 'common:footer.aiPolicy' },
];

export function PublicPageEnd() {
  const { hasTopNav } = useLayout();
  return hasTopNav ? <SiteFooter /> : <CompactLinks />;
}

function CompactLinks() {
  const { t } = useTranslation();
  const { gutter } = useLayout();
  return (
    <View role="contentinfo" style={[styles.box, { paddingHorizontal: gutter }]} testID="public-links">
      <View role="navigation" aria-label={t('common:footer.a11y')} style={styles.links}>
        <Item href="/about" label={t('common:footer.about')} />
        {LEGAL.map((doc) => (
          <Item key={doc.slug} href={legalUrl(doc.slug)} label={t(doc.labelKey)} external />
        ))}
        <Item href="/notice" label={t('common:footer.notice')} />
      </View>
      <Text variant="caption" color="inkMuted" style={styles.line}>
        {t('common:footer.imprint')}
      </Text>
      <Text variant="caption" color="inkMuted">
        {t('common:footer.adultsOnly')}
      </Text>
    </View>
  );
}

function Item({ href, label, external = false }: { href: string; label: string; external?: boolean }) {
  const { t } = useTranslation();
  return (
    <ShellLink
      href={href}
      external={external}
      accessibilityLabel={external ? t('common:footer.newTab', { label }) : label}
      linkStyle={(s) => [styles.item, s.focusVisible && focusRing]}
      render={() => (
        <Text variant="bodySmall" style={styles.itemText}>
          {label}
        </Text>
      )}
    />
  );
}

const styles = StyleSheet.create({
  box: {
    width: '100%',
    marginTop: space.xxl,
    paddingVertical: space.xl,
    backgroundColor: colors.surfaceAlt,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg },
  item: { minHeight: layout.minTarget, justifyContent: 'center', borderRadius: radius.chip },
  itemText: { fontFamily: fonts.sansMedium, textDecorationLine: 'underline' },
  line: { marginTop: space.md },
});
