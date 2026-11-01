import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '../../../components/ui';
import { colors, fonts, radius, space } from '../../../theme/tokens';

/** "Mature": shown wherever a mature series appears (only readers who opted in ever see one). */
export function MaturityMarker() {
  const { t } = useTranslation();
  const label = t('common:maturity.mature');
  return (
    <View style={styles.pill} accessible accessibilityRole="text" accessibilityLabel={label}>
      <Text variant="caption" color="surface" style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
  },
  label: { fontFamily: fonts.sansMedium },
});
