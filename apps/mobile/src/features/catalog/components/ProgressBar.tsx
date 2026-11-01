import { StyleSheet, View } from 'react-native';

import { colors, radius } from '../../../theme/tokens';

/** A thin bar for "how far". Decorative: the percentage is always written next to it. */
export function ProgressBar({ percent }: { percent: number }) {
  const width = `${Math.max(0, Math.min(100, percent))}%` as const;
  return (
    <View style={styles.track} accessible={false} importantForAccessibility="no">
      <View style={[styles.fill, { width }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 4, borderRadius: radius.pill, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.ink },
});
