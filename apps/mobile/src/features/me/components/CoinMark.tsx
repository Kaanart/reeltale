import { StyleSheet, View } from 'react-native';

import { colors, radius } from '../../../theme/tokens';

// The coin glyph (the same disc the UI kit's CoinPrice draws), at any size. Decorative.
export function CoinMark({ size }: { size: number }) {
  return (
    <View
      style={[styles.coin, { width: size, height: size, borderRadius: radius.pill }]}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}

const styles = StyleSheet.create({
  coin: { backgroundColor: colors.coin, borderWidth: 2, borderColor: colors.warn },
});
