import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { Text } from '../../../components/ui';
import type { TypeVariant } from '../../../theme/tokens';
import { fonts } from '../../../theme/tokens';
import { mailtoHref, SUPPORT_EMAIL } from '../logic/landing';

// The support address as a mailto: link (web: a real <a href>, so it can be copied and opened in the
// visitor's own mail app). Underlined ink: the accent is too light for small text on paper.

export function MailLink({ subject, variant = 'body' }: { subject?: string; variant?: TypeVariant }) {
  const { t } = useTranslation();
  // href is a react-native-web prop on Text (renders <a>); React Native's types don't list it.
  const web = { href: mailtoHref(subject) } as object;
  return (
    <Text
      {...web}
      role="link"
      variant={variant}
      accessibilityLabel={t('notice:emailA11y', { email: SUPPORT_EMAIL })}
      style={styles.link}
    >
      {SUPPORT_EMAIL}
    </Text>
  );
}

const styles = StyleSheet.create({
  link: { fontFamily: fonts.sansMedium, textDecorationLine: 'underline' },
});
