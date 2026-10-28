import { StyleSheet, View } from 'react-native';

import { colors, fonts, space, type TypeVariant } from '../../theme/tokens';
import { Text } from './Text';

export interface CoinPriceProps {
  coins: number;
  /** Local-currency estimate, already formatted by the caller (for example "€0.23"). */
  approx: string | null;
  size?: 'sm' | 'md';
  /** Original price, shown struck through when a discount applies. */
  strikethroughBase?: number | null;
}

const SIZES: Record<'sm' | 'md', { variant: TypeVariant; icon: number }> = {
  sm: { variant: 'bodySmall', icon: 14 },
  md: { variant: 'body', icon: 18 },
};

function coinWord(count: number): string {
  return count === 1 ? 'coin' : 'coins';
}

export function CoinPrice({ coins, approx, size = 'md', strikethroughBase = null }: CoinPriceProps) {
  const { variant, icon } = SIZES[size];
  const baseCoins =
    strikethroughBase !== null && strikethroughBase > coins ? strikethroughBase : null;

  const label =
    `${coins} ${coinWord(coins)}` +
    (baseCoins !== null ? `, reduced from ${baseCoins}` : '') +
    (approx ? `, about ${approx}` : '');

  return (
    <View style={styles.row} accessible accessibilityRole="text" accessibilityLabel={label}>
      <View style={[styles.coin, { width: icon, height: icon, borderRadius: icon / 2 }]} />
      <Text variant={variant} style={styles.text}>
        {baseCoins !== null ? (
          <>
            <Text variant={variant} color="inkMuted" style={styles.struck}>
              {baseCoins.toLocaleString()}
            </Text>
            {' '}
          </>
        ) : null}
        <Text variant={variant} style={styles.number}>
          {coins.toLocaleString()}
        </Text>
        <Text variant={variant} color="inkMuted">
          {` ${coinWord(coins)}`}
        </Text>
        {approx ? (
          <Text variant={variant} color="inkMuted">
            {` (≈ ${approx})`}
          </Text>
        ) : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  coin: {
    marginRight: space.xs + 2,
    backgroundColor: colors.coin,
    borderWidth: 1.5,
    borderColor: colors.warn,
  },
  text: { flexShrink: 1 },
  number: { fontFamily: fonts.sansBold },
  struck: { textDecorationLine: 'line-through' },
});
