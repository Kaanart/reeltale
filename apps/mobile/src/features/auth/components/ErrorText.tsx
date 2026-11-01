import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '../../../components/ui';
import { space } from '../../../theme/tokens';
import type { ErrorText as ErrorTextValue } from '../validation';

// A form-level error message (from signInErrorText / describeError), announced when it appears.
export function ErrorText({ error }: { error: ErrorTextValue | null }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <Text variant="bodySmall" color="danger" accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.text}>
      {t(error.key, error.params)}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { marginTop: space.md },
});
