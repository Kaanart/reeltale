import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { focusRing, ResponsiveGrid, ShellLink, usePageTitle } from '../../components/layout';
import { Text } from '../../components/ui';
import { colors, fonts, layout, radius, space } from '../../theme/tokens';
import { legalUrl, type LegalPageSlug } from '../me/logic/legal';
import { Heading } from './components/Heading';
import { MailLink } from './components/MailLink';
import { PublicPage } from './components/PublicPage';
import { useMetaDescription } from './components/useMetaDescription';

// /about (web, public): who makes ReelTale, the hackathon in one line, how to reach us, and the legal pages.
// Nothing personal, no account needed; the shell adds the public bar (or the app bar for adults).

const LEGAL: { slug: LegalPageSlug; labelKey: string }[] = [
  { slug: 'terms', labelKey: 'about:legal.terms' },
  { slug: 'privacy', labelKey: 'about:legal.privacy' },
  { slug: 'community', labelKey: 'about:legal.community' },
  { slug: 'ai-policy', labelKey: 'about:legal.aiPolicy' },
];

export function AboutScreen() {
  const { t } = useTranslation();
  usePageTitle(t('about:pageTitle'));
  useMetaDescription(t('about:description'));

  return (
    <PublicPage testID="about">
      <Heading level={1}>{t('about:title')}</Heading>
      <Text variant="subheading" color="inkMuted" style={styles.lead}>
        {t('about:lead')}
      </Text>

      <View role="region" aria-labelledby="about-who" style={styles.section}>
        <Heading level={2} variant="heading" nativeID="about-who">
          {t('about:who.title')}
        </Heading>
        <Text variant="body" style={styles.para}>
          {t('about:who.body')}
        </Text>
      </View>

      <View role="region" aria-labelledby="about-hackathon" style={styles.section}>
        <Heading level={2} variant="heading" nativeID="about-hackathon">
          {t('about:hackathon.title')}
        </Heading>
        <Text variant="body" style={styles.para}>
          {t('about:hackathon.body')}
        </Text>
      </View>

      <ResponsiveGrid columns={{ compact: 1, medium: 2, wide: 2 }} gap={space.lg} style={styles.section}>
        <View role="region" aria-labelledby="about-contact" style={styles.card}>
          <Heading level={2} variant="heading" nativeID="about-contact">
            {t('about:contact.title')}
          </Heading>
          <Text variant="body" color="inkMuted" style={styles.para}>
            {t('about:contact.body')}
          </Text>
          <View style={styles.mail}>
            <MailLink />
          </View>
        </View>

        <View role="region" aria-labelledby="about-legal" style={styles.card}>
          <Heading level={2} variant="heading" nativeID="about-legal">
            {t('about:legal.title')}
          </Heading>
          <View role="list" aria-label={t('about:legal.a11y')} style={styles.list}>
            {LEGAL.map((doc) => (
              <View role="listitem" key={doc.slug}>
                <LinkRow href={legalUrl(doc.slug)} label={t(doc.labelKey)} external />
              </View>
            ))}
            <View role="listitem">
              <LinkRow href="/notice" label={t('about:legal.notice')} />
            </View>
          </View>
        </View>
      </ResponsiveGrid>

      <Text variant="bodySmall" color="inkMuted" style={styles.adults}>
        {t('about:adults')}
      </Text>
      <View style={styles.home}>
        <LinkRow href="/" label={t('about:home')} icon="arrow-back" />
      </View>
    </PublicPage>
  );
}

function LinkRow({ href, label, external = false, icon }: {
  href: string;
  label: string;
  external?: boolean;
  icon?: 'arrow-back';
}) {
  const { t } = useTranslation();
  return (
    <ShellLink
      href={href}
      external={external}
      accessibilityLabel={external ? t('common:footer.newTab', { label }) : label}
      linkStyle={(s) => [styles.link, s.focusVisible && focusRing]}
      render={(s) => (
        <>
          {icon ? <Glyph name={icon} /> : null}
          <Text variant="body" style={[styles.linkText, (s.hovered || s.pressed) && styles.linkHover]}>
            {label}
          </Text>
          {external ? <Glyph name="open-outline" /> : null}
        </>
      )}
    />
  );
}

function Glyph({ name }: { name: 'arrow-back' | 'open-outline' }) {
  return (
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Ionicons name={name} size={GLYPH} color={colors.inkMuted} />
    </View>
  );
}

const GLYPH = 16;

const styles = StyleSheet.create({
  lead: { fontFamily: fonts.sans, marginTop: space.md },
  section: { marginTop: space.xxl },
  para: { marginTop: space.sm },
  card: {
    flex: 1,
    padding: space.xl,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  mail: { marginTop: space.md, minHeight: layout.minTarget, justifyContent: 'center', alignItems: 'flex-start' },
  list: { marginTop: space.sm },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.sm,
    minHeight: layout.minTarget,
    borderRadius: radius.chip,
  },
  linkText: { fontFamily: fonts.sansMedium, textDecorationLine: 'underline' },
  linkHover: { color: colors.accentStrong },
  adults: { marginTop: space.xxl },
  home: { marginTop: space.md },
});
