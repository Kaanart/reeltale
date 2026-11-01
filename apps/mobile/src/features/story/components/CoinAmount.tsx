import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Text } from '../../../components/ui';
import { colors, space, type TypeVariant } from '../../../theme/tokens';

// A number of coins with the coin mark ("● 50 coins"). Coins only: nothing here is ever a money price.
export interface CoinAmountProps {
  coins: number;
  variant?: Extract<TypeVariant, 'body' | 'bodySmall' | 'subheading'>;
}

const DOT: Record<NonNullable<CoinAmountProps['variant']>, number> = { bodySmall: 12, body: 14, subheading: 16 };

export function CoinAmount({ coins, variant = 'body' }: CoinAmountProps) {
  const { t } = useTranslation();
  const size = DOT[variant];
  const label = t('common:coins.count', { count: coins });
  return (
    <View style={styles.row} accessible accessibilityRole="text" accessibilityLabel={label}>
      <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2 }]} />
      <Text variant={variant} style={styles.text}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: { marginRight: space.xs, backgroundColor: colors.coin, borderWidth: 1.5, borderColor: colors.warn },
  text: { flexShrink: 1 },
});
