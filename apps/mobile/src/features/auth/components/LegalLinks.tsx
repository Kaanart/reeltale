import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { openLegal } from '../../../lib/links';
import { space } from '../../../theme/tokens';
import { TextLink } from './TextLink';

/** Terms and Privacy, side by side, each opening the hosted page. */
export function LegalLinks() {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <TextLink label={t('auth:welcome.terms')} role="link" onPress={() => void openLegal('terms')} />
      <TextLink label={t('auth:welcome.privacy')} role="link" onPress={() => void openLegal('privacy')} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: space.lg },
});
